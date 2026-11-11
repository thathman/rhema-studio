import { feedFrame, followsOnlyOverlays, type LiveSources } from "@/lib/live-sources"
import { outputOnAir } from "@/lib/output-on-air"
import { sceneForOutput } from "@/lib/scenes"
import type { BroadcastOutput, BroadcastOutputStatus, Scene, VerseRenderData } from "@/types"
import type { FeedSourceKind } from "@/types/broadcast"

/** What decides what each feed shows. */
export interface FeedVideoState {
  isLive: boolean
  liveVerse: VerseRenderData | null
  sources: LiveSources
  outputs: readonly BroadcastOutput[]
  outputStatus: Record<string, Partial<BroadcastOutputStatus> | undefined>
  scenes: readonly Scene[]
}

/**
 * A video item plays on screens and NDI but not on a browser feed: its file stays on this computer,
 * so a TV or browser page shows only the background where the video would be (seen on the Onn TV,
 * 11 Nov). The congregation feeds on air that would show a video now: those following Program or a
 * source that is the video, and scenes whose visible content layer follows or holds one.
 */
export function feedsWithoutVideo(s: FeedVideoState): string[] {
  const hasVideo = (shows: readonly FeedSourceKind[] | undefined, held?: VerseRenderData | null) => !!((held ?? feedFrame(s, shows))?.video)
  return s.outputs
    .filter((o) => o.type === "browser" && (o.role ?? "congregation") === "congregation" && outputOnAir(o, s.outputStatus[o.id]) && !followsOnlyOverlays(o))
    .filter((o) => {
      const scene = sceneForOutput(o, s.scenes)
      if (!scene) return hasVideo(o.shows)
      return scene.layers.some((l) => l.kind === "feed" && l.visible && hasVideo(l.shows, l.held))
    })
    .map((o) => o.name)
}

/** The operator's line for them, or null when every screen shows the video. */
export function videoOnFeedsWarning(video: string, feeds: readonly string[]): string | null {
  if (feeds.length === 0) return null
  const where = feeds.length === 1 ? feeds[0] : `${feeds.slice(0, -1).join(", ")} and ${feeds[feeds.length - 1]}`
  return `${where} ${feeds.length === 1 ? "shows" : "show"} only the background while "${video}" plays: videos play on screens and NDI, not on TVs or browser pages. To show it there, put the video in a scene's video layer.`
}
