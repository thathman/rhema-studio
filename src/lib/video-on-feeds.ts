import { followsOnlyOverlays } from "@/lib/live-sources"
import { outputOnAir } from "@/lib/output-on-air"
import { sceneForOutput } from "@/lib/scenes"
import type { BroadcastOutput, BroadcastOutputStatus, Scene } from "@/types"

/**
 * A video item plays on screens and NDI but not on a browser feed: its file stays on this computer,
 * so a TV or browser page shows only the background while it plays (seen on the Onn TV, 11 Nov).
 * The congregation feeds on air that follow Program (no scene of their own, not overlays only).
 */
export function feedsWithoutVideo(
  outputs: readonly BroadcastOutput[],
  status: Record<string, Partial<BroadcastOutputStatus> | undefined>,
  scenes: readonly Scene[],
): string[] {
  return outputs
    .filter((o) => o.type === "browser" && (o.role ?? "congregation") === "congregation" && outputOnAir(o, status[o.id]))
    .filter((o) => !followsOnlyOverlays(o) && !sceneForOutput(o, scenes))
    .map((o) => o.name)
}

/** The operator's line for them, or null when every screen shows the video. */
export function videoOnFeedsWarning(video: string, feeds: readonly string[]): string | null {
  if (feeds.length === 0) return null
  const where = feeds.length === 1 ? feeds[0] : `${feeds.slice(0, -1).join(", ")} and ${feeds[feeds.length - 1]}`
  return `${where} ${feeds.length === 1 ? "shows" : "show"} only the background while "${video}" plays: videos play on screens and NDI, not on TVs or browser pages. To show it there, put the video in a scene's video layer.`
}
