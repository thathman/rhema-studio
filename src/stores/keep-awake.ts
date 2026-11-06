import { invoke } from "@tauri-apps/api/core"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useEventClock } from "@/stores/event-clock-store"
import { useTimerStore } from "@/stores/timer-store"

/**
 * While the service runs this computer and its screens stay awake (#411 timing hunt): an idle Mac
 * slept through a quiet sermon, its clock stopped, and every timer lost that time, so the pastor
 * saw too much time left. "Runs" is not only On air: the screens are often off air for the sermon
 * while the service clock and timer keep going. Any output on, the event clock or the timer running.
 */
export function serviceRunning(): boolean {
  const b = useBroadcastStore.getState()
  const outputOn = Object.values(b.outputStatus).some((s) => s?.previewOpen || s?.ndiActive || s?.feedActive)
  return b.isLive || outputOn || useEventClock.getState().currentId !== null || useTimerStore.getState().timer.startedAt !== null
}

let held: boolean | null = null
function sync(): void {
  const on = serviceRunning()
  if (on === held) return
  held = on
  void invoke("keep_awake", { on }).catch(() => {})
}

sync()
useBroadcastStore.subscribe(sync)
useEventClock.subscribe(sync)
useTimerStore.subscribe(sync)
