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
  me: { name: string; role: string; outputScope?: string[] } | null
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
  send: (command: { command: string; value?: string | number | Record<string, unknown>; seen?: Record<string, number> }) => Promise<SendResult>
}

/** `note`: what the host said about a command it took (a scene change sent to the main desk to accept). `stale`: the desk's copy of a scene was older than the host's. */
export type SendResult = { ok: true; note?: string } | { ok: false; error: string; stale?: true }

/** What a desk is told when someone changed that part of the service before its command arrived. */
export const STALE_MESSAGE = "Someone changed this first — look again"

/**
 * A command as this desk sends it: with the revisions of the Live State it acted on (`seen`, #196
 * R7), so the host can refuse it if someone changed that part first, and, for an Unable answer, the
 * reason this desk could not do what was asked (Comms, #251). Older hosts ignore both.
 */
export function withWhatWasSeen(command: { command: string; value?: unknown; seen?: Record<string, number> }, live: LiveStateV1 | null): Record<string, unknown> {
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
  await listen<string>("join:state", (e) => {
    try {
      const p = JSON.parse(e.payload) as { state: string; error?: string; secure?: boolean; me?: { name?: unknown; role?: unknown; paused?: unknown; outputScope?: unknown } | null }
      const status: JoinStatus = p.state === "connected" ? "connected" : p.state === "reconnecting" ? "reconnecting" : p.state === "refused" ? "refused" : "off"
      // Each (re)connection says what the host makes of this desk now: the main desk may have
      // changed its role or taken back control while it was away (the host ends the stream then).
      const me = p.me && typeof p.me.name === "string" && typeof p.me.role === "string" ? { me: { name: p.me.name, role: p.me.role, ...(Array.isArray(p.me.outputScope) && p.me.outputScope.every((id) => typeof id === "string") ? { outputScope: p.me.outputScope } : {}) }, paused: p.me.paused === true } : {}
      useJoin.setState({ status, error: p.error ?? null, ...(typeof p.secure === "boolean" ? { secure: p.secure } : {}), ...me })
    } catch {
      // ignore
    }
  })
}

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
      const me = await invoke<{ name: string; role: string; paused?: boolean; outputScope?: string[] | null }>("join_me", { address, token })
      set({ me: { name: me.name, role: me.role, ...(Array.isArray(me.outputScope) ? { outputScope: me.outputScope } : {}) }, paused: me.paused === true })
      await invoke("join_connect", { address, token })
    } catch (e) {
      set({ status: String(e).includes("pair again") ? "refused" : "reconnecting", error: String(e) })
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
    try {
      const note = await invoke<string | null>("join_command", { address, token, command: withWhatWasSeen(command, get().live), service: serviceOf(get().live) })
      set({ error: null, note: null })
      return typeof note === "string" && note ? { ok: true, note } : { ok: true }
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
