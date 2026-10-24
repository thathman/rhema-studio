import { create } from "zustand"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import type { LiveStateV1 } from "@/lib/live-state"
import { useSettingsStore } from "@/stores/settings-store"

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
  me: { name: string; role: string } | null
  /** The main desk has taken back control (#243): this desk still follows and talks, its commands wait. */
  paused: boolean
  /** A passing note that is not an error (the host moved to another service and this desk refreshed). */
  note: string | null
  live: LiveStateV1 | null
  /** This desk's monotonic time when `live` arrived: a running timer counts on from it (no clock skew). */
  receivedAt: number
  /**
   * How far this desk's wall clock is from the host's (ms, + = this one ahead), from the Live
   * State's "at": the smallest gap of the last few arrivals, so a snapshot that waited does not
   * count as skew. Null until one arrives.
   */
  clockSkewMs: number | null
  pair: (address: string, code: string, name: string) => Promise<void>
  connect: () => Promise<void>
  leave: (forget?: boolean) => Promise<void>
  /**
   * A host command (the event clock, …): refused by the host if the role does not allow it, if the
   * main desk has taken back control, or if it is for another service. Says whether the host did it,
   * and if not, why in the host's words.
   */
  send: (command: { command: string; value?: string | number | Record<string, unknown> }) => Promise<SendResult>
}

export type SendResult = { ok: true } | { ok: false; error: string }

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
      useJoin.setState({ live, receivedAt: performance.now(), clockSkewMs: gaps.length ? Math.min(...gaps) : null, status: "connected", error: null, paused })
    } catch {
      // A snapshot this build cannot read: keep the last one.
    }
  })
  await listen<string>("join:state", (e) => {
    try {
      const p = JSON.parse(e.payload) as { state: string; error?: string }
      const status: JoinStatus = p.state === "connected" ? "connected" : p.state === "reconnecting" ? "reconnecting" : p.state === "refused" ? "refused" : "off"
      useJoin.setState({ status, error: p.error ?? null })
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
  live: null,
  receivedAt: 0,
  clockSkewMs: null,
  pair: async (address, code, name) => {
    set({ status: "connecting", error: null })
    try {
      const token = await invoke<string>("join_pair", { address, code, name })
      useSettingsStore.getState().setJoin({ joinAddress: address.trim(), joinName: name.trim(), joinToken: token })
      await get().connect()
    } catch (e) {
      set({ status: "off", error: String(e) })
    }
  },
  connect: async () => {
    const { joinAddress: address, joinToken: token } = useSettingsStore.getState()
    if (!address || !token) return
    await listenOnce()
    gaps = []
    set({ status: "connecting", error: null, clockSkewMs: null })
    try {
      const me = await invoke<{ name: string; role: string; paused?: boolean }>("join_me", { address, token })
      set({ me: { name: me.name, role: me.role }, paused: me.paused === true })
      await invoke("join_connect", { address, token })
    } catch (e) {
      set({ status: String(e).includes("pair again") ? "refused" : "reconnecting", error: String(e) })
    }
  },
  leave: async (forget = false) => {
    await invoke("join_disconnect").catch(() => {})
    gaps = []
    set({ status: "off", live: null, me: null, error: null, paused: false, note: null, clockSkewMs: null })
    if (forget) useSettingsStore.getState().setJoin({ joinAddress: "", joinToken: "" })
  },
  send: async (command) => {
    const { joinAddress: address, joinToken: token } = useSettingsStore.getState()
    try {
      await invoke("join_command", { address, token, command, service: serviceOf(get().live) })
      set({ error: null, note: null })
      return { ok: true }
    } catch (e) {
      const msg = String(e)
      // join_command marks the two refusals this desk handles itself (src-tauri/src/commands/join.rs).
      if (msg.startsWith("paused:")) {
        set({ paused: true, error: null })
        return { ok: false, error: msg.slice("paused:".length).trim() || "The main desk has taken back control" }
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
