import { invoke } from "@tauri-apps/api/core"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"

/** This computer's address on the church network now, or null (no network, or not the desktop app). */
export async function lanAddressNow(): Promise<string | null> {
  try {
    const ip = await invoke<string | null>("remote_lan_address")
    return typeof ip === "string" && ip ? ip : null
  } catch {
    return null
  }
}

/**
 * Remember the address each time a service goes live for real (not rehearsal), so the next
 * preflight can say when it changed (#213): phones, TVs, OBS and desks saved the old one.
 */
let started = false
export function watchLanAddressAtService(): void {
  if (started) return
  started = true
  useBroadcastStore.subscribe((s, p) => {
    if (!s.isLive || p.isLive || s.rehearsal) return
    void lanAddressNow().then((ip) => {
      if (ip && useSettingsStore.getState().lanAddressAtService !== ip) useSettingsStore.setState({ lanAddressAtService: ip })
    })
  })
}
