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

/** Turn `ctx` about the centre of `r` by `rotation` degrees clockwise (nothing when upright). */
export function turnAbout(ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }, rotation: number | undefined): void {
  if (!rotation) return
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  ctx.translate(cx, cy)
  ctx.rotate((rotation * Math.PI) / 180)
  ctx.translate(-cx, -cy)
}

/**
 * Whether a layer of this kind can be turned on outputs. Cameras and videos play in windows of
 * their own over or under the frame, and a browser feed draws a running ticker as a strip of its
 * own: none of those can turn yet, so they stay upright.
 */
export function layerTurns(kind: string): boolean {
  return kind !== "camera" && kind !== "video" && kind !== "ticker"
}
