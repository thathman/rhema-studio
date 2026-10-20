import type { VerseRenderData } from "@/types"

/** Which picture a signage loop shows now: `seconds` per picture, round-robin, from when the loop started. */
export function signageIndex(count: number, startedAtMs: number, nowMs: number, seconds: number): number {
  if (count <= 0) return -1
  const per = Math.max(1, seconds) * 1000
  const elapsed = Math.max(0, nowMs - startedAtMs)
  return Math.floor(elapsed / per) % count
}

/** A full-frame picture, drawn by the same renderer as picture items. */
export function signageFrame(url: string): VerseRenderData {
  return { kind: "image", reference: "", segments: [], image: { url, fit: "cover", blur: 0, brightness: 100, tint: null } }
}
