/**
 * Draw a frame off screen and copy it to the output only when drawing
 * succeeded (PRD FR-04 "last-good frame"). If the renderer throws (a broken
 * picture, a damaged theme), the projector and NDI keep the previous frame
 * instead of going blank.
 */
export function paintFrame(
  target: HTMLCanvasElement,
  scratch: HTMLCanvasElement,
  width: number,
  height: number,
  render: (ctx: CanvasRenderingContext2D) => void
): boolean {
  const sctx = scratch.getContext("2d")
  const tctx = target.getContext("2d")
  if (!sctx || !tctx) return false
  try {
    // Resizing reallocates the canvas (8 MB at 1080p); at the same size, clearing is enough.
    if (scratch.width !== width || scratch.height !== height) {
      scratch.width = width
      scratch.height = height
    } else {
      sctx.setTransform(1, 0, 0, 1, 0, 0)
      sctx.globalAlpha = 1
      sctx.clearRect(0, 0, width, height)
    }
    render(sctx)
  } catch (e) {
    console.error("[broadcast-output] frame failed to draw; keeping the last good frame", e)
    return false
  }
  if (target.width !== width) target.width = width
  if (target.height !== height) target.height = height
  tctx.clearRect(0, 0, width, height)
  tctx.drawImage(scratch, 0, 0)
  return true
}
