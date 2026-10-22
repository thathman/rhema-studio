import { useMediaStore } from "@/stores/media-store"
import type { LowerThird, LowerThirdStyle } from "@/types"

/** The style's picture or video as a URL the outputs can load (null without one, or when it cannot be read). */
export async function lowerThirdBacking(style: { background: Pick<LowerThirdStyle["background"], "kind" | "mediaId"> }): Promise<LowerThird["backing"]> {
  const bg = style.background
  if (!bg.mediaId || (bg.kind !== "picture" && bg.kind !== "video")) return null
  const media = useMediaStore.getState()
  // A picture as data (the canvas stays readable for NDI); a video streams.
  const url = await (bg.kind === "video" ? media.fileUrl(bg.mediaId) : media.dataUrl(bg.mediaId)).catch(() => null)
  return url ? { kind: bg.kind, url } : null
}
