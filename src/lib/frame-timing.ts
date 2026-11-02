/**
 * The recorder's timing headers for a frame pushed from an output window (#626): when the canvas
 * was drawn (`Date.now()` at the draw) and the running count of frames the page drew but could not
 * send. Plain decimal integers, as the host reads them; a canvas never drawn sends no draw time.
 */
export function frameTiming(drawnAtMs: number, skipped: number): Record<string, string> {
  const headers: Record<string, string> = { "x-frames-skipped": String(Math.max(0, Math.floor(skipped))) }
  if (Number.isFinite(drawnAtMs) && drawnAtMs > 0) headers["x-frame-drawn-at"] = String(Math.floor(drawnAtMs))
  return headers
}
