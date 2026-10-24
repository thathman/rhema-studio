import { NOISE_FPS } from "@/lib/no-signal"

/**
 * How many frames a second an output window's pacer draws (0 = it stops): at the NDI rate while
 * something moves on NDI; on a screen, 30 while a camera plays or a layer fades, NOISE_FPS while a
 * camera shows static, one a second for a running clock, else none (nothing to redraw).
 */
export function outputPace(s: { ndi: boolean; ndiFps: number; moving: boolean; cameraPlaying: boolean; fading: boolean; staticShown: boolean; clockRunning: boolean }): number {
  if (s.ndi && s.moving) return Math.max(15, s.ndiFps || 30)
  if (s.cameraPlaying || s.fading) return 30
  if (s.staticShown) return NOISE_FPS
  return s.clockRunning ? 1 : 0
}
