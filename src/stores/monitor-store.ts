import { create } from "zustand"
import { availableMonitors } from "@tauri-apps/api/window"
import { toast } from "sonner"
import { useBroadcastStore } from "@/stores/broadcast-store"

interface MonitorState {
  /** Monitors connected now; null until the first check (or outside Tauri). */
  count: number | null
}

export const useMonitorStore = create<MonitorState>(() => ({ count: null }))

const POLL_MS = 5000

/**
 * Watch the monitor count while the app runs. When a monitor an on-air
 * display output uses goes away, say so at once (the window cannot show
 * anything there); readiness keeps the warning until it is back or changed.
 */
async function check(): Promise<void> {
  let count: number
  try {
    count = (await availableMonitors()).length
  } catch {
    return // not under Tauri (tests, browser shim)
  }
  const prev = useMonitorStore.getState().count
  if (prev === count) return
  useMonitorStore.setState({ count })
  if (prev === null || count >= prev) return
  const b = useBroadcastStore.getState()
  const lost = b.outputs.filter((o) => o.type === "display" && o.monitorIndex >= count && b.outputStatus[o.id]?.previewOpen)
  for (const o of lost) toast.error(`${o.name}: its monitor was disconnected`, { description: "Check the cable or choose another monitor in Outputs." })
}

if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
  void check()
  setInterval(() => void check(), POLL_MS)
}
