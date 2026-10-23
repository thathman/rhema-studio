import { ndiFrameRateToNumber, ndiResolutionDimensions } from "@/lib/broadcast-output-control"
import { CONTENT_NAMES } from "@/lib/content-names"
import { tickerOnly } from "@/lib/feed-presets"
import { allSignageIds } from "@/lib/signage"
import type { BroadcastOutput, BroadcastTheme, Scene } from "@/types"

/** How an output leaves this computer, in a word: a display, NDI or a browser feed (#299 UX15-4). */
export function outputTransport(o: BroadcastOutput): string {
  if (o.type === "ndi") return "NDI"
  if (o.type === "browser") return "Browser feed"
  return o.windowed ? "Window" : "Display"
}

/** Where it goes: the monitor, the NDI source name OBS sees, or the church network. */
export function outputDestination(o: BroadcastOutput, monitorLabel?: string): string {
  if (o.type === "browser") return "A web page on the church network (OBS Browser source, a TV)"
  if (o.type === "ndi") {
    const dims = ndiResolutionDimensions(o.ndi.resolution)
    return `“${o.ndi.sourceName}” · ${dims.height}p${ndiFrameRateToNumber(o.ndi.frameRate)} · ${o.ndi.alphaMode === "noneOpaque" ? "opaque" : "alpha"}`
  }
  const screen = monitorLabel ?? o.monitorName ?? `Display ${o.monitorIndex + 1}`
  return o.windowed ? `A window on ${screen}` : screen
}

/** What it follows: everything put on air, or only chosen live sources (ADR 0001). */
export function outputFollows(o: BroadcastOutput, theme?: BroadcastTheme): string {
  if (o.role === "signage") return tickerOnly(o, allSignageIds(o.signage).length, theme) ? "The news ticker from Present" : "Nothing in the service (its own picture loop)"
  return o.shows?.length ? o.shows.map((k) => CONTENT_NAMES[k]).join(", ") : "Everything put on air"
}

/**
 * How it presents what it follows, from what the output really does: full frame, a scene, the
 * stage view or a signage loop, with lower thirds and the ticker over it, keyed when its look is
 * transparent.
 */
export function outputPresentation(o: BroadcastOutput, scenes: Scene[], theme?: BroadcastTheme): string {
  if (o.role === "stage") return "Stage display (words, next, note, timer)"
  if (o.role === "signage") {
    if (tickerOnly(o, allSignageIds(o.signage).length, theme)) return "Ticker only · transparent, for keying"
    return o.ticker ? "Signage loop · ticker" : "Signage loop"
  }
  const scene = o.sceneId ? scenes.find((s) => s.id === o.sceneId) : undefined
  const parts = [scene ? `Scene: ${scene.name}` : "Full screen"]
  if (o.lowerThirds) parts.push("lower thirds")
  if (o.ticker) parts.push("ticker")
  if (!scene && theme?.background.type === "transparent") parts.push("transparent, for keying")
  return parts.join(" · ")
}

/**
 * What saving the output editor changes on an existing output. Everything the editor shows is
 * kept as edited, `themeFor` and the feed link included; what it does not show (its id, the scene
 * it is on) is left alone, so saving never switches its scene or takes anything live.
 */
export function outputEditPatch(next: BroadcastOutput): Partial<Omit<BroadcastOutput, "id">> {
  return {
    name: next.name,
    type: next.type,
    themeId: next.themeId,
    themeFor: next.themeFor ?? {},
    monitorIndex: next.monitorIndex,
    windowed: next.windowed === true,
    monitorName: next.monitorName ?? null,
    ndi: next.ndi,
    role: next.role,
    language: next.language,
    signage: next.signage,
    lowerThirds: next.lowerThirds,
    ticker: next.ticker === true,
    shows: next.shows?.length ? next.shows : undefined,
    ...(next.feedToken ? { feedToken: next.feedToken } : {}),
  }
}
