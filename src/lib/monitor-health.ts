/**
 * Display outputs point at a monitor by its index in the OS list. When a
 * projector cable is pulled, or two outputs share one monitor, the operator
 * should hear it from readiness before the service, not from a blank wall.
 */
export interface DisplayOutputRef {
  name: string
  type: "display" | "ndi"
  monitorIndex: number
}

export interface MonitorProblems {
  /** Display outputs whose monitor is not connected now. */
  missing: string[]
  /** Groups of display outputs set to the same monitor (they would cover each other). */
  shared: string[][]
}

export function monitorProblems(outputs: DisplayOutputRef[], monitorCount: number): MonitorProblems {
  const displays = outputs.filter((o) => o.type === "display")
  const missing = displays.filter((o) => o.monitorIndex >= monitorCount).map((o) => o.name)
  const byMonitor = new Map<number, string[]>()
  for (const o of displays) {
    if (o.monitorIndex >= monitorCount) continue
    byMonitor.set(o.monitorIndex, [...(byMonitor.get(o.monitorIndex) ?? []), o.name])
  }
  const shared = [...byMonitor.values()].filter((names) => names.length > 1)
  return { missing, shared }
}
