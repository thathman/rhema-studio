import type { BroadcastOutput } from "@/types"
import { ndiFrameRateToNumber, ndiResolutionDimensions } from "@/lib/broadcast-output-control"

/**
 * The two programs a service makes (#215 G5.1): the online one OBS streams and records, and the
 * congregation one Rhema puts on the screens in the room. Named the same way all over Production,
 * with the format each really has where it is known, and the usual one where it is not.
 */

/** OBS's video settings as GetVideoSettings gives them: the output size and the frame rate. */
export interface ObsVideo {
  width: number
  height: number
  fps: number
}

/** The usual formats: the stream at 720p30, the screens at 1080p. */
export const ONLINE_FORMAT = "720p30"
export const CONGREGATION_FORMAT = "1080p"

/** "720p30", "1080p29.97": the height and frames per second, as broadcasters say it. */
export function formatName(height: number, fps?: number): string {
  if (!fps) return `${Math.round(height)}p`
  const rate = Math.round(fps * 100) / 100
  return `${Math.round(height)}p${rate}`
}

/** OBS's answer to GetVideoSettings as an `ObsVideo`; null when it is not one. */
export function obsVideo(r: unknown): ObsVideo | null {
  const v = r as { outputWidth?: unknown; outputHeight?: unknown; fpsNumerator?: unknown; fpsDenominator?: unknown } | null
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : null)
  const width = n(v?.outputWidth)
  const height = n(v?.outputHeight)
  const num = n(v?.fpsNumerator)
  const den = n(v?.fpsDenominator)
  return width && height && num && den ? { width, height, fps: num / den } : null
}

/** "Online program (OBS, 720p30)": OBS's own format once it has said, the usual one before. */
export function onlineProgramName(video: ObsVideo | null): string {
  return `Online program (OBS, ${video ? formatName(video.height, video.fps) : ONLINE_FORMAT})`
}

/** An output's own format, when it sets one: an NDI sender's size and frame rate. A screen or a browser feed takes the size of what shows it. */
export function outputFormat(o: Pick<BroadcastOutput, "type" | "ndi">): string | null {
  return o.type === "ndi" ? formatName(ndiResolutionDimensions(o.ndi.resolution).height, ndiFrameRateToNumber(o.ndi.frameRate)) : null
}

/**
 * "Congregation program (screens, 1080p)": with the formats the congregation's NDI senders are set
 * to ("1080p30", or "1080p30 / 720p30" when they differ), the usual 1080p when none says.
 */
export function congregationProgramName(outputs: Pick<BroadcastOutput, "type" | "ndi" | "role">[]): string {
  const formats = [...new Set(outputs.filter((o) => (o.role ?? "congregation") === "congregation").map(outputFormat).filter((f): f is string => !!f))]
  return `Congregation program (screens, ${formats.length ? formats.join(" / ") : CONGREGATION_FORMAT})`
}
