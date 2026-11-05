import { create } from "zustand"
import { availableMonitors, primaryMonitor } from "@tauri-apps/api/window"
import { toast } from "sonner"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { resolveMonitorIndex } from "@/lib/monitor-health"
import { disableOutput, enableOutput, reconcileOutputStatus } from "@/lib/broadcast-output-control"

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
export async function check(): Promise<void> {
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
  if (prev === null) return
  const b = useBroadcastStore.getState()
  const screens = b.outputs.filter((x) => x.type === "display")
  // Its screen came back: put it on air there again, as it was (#411 hot-plug).
  for (const id of [...waitingForScreen]) {
    const o = b.outputs.find((x) => x.id === id)
    if (!o || o.type !== "display" || b.outputStatus[id]?.previewOpen) { waitingForScreen.delete(id); continue }
    if (resolveMonitorIndex(o, names, screens) === null) continue
    waitingForScreen.delete(id)
    // Refused (the screen went again in between) or the window did not open: still waiting, unless
    // the operator turned it on meanwhile.
    if (!(await enableOutput(o))) { if (!useBroadcastStore.getState().outputStatus[id]?.previewOpen) waitingForScreen.add(id); continue }
    // Its screen may have gone again while it opened (a cable flapping): never left on another screen.
    const now = useMonitorStore.getState().names
    if (resolveMonitorIndex(o, now, screens) === null) { void offUntilScreen(o); continue }
    toast.success(`${o.name} is back on its screen`)
  }
  if (count >= prev) return
  // A screen an on-air output used went away. The OS would move its window onto a screen that is
  // left (the operator's), showing the congregation's picture there; it is closed instead and comes
  // back when its screen does. A movable window (windowed) is the operator's to place: left alone.
  const lost = screens.filter((o) => o.windowed !== true && resolveMonitorIndex(o, names, screens) === null && b.outputStatus[o.id]?.previewOpen)
  // Screens of one name cannot be told apart once one goes: say so only, never turn off the wrong one.
  const twins = (o: (typeof screens)[number]) => screens.some((x) => x.id !== o.id && x.monitorName && x.monitorName === o.monitorName)
  for (const o of lost.filter(twins)) toast.error(`${o.name}: a screen was disconnected`, { description: "Check the cable or choose another screen in Outputs." })
  for (const o of lost.filter((x) => !twins(x))) {
    void offUntilScreen(o)
    toast.error(`${o.name}: its screen was disconnected`, { description: "It is off until that screen is back, then it comes back on by itself. Check the cable, or choose another screen in Outputs." })
  }
}

/** Outputs turned off because their screen went away, to put back on air when it returns. */
const waitingForScreen = new Set<string>()
/** Off now, waiting for its screen (only once it is off: while on, it would read as the operator's choice). */
async function offUntilScreen(o: Parameters<typeof disableOutput>[0]): Promise<void> {
  if (await disableOutput(o)) waitingForScreen.add(o.id)
}
// The operator's own choice wins: turned on (anywhere), removed or pointed at another screen, it is
// no longer waiting, so it never comes back on air by itself after they decided.
useBroadcastStore.subscribe((s, prev) => {
  for (const id of [...waitingForScreen]) {
    const o = s.outputs.find((x) => x.id === id)
    const was = prev.outputs.find((x) => x.id === id)
    if (!o || s.outputStatus[id]?.previewOpen || (was && (was.monitorName !== o.monitorName || was.monitorIndex !== o.monitorIndex))) waitingForScreen.delete(id)
  }
})

if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
  void check()
  setInterval(() => void check(), POLL_MS)
}
