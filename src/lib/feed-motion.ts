import { entranceProgress } from "@/lib/lower-third-style"
import { sceneMoving } from "@/lib/scene-renderer"
import type { LowerThird, SceneBox, SceneFrame, SceneLayerFrame, Ticker } from "@/types"

/**
 * What moves on a browser feed (#198, perf-001), so a TV redraws only that: the whole picture, or
 * only the ticker strips over it. Kept apart from the page so it can be tested.
 */

const overlaps = (a: SceneBox, b: SceneBox) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** A layer that paints nothing right now (an empty ticker or lower-third box, or one made fully see-through). */
const paintsNothing = (l: SceneLayerFrame) => l.opacity <= 0 || (l.kind === "ticker" && !l.ticker) || (l.kind === "lowerThird" && !l.overlay)

/**
 * The scene's ticker layers that crawl on strips of their own over the canvas. Correctness first:
 * a ticker layer gets a strip only when it is the top-most layer in its area, that is, nothing
 * that paints is above it and overlaps its box (except another ticker on a strip, which keeps its
 * place). Any other ticker layer is drawn in the canvas, in its place, as on an output window.
 * `overFrame`: something is drawn over the whole picture (the frame's own lower third, which the
 * scene does not own): no strips while it is up.
 */
export function tickerStrips(scene: SceneFrame | undefined, overFrame = false): Set<string> {
  const strips = new Set<string>()
  if (overFrame) return strips
  const layers = scene?.layers ?? []
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i]
    if (l.kind !== "ticker" || !l.ticker) continue
    const covered = layers.slice(i + 1).some((a) => !strips.has(a.id) && !paintsNothing(a) && overlaps(a.box, l.box))
    if (!covered) strips.add(l.id)
  }
  return strips
}

export interface FeedMotionFrame {
  off?: boolean
  ticker?: Ticker | null
  overlay?: LowerThird | null
  scene?: SceneFrame
}

export interface FeedMotionState {
  /** This machine's clock (ms), for the lower third coming in. */
  now: number
  /** The host's clock (ms), for the scene's own layers. */
  hostNow: number
  /** A scene change is cross-fading. */
  fading: boolean
  /** A camera is copied into the canvas (cropped, so not shown under it). */
  cameraInCanvas: boolean
  /** The scene's ticker layers on strips of their own (see `tickerStrips`). */
  strips: ReadonlySet<string>
  /** A countdown display pulses or blends to a new step (otherwise it redraws once a second by itself). */
  countdown?: boolean
}

/**
 * picture: the main canvas changes every frame (a fade, a camera drawn into it, a lower third
 * coming in, a ticker layer that has to stay in the canvas); crawl: only a ticker strip moves.
 * Neither: the page draws nothing until the next frame from the host.
 */
export function feedMotion(f: FeedMotionFrame | null, s: FeedMotionState): { picture: boolean; crawl: boolean } {
  if (!f || f.off) return { picture: false, crawl: false }
  const picture = !!s.countdown || s.fading || s.cameraInCanvas || (!!f.overlay && entranceProgress(f.overlay, s.now) < 1) || sceneMoving(f.scene, s.hostNow, (id) => s.strips.has(id))
  const crawl = (!!f.ticker && !f.ticker.pausedAt) || !!f.scene?.layers.some((l) => s.strips.has(l.id) && l.opacity > 0 && !!l.ticker && !l.ticker.pausedAt)
  return { picture, crawl }
}
