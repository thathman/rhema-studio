import { invoke } from "@tauri-apps/api/core"
import { useBroadcastStore } from "@/stores/broadcast-store"

/**
 * While the service is live this computer and its screens stay awake (#411 timing hunt): an idle
 * Mac slept through a quiet sermon, its clock stopped, and every timer lost that time, so the
 * pastor saw too much time left. Released when the service is no longer live.
 */
export function syncKeepAwake(live: boolean): void {
  void invoke("keep_awake", { on: live }).catch(() => {})
}

syncKeepAwake(useBroadcastStore.getState().isLive)
useBroadcastStore.subscribe((s, prev) => { if (s.isLive !== prev.isLive) syncKeepAwake(s.isLive) })
