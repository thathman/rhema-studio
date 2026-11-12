// Layer rotation (#851 G7): the design editor turns a layer about its box's centre; every output
// turns it the same way. One normalisation, so the editor's save and every output agree.

/**
 * A layer's turn in degrees clockwise, in (-180, 180] and rounded to 0.01°; undefined when it is
 * upright or not a finite number.
 */
export function layerRotation(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined
  let deg = Math.round(((((raw % 360) + 540) % 360) - 180) * 100) / 100
  if (deg <= -180) deg = 180
  return Math.abs(deg) < 0.01 ? undefined : deg
}

/** Turn `ctx` about `pivot` by `rotation` degrees clockwise (nothing when upright). */
export function turnAbout(ctx: CanvasRenderingContext2D, pivot: { x: number; y: number }, rotation: number | undefined): void {
  if (!rotation) return
  ctx.translate(pivot.x, pivot.y)
  ctx.rotate((rotation * Math.PI) / 180)
  ctx.translate(-pivot.x, -pivot.y)
}

/**
 * Whether a point lies in a box turned `rotation` degrees clockwise about `pivot` (all in the same
 * pixel space): the point is turned back into the box's own space first. For hit-testing a turned
 * layer where the canvas draws it.
 */
export function pointInTurnedBox(p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }, pivot: { x: number; y: number }, rotation: number | undefined): boolean {
  let { x, y } = p
  if (rotation) {
    const rad = (-rotation * Math.PI) / 180
    const dx = x - pivot.x, dy = y - pivot.y
    x = pivot.x + dx * Math.cos(rad) - dy * Math.sin(rad)
    y = pivot.y + dx * Math.sin(rad) + dy * Math.cos(rad)
  }
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
}

/**
 * Whether a layer of this kind can be turned on outputs. Cameras and videos play in windows of
 * their own over or under the frame, and a browser feed draws a running ticker as a strip of its
 * own: none of those can turn yet, so they stay upright.
 */
export function layerTurns(kind: string): boolean {
  return kind !== "camera" && kind !== "video" && kind !== "ticker"
}
