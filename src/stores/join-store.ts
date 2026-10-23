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
  live: LiveStateV1 | null
  pair: (address: string, code: string, name: string) => Promise<void>
  connect: () => Promise<void>
  leave: (forget?: boolean) => Promise<void>
  /** A host command (the event clock, …): refused by the host if the role does not allow it. */
  send: (command: { command: string; value?: string | number | Record<string, unknown> }) => Promise<void>
}

let listening = false
async function listenOnce() {
  if (listening) return
  listening = true
  await listen<string>("join:live", (e) => {
    try {
      const live = JSON.parse(e.payload) as LiveStateV1
      if (live?.v === 1) useJoin.setState({ live, status: "connected", error: null })
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
  live: null,
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
    set({ status: "connecting", error: null })
    try {
      const me = await invoke<{ name: string; role: string }>("join_me", { address, token })
      set({ me })
      await invoke("join_connect", { address, token })
    } catch (e) {
      set({ status: String(e).includes("pair again") ? "refused" : "reconnecting", error: String(e) })
    }
  },
  leave: async (forget = false) => {
    await invoke("join_disconnect").catch(() => {})
    set({ status: "off", live: null, me: null, error: null })
    if (forget) useSettingsStore.getState().setJoin({ joinAddress: "", joinToken: "" })
  },
  send: async (command) => {
    const { joinAddress: address, joinToken: token } = useSettingsStore.getState()
    try {
      await invoke("join_command", { address, token, command })
      set({ error: null })
    } catch (e) {
      set({ error: String(e) })
    }
  },
}))
