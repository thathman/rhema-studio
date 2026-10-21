/**
 * Display outputs point at a monitor by its index in the OS list. When a
 * projector cable is pulled, or two outputs share one monitor, the operator
 * should hear it from readiness before the service, not from a blank wall.
 */
export interface DisplayOutputRef {
  name: string
  type: "display" | "ndi"
  monitorIndex: number
  monitorName?: string | null
}

/**
 * Where an output's monitor is now, given the connected monitors' names in OS
 * order: by name (the index renumbers when another monitor goes away), the
 * saved index when the name is unknown or shared. Null when it is not connected.
 */
export function resolveMonitorIndex(o: Pick<DisplayOutputRef, "monitorIndex" | "monitorName">, names: (string | null)[]): number | null {
  if (!o.monitorName) return o.monitorIndex < names.length ? o.monitorIndex : null
  if (names[o.monitorIndex] === o.monitorName) return o.monitorIndex
  const at = names.indexOf(o.monitorName)
  return at === -1 ? null : at
}

export interface MonitorProblems {
  /** Display outputs whose monitor is not connected now. */
  missing: string[]
  /** Groups of display outputs set to the same monitor (they would cover each other). */
  shared: string[][]
}

export function monitorProblems(outputs: DisplayOutputRef[], monitors: number | (string | null)[]): MonitorProblems {
  const names = typeof monitors === "number" ? Array.from({ length: monitors }, () => null) : monitors
  const displays = outputs.filter((o) => o.type === "display")
  const at = (o: DisplayOutputRef) => resolveMonitorIndex(typeof monitors === "number" ? { monitorIndex: o.monitorIndex } : o, names)
  const missing = displays.filter((o) => at(o) === null).map((o) => o.name)
  const byMonitor = new Map<number, string[]>()
  for (const o of displays) {
    const i = at(o)
    if (i === null) continue
    byMonitor.set(i, [...(byMonitor.get(i) ?? []), o.name])
  }
  const shared = [...byMonitor.values()].filter((names) => names.length > 1)
  return { missing, shared }
}
