/**
 * Slide-change latency for QA-007 ("slide action latency logged"): the time
 * from the main window sending a new screen to an output window having drawn
 * it. Kept in batches so the log file stays readable: a summary line every
 * BATCH changes, and any single slow change on its own.
 */
export const BATCH = 20
export const SLOW_MS = 100

export function createLatencyLog(name: string) {
  let samples: number[] = []
  return {
    /** Record one change; returns the lines to log (none, a slow-change warning and/or a batch summary). */
    record(ms: number): { warn?: string; info?: string } {
      const out: { warn?: string; info?: string } = {}
      const v = Math.max(0, Math.round(ms))
      if (v > SLOW_MS) out.warn = `[latency] ${name}: a screen change took ${v} ms`
      samples.push(v)
      if (samples.length >= BATCH) {
        const sorted = [...samples].sort((a, b) => a - b)
        out.info = `[latency] ${name}: ${sorted.length} screen changes, median ${sorted[Math.floor(sorted.length / 2)]} ms, slowest ${sorted[sorted.length - 1]} ms`
        samples = []
      }
      return out
    },
  }
}
