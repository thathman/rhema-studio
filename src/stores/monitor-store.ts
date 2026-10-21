import { create } from "zustand"
import { availableMonitors } from "@tauri-apps/api/window"
import { toast } from "sonner"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { resolveMonitorIndex } from "@/lib/monitor-health"
import { reconcileOutputStatus } from "@/lib/broadcast-output-control"

interface MonitorState {
  /** Monitors connected now; null until the first check (or outside Tauri). */
  count: number | null
  /** Their names in OS order (null when the OS gives none). */
  names: (string | null)[]
}

export const useMonitorStore = create<MonitorState>(() => ({ count: null, names: [] }))

const POLL_MS = 5000

/**
 * Watch the monitor count while the app runs. When a monitor an on-air
 * display output uses goes away, say so at once (the window cannot show
 * anything there); readiness keeps the warning until it is back or changed.
 */
async function check(): Promise<void> {
  // An output window closed from the OS (Alt+F4) or an NDI sender that stopped: the status
  // everyone reads (Present, Home readiness) catches up here, not only while Outputs is open.
  const b0 = useBroadcastStore.getState()
  for (const o of b0.outputs) if (b0.outputStatus[o.id]?.previewOpen || b0.outputStatus[o.id]?.ndiActive) void reconcileOutputStatus(o)
  let names: (string | null)[]
  try {
    names = (await availableMonitors()).map((m) => m.name ?? null)
  } catch {
    return // not under Tauri (tests, browser shim)
  }
  const count = names.length
  const prev = useMonitorStore.getState().count
  if (prev === count && useMonitorStore.getState().names.join("\u0000") === names.join("\u0000")) return
  useMonitorStore.setState({ count, names })
  if (prev === null || count >= prev) return
  const b = useBroadcastStore.getState()
  const lost = b.outputs.filter((o) => o.type === "display" && resolveMonitorIndex(o, names) === null && b.outputStatus[o.id]?.previewOpen)
  for (const o of lost) toast.error(`${o.name}: its monitor was disconnected`, { description: "Check the cable or choose another monitor in Outputs." })
}

if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
  void check()
  setInterval(() => void check(), POLL_MS)
}
