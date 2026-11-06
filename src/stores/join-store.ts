import { create } from "zustand"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import type { LiveStateV1 } from "@/lib/live-state"
import { useSettingsStore } from "@/stores/settings-store"
import { takeUnableReason } from "@/stores/notices-store"

/**
 * Joining another Rhema (Host/Join, ARCH-004): this computer follows the host's Live State and
 * sends the commands its key allows; the host checks every one. Nothing here drives this
 * computer's own screens, and a lost connection never affects the host's service.
 */
export type JoinStatus = "off" | "connecting" | "connected" | "reconnecting" | "refused"

interface JoinState {
  status: JoinStatus
  error: string | null
  /** The name and role the host gives this computer. */
  me: { name: string; role: string; outputScope?: string[]; groupTakeScope?: string[] } | null
  /** The main desk has taken back control (#243): this desk still follows and talks, its commands wait. */
  paused: boolean
  /** A passing note that is not an error (the host moved to another service and this desk refreshed). */
  note: string | null
  /**
   * How this desk reaches the host while connected: true = https with the host's certificate
   * checked (kept at pairing); false = plain http (the host does not run https, or was paired
   * without it), which the desk warns about; null = not connected yet.
   */
  secure: boolean | null
  live: LiveStateV1 | null
  /** This desk's monotonic time when `live` arrived: a running timer counts on from it (no clock skew). */
  receivedAt: number
  /**
   * How far this desk's wall clock is from the host's (ms, + = this one ahead), from the Live
   * State's "at": the smallest gap of the last few arrivals, so a snapshot that waited does not
   * count as skew. Null until one arrives.
   */
  clockSkewMs: number | null
  /** `asCompanion`: this computer runs OBS only (#209) and pairs as an OBS companion, which the host may change. */
  pair: (address: string, code: string, name: string, asCompanion?: boolean) => Promise<void>
  connect: () => Promise<void>
  leave: (forget?: boolean) => Promise<void>
  /**
   * A host command (the event clock, …): refused by the host if the role does not allow it, if the
   * main desk has taken back control, or if it is for another service. Says whether the host did it,
   * and if not, why in the host's words.
   */
  send: (command: { command: string; value?: string | number | Record<string, unknown>; seen?: Record<string, number>; id?: string; service?: string | null }) => Promise<SendResult>
}

/** `note`: what the host said about a command it took (a scene change sent to the main desk to accept). `stale`: the desk's copy of a scene was older than the host's. */
export type SendResult = { ok: true; note?: string; revision?: number } | { ok: false; error: string; stale?: true }

export interface HostReceiverOutput {
  id: string
  feed: boolean
  watching?: number
  seq?: number
  acked?: number
  confirmed?: boolean
}


/** What a desk is told when someone changed that part of the service before its command arrived. */
export const STALE_MESSAGE = "Someone changed this first — look again"

/**
 * A command as this desk sends it: with the revisions of the Live State it acted on (`seen`, #196
 * R7), so the host can refuse it if someone changed that part first, and, for an Unable answer, the
 * reason this desk could not do what was asked (Comms, #251). Older hosts ignore both.
 */
export function withWhatWasSeen(command: { command: string; value?: unknown; seen?: Record<string, number>; id?: string }, live: LiveStateV1 | null): Record<string, unknown> {
  const out: Record<string, unknown> = { ...command }
  // What a command says it saw itself wins: a scene editor sends the scene's revision from when it
  // was opened, not from the Live State now (#243 SC.16).
  if (live?.revisions || command.seen) out.seen = { ...live?.revisions, ...command.seen }
  const v = command.value as { id?: unknown; state?: unknown } | undefined
  if (command.command === "notice_ack" && v?.state === "unable" && typeof v.id === "string") {
    const why = takeUnableReason(v.id)
    if (why) out.why = why
  }
  return out
}

/** What a desk shows when the host is on another service and the command was not sent. */
const OTHER_SERVICE_NOTE = "The main desk is on a different service now, so that was not sent. This desk has refreshed: check what is live, then try again."

/**
 * The service this desk is looking at, sent with each command (#246 C16): "" when the host has no
 * saved service open; undefined when this desk has no Live State yet or the host is an older build
 * that does not say (then the command is sent untagged, as before).
 */
export function serviceOf(live: LiveStateV1 | null): string | undefined {
  if (!live) return undefined
  if (live.service === null) return ""
  return live.service.id
}

/** Read receiver confirmation from the host, scoped to this paired desk's allowed outputs. */
export async function readHostReceivers(): Promise<HostReceiverOutput[]> {
  const { joinAddress: address, joinToken: token } = useSettingsStore.getState()
  const result = await invoke<unknown>("join_receivers", { address, token })
  if (!result || typeof result !== "object" || Array.isArray(result) || !Array.isArray((result as { outputs?: unknown }).outputs)) {
    throw new Error("The host returned a malformed receiver report.")
  }
  return (result as { outputs: unknown[] }).outputs.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The host returned a malformed receiver row.")
    const row = value as Record<string, unknown>
    if (typeof row.id !== "string" || typeof row.feed !== "boolean") throw new Error("The host returned a malformed receiver row.")
    if (row.feed && (
      !Number.isSafeInteger(row.watching) || (row.watching as number) < 0
      || !Number.isSafeInteger(row.seq) || (row.seq as number) < 0
      || !Number.isSafeInteger(row.acked) || (row.acked as number) < 0
      || typeof row.confirmed !== "boolean"
    )) {
      throw new Error("The host returned incomplete receiver confirmation.")
    }
    return {
      id: row.id,
      feed: row.feed,
      ...(row.feed ? {
        watching: row.watching as number,
        seq: row.seq as number,
        acked: row.acked as number,
        confirmed: row.confirmed as boolean,
      } : {}),
    }
  })
}

// The last few arrivals' (this desk's wall time − the host's "at").
let gaps: number[] = []

let listening = false
async function listenOnce() {
  if (listening) return
  listening = true
  await listen<string>("join:live", (e) => {
    try {
      const live = JSON.parse(e.payload) as LiveStateV1
      if (live?.v !== 1) return
      // An in-flight host snapshot can arrive after its refusal event. Keep the
      // desk cleared until the user successfully pairs or reconnects again.
      if (useJoin.getState().status === "refused" || useJoin.getState().status === "off") return
      const name = useJoin.getState().me?.name
      // The host lists the desks it has taken back control from; an older host does not say.
      const paused = Array.isArray(live.paused) && name ? live.paused.includes(name) : useJoin.getState().paused
      if (typeof live.at === "number") gaps = [...gaps, Date.now() - live.at].slice(-5)
      // A lost connection's reason goes once the host is heard again. A command's refusal stays
      // until the next command: the host sends every 2 s, which would wipe it before it was read.
      const was = useJoin.getState()
      const error = was.status === "connected" ? was.error : null
      useJoin.setState({ live, receivedAt: performance.now(), clockSkewMs: gaps.length ? Math.min(...gaps) : null, status: "connected", error, paused })
    } catch {
      // A snapshot this build cannot read: keep the last one.
    }
  })
  // The host's address changed and this computer found it by its pinned certificate.
  await listen<string>("join:moved", (e) => {
    try {
      const { address } = JSON.parse(e.payload) as { address?: unknown }
      if (typeof address === "string" && address) useSettingsStore.getState().setJoin({ joinAddress: address })
    } catch {
      // Not a message this build can read: this computer keeps the address it has.
    }
  })
  await listen<string>("join:state", (e) => {
    try {
      const p = JSON.parse(e.payload) as { state: string; error?: string; secure?: boolean; me?: { name?: unknown; role?: unknown; paused?: unknown; outputScope?: unknown; groupTakeScope?: unknown } | null }
      const status: JoinStatus = p.state === "connected" ? "connected" : p.state === "reconnecting" ? "reconnecting" : p.state === "refused" ? "refused" : "off"
      // Each (re)connection says what the host makes of this desk now: the main desk may have
      // changed its role or taken back control while it was away (the host ends the stream then).
      const outputScope = p.me && Array.isArray(p.me.outputScope) && p.me.outputScope.every((id) => typeof id === "string") ? p.me.outputScope : undefined
      const groupTakeScope = p.me && Array.isArray(p.me.groupTakeScope) && p.me.groupTakeScope.every((id) => typeof id === "string") && outputScope
        ? p.me.groupTakeScope.filter((id) => outputScope.includes(id))
        : undefined
      const me = p.me && typeof p.me.name === "string" && typeof p.me.role === "string" ? { me: {
        name: p.me.name,
        role: p.me.role,
        ...(outputScope ? { outputScope } : {}),
        ...(groupTakeScope ? { groupTakeScope } : {}),
      }, paused: p.me.paused === true } : {}
      useJoin.setState({
        status,
        error: p.error ?? null,
        ...(typeof p.secure === "boolean" ? { secure: p.secure } : {}),
        ...me,
        // A refusal means this host no longer grants access. Do not leave its last
        // service, notices, or role in memory while the desk waits for a new pairing.
        ...(status === "refused" ? { me: null, live: null, paused: false, note: null, receivedAt: 0, clockSkewMs: null } : {}),
      })
    } catch {
      // ignore
    }
  })
}

/** The first-connect retry: its timer and its current wait (0 while not retrying). */
let retryTimer: ReturnType<typeof setTimeout> | null = null
let connectRetry = 0

export const useJoin = create<JoinState>((set, get) => ({
  status: "off",
  error: null,
  me: null,
  paused: false,
  note: null,
  secure: null,
  live: null,
  receivedAt: 0,
  clockSkewMs: null,
  pair: async (address, code, name, asCompanion = false) => {
    set({ status: "connecting", error: null })
    try {
      const paired = await invoke<Paired | string>("join_pair", asCompanion ? { address, code, name, role: "obs-companion" } : { address, code, name })
      const { token, secure } = typeof paired === "string" ? { token: paired, secure: null } : paired
      useSettingsStore.getState().setJoin({ joinAddress: address.trim(), joinName: name.trim(), joinToken: token, joinSecure: secure })
      await get().connect()
    } catch (e) {
      set({ status: "off", error: String(e) })
    }
  },
  connect: async () => {
    const { joinAddress: address, joinToken: token, joinSecure } = useSettingsStore.getState()
    if (!address || !token) return
    await listenOnce()
    gaps = []
    set({ status: "connecting", error: null, clockSkewMs: null, secure: null })
    try {
      // How this host is reached, as kept at pairing: https with its certificate authority, or http.
      await invoke("join_secure", { address, secure: joinSecure ? { port: joinSecure.port, fingerprint: joinSecure.fingerprint } : null })
      const me = await invoke<{ name: string; role: string; paused?: boolean; outputScope?: string[] | null; groupTakeScope?: string[] | null }>("join_me", { address, token })
      const outputScope = Array.isArray(me.outputScope) ? me.outputScope : undefined
      const groupTakeScope = Array.isArray(me.groupTakeScope) && outputScope ? me.groupTakeScope.filter((id) => outputScope.includes(id)) : undefined
      set({ me: { name: me.name, role: me.role, ...(outputScope ? { outputScope } : {}), ...(groupTakeScope ? { groupTakeScope } : {}) }, paused: me.paused === true })
      await invoke("join_connect", { address, token })
      connectRetry = 0
    } catch (e) {
      const message = String(e)
      if (message.includes("pair again")) {
        gaps = []
        set({ status: "refused", error: message, me: null, live: null, paused: false, note: null, receivedAt: 0, clockSkewMs: null })
      } else {
        set({ status: "reconnecting", error: message })
        // Tried again (#411 Companion hunt): a host not yet started, or the network down for a
        // moment at start, left it on "Reconnecting…" for good (the host's follow loop runs only
        // once a connect has succeeded). Backs off to 30 s; stops once Left, refused or connected.
        connectRetry = Math.min(30_000, connectRetry ? connectRetry * 2 : 5_000)
        if (retryTimer) clearTimeout(retryTimer)
        retryTimer = setTimeout(() => {
          retryTimer = null
          const { joinAddress, joinToken } = useSettingsStore.getState()
          if (get().status === "reconnecting" && joinAddress && joinToken) void get().connect()
        }, connectRetry)
      }
    }
  },
  leave: async (forget = false) => {
    await invoke("join_disconnect").catch(() => {})
    gaps = []
    set({ status: "off", live: null, me: null, error: null, paused: false, note: null, clockSkewMs: null, secure: null })
    if (forget) useSettingsStore.getState().setJoin({ joinAddress: "", joinToken: "", joinSecure: null })
  },
  send: async (command) => {
    const { joinAddress: address, joinToken: token } = useSettingsStore.getState()
    const { service: expectedService, ...payload } = command
    try {
      const service = expectedService !== undefined ? expectedService ?? undefined : serviceOf(get().live)
      const response = await invoke<unknown>("join_command", { address, token, command: withWhatWasSeen(payload, get().live), service })
      set({ error: null, note: null })
      const value = response && typeof response === "object" && !Array.isArray(response) ? response as Record<string, unknown> : null
      const note = typeof response === "string" ? response : typeof value?.note === "string" ? value.note : undefined
      const revision = Number.isSafeInteger(value?.revision) && (value?.revision as number) >= 0 ? value?.revision as number : undefined
      return { ok: true, ...(note ? { note } : {}), ...(revision !== undefined ? { revision } : {}) }
    } catch (e) {
      const msg = String(e)
      // join_command marks the two refusals this desk handles itself (src-tauri/src/commands/join.rs).
      if (msg.startsWith("paused:")) {
        set({ paused: true, error: null })
        return { ok: false, error: msg.slice("paused:".length).trim() || "The main desk has taken back control" }
      }
      // Someone changed that part of the service first (#196 R7): nothing was done; this desk's
      // view is already following the change, so the operator looks again.
      if (msg.startsWith("stale:")) {
        const why = msg.slice("stale:".length).trim() || STALE_MESSAGE
        set({ error: why, note: null })
        return { ok: false, error: why, stale: true }
      }
      if (msg.startsWith("other-service:")) {
        set({ error: null, note: OTHER_SERVICE_NOTE })
        void get().connect()
        return { ok: false, error: "The main desk is on a different service now" }
      }
      set({ error: msg })
      return { ok: false, error: msg }
    }
  },
}))

/** What pairing gives back (src-tauri/src/commands/join.rs `Paired`). */
type Paired = { token: string; secure: { port: number; fingerprint: string } | null }

/** A joined desk may send commands: connected, and the main desk has not taken back control. */
export const useCanSend = () => useJoin((s) => s.status === "connected" && !s.paused)

/**
 * Look something up in the host's library (desk consoles, #197): `{ what: "translations" }`,
 * `{ what: "chapter", translation, book, chapter }`, `{ what: "search", query, translation }` or
 * `{ what: "songs", query }`. The host checks this desk's role; a refusal is thrown in its words.
 * Read only: nothing on the host changes.
 */
export async function lookupOnHost<T>(asked: Record<string, unknown>): Promise<T> {
  const { joinAddress: address, joinToken: token } = useSettingsStore.getState()
  return invoke<T>("join_lookup", { address, token, asked })
}

export type DeskApprovalState = "submitted" | "approved" | "declined" | "requested_changes" | "applied" | "expired" | "withdrawn" | "superseded"
export interface DeskApprovalRequest {
  id: string
  kind: string
  targetId: string
  baseRevision: number | null
  state: DeskApprovalState
  reason: string | null
  createdAt: string
  expiresAt: string
  decidedBy: string | null
  decidedAt: string | null
  decisionNote: string | null
}

const APPROVAL_STATES: readonly DeskApprovalState[] = ["submitted", "approved", "declined", "requested_changes", "applied", "expired", "withdrawn", "superseded"]

function readDeskApprovalRequest(value: unknown): DeskApprovalRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The host returned a malformed approval request.")
  const row = value as Record<string, unknown>
  if (typeof row.id !== "string" || typeof row.kind !== "string" || typeof row.targetId !== "string" || !APPROVAL_STATES.includes(row.state as DeskApprovalState)
    || !(row.baseRevision === null || (typeof row.baseRevision === "number" && Number.isSafeInteger(row.baseRevision)))
    || !(row.reason === null || typeof row.reason === "string")
    || typeof row.createdAt !== "string" || typeof row.expiresAt !== "string"
    || !(row.decidedBy === null || typeof row.decidedBy === "string")
    || !(row.decidedAt === null || typeof row.decidedAt === "string")
    || !(row.decisionNote === null || typeof row.decisionNote === "string")) {
    throw new Error("The host returned a malformed approval request.")
  }
  return row as unknown as DeskApprovalRequest
}

/** The host returns only this paired desk's own request metadata, without the request payload. */
export async function loadMyApprovalRequests(): Promise<DeskApprovalRequest[]> {
  const { joinAddress: address, joinToken: token } = useSettingsStore.getState()
  const response = await invoke<{ requests: unknown[] }>("join_requests", { address, token })
  if (!response || !Array.isArray(response.requests) || response.requests.length > 100) throw new Error("The host returned an invalid request list.")
  return response.requests.map(readDeskApprovalRequest)
}

/** Withdraw a request only while it remains undecided on the host. */
export async function withdrawMyApprovalRequest(id: string): Promise<DeskApprovalRequest> {
  const { joinAddress: address, joinToken: token } = useSettingsStore.getState()
  const request = readDeskApprovalRequest(await invoke<unknown>("join_withdraw_request", { address, token, id }))
  if (request.id !== id || request.state !== "withdrawn") throw new Error("The host did not confirm this request as withdrawn.")
  return request
}
