import { create } from "zustand"
import { availableMonitors, primaryMonitor } from "@tauri-apps/api/window"
import { toast } from "sonner"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { resolveMonitorIndex } from "@/lib/monitor-health"
import { reconcileOutputStatus } from "@/lib/broadcast-output-control"

interface MonitorState {
  /** Monitors connected now; null until the first check (or outside Tauri). */
  count: number | null
  /** Their names in OS order (null when the OS gives none). */
  names: (string | null)[]
  /** Each monitor's size in physical pixels and scale, in the same order; empty until known. */
  sizes: MonitorSize[]
  /** Which of them is this computer's main screen (the menu bar / taskbar), or null when not known. */
  primary: number | null
}

export interface MonitorSize {
  width: number
  height: number
  scale: number
}

export const useMonitorStore = create<MonitorState>(() => ({ count: null, names: [], sizes: [], primary: null }))

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
  for (const o of b0.outputs) if (o.type !== "browser" && (b0.outputStatus[o.id]?.previewOpen || b0.outputStatus[o.id]?.ndiActive)) void reconcileOutputStatus(o)
  let names: (string | null)[]
  let sizes: MonitorSize[]
  let primary: number | null = null
  try {
    const monitors = await availableMonitors()
    names = monitors.map((m) => m.name ?? null)
    sizes = monitors.map((m) => ({ width: m.size.width, height: m.size.height, scale: m.scaleFactor }))
    const p = await primaryMonitor().catch(() => null)
    if (p) {
      const at = monitors.findIndex((m) => m.name === p.name && m.position.x === p.position.x && m.position.y === p.position.y)
      primary = at === -1 ? null : at
    }
  } catch {
    return // not under Tauri (tests, browser shim)
  }
  const count = names.length
  const prev = useMonitorStore.getState().count
  const was = useMonitorStore.getState()
  if (prev === count && was.names.join("\u0000") === names.join("\u0000") && was.primary === primary && JSON.stringify(was.sizes) === JSON.stringify(sizes)) return
  useMonitorStore.setState({ count, names, sizes, primary })
  if (prev === null || count >= prev) return
  const b = useBroadcastStore.getState()
  const lost = b.outputs.filter((o) => o.type === "display" && resolveMonitorIndex(o, names, b.outputs.filter((x) => x.type === "display")) === null && b.outputStatus[o.id]?.previewOpen)
  for (const o of lost) toast.error(`${o.name}: its monitor was disconnected`, { description: "Check the cable or choose another monitor in Outputs." })
}

if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
  void check()
  setInterval(() => void check(), POLL_MS)
}
