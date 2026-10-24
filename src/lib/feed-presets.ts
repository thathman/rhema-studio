import { newFeedToken } from "@/lib/output-on-air"
import { newLayer, newScene } from "@/lib/scenes"
import { defaultNdiSettings, MAIN_OUTPUT_ID, type BroadcastOutput, type BroadcastTheme, type Scene } from "@/types"
import type { FeedSourceKind } from "@/types/broadcast"

/**
 * Ready-made feeds (#299 UX15-4, #243 FD.5): named outputs for OBS and other receivers, each set up
 * for one job (the Bible full screen, the Bible as a lower third, lyrics, announcements, the
 * presenter's name band, the ticker on alpha, the service clock, the countdown display). Adding one makes a new output, off
 * until someone turns it on; existing outputs are never renamed or changed.
 */
export interface FeedPreset {
  id: string
  /** The output's name and its NDI source name, as OBS lists it. */
  name: string
  /** One line: what it is for. */
  description: string
  /** The live sources it follows (the ticker feed follows only the ticker). */
  shows: FeedSourceKind[]
  /** The look it starts with: the first of these the church has, else the main output's. */
  themeIds: string[]
  lowerThirds?: boolean
  /** Also sets the output's ticker switch (older builds draw the ticker from it). */
  ticker?: boolean
  /** Sends transparency (NDI alpha); full-screen feeds are opaque. */
  alpha: boolean
  /** It shows a scene of its own: the service clock (a scene of that name is reused when the church has one). */
  clockScene?: true
  /** A stage output with the countdown display (Design → Countdown), opaque, for a TV or OBS. */
  countdown?: true
}

// The four built-in themes (src/lib/builtin-themes.ts); their ids never change.
const CLASSIC_DARK = "builtin-classic-dark"
const LOWER_THIRDS = "builtin-broadcast-overlay"

export const FEED_PRESETS: readonly FeedPreset[] = [
  { id: "bible-full", name: "Rhema Bible | Full", description: "The Bible full screen, keeping the verse while a song is on the projector.", shows: ["bible"], themeIds: [CLASSIC_DARK], alpha: false },
  { id: "bible-l3", name: "Rhema Bible | Lower third", description: "The verse as a keyed lower third over the camera, with name bands.", shows: ["bible"], themeIds: [LOWER_THIRDS], lowerThirds: true, alpha: true },
  { id: "lyrics-full", name: "Rhema Lyrics | Full", description: "Song and hymn words full screen.", shows: ["song", "hymn"], themeIds: [CLASSIC_DARK], alpha: false },
  { id: "lyrics-l3", name: "Rhema Lyrics | Lower third", description: "Song and hymn words as a keyed lower third over the camera.", shows: ["song", "hymn"], themeIds: [LOWER_THIRDS], alpha: true },
  { id: "announcements-full", name: "Rhema Announcements | Full", description: "Announcement slides full screen, for the stream before and after the service.", shows: ["slide"], themeIds: [CLASSIC_DARK], alpha: false },
  { id: "presenter-l3", name: "Rhema Lower third | Presenter", description: "Only the name band (the speaker, a title), keyed over the camera; no verses or lyrics.", shows: ["lowerThird"], themeIds: [LOWER_THIRDS], lowerThirds: true, alpha: true },
  { id: "ticker-alpha", name: "Rhema Ticker | Alpha", description: "Only the news ticker, on a transparent frame to key over anything.", shows: ["ticker"], themeIds: [LOWER_THIRDS], ticker: true, alpha: true },
  { id: "clock", name: "Rhema Clock", description: "The service timer on a transparent frame (a countdown or the sermon clock), from its own scene.", shows: [], themeIds: [LOWER_THIRDS], alpha: true, clockScene: true },
  { id: "countdown", name: "Rhema Countdown", description: "One big countdown that turns amber, then red, with your messages (Design → Countdown); for a TV at the back or a confidence monitor.", shows: [], themeIds: [CLASSIC_DARK], alpha: false, countdown: true },
]

/** The clock feed's scene: the service timer in the middle of a transparent frame. */
function clockScene(name: string): Scene {
  return newScene(name, { id: "clock", name, description: "The service timer", background: "transparent", layers: () => [newLayer("clock", { name: "Service timer", box: { x: 20, y: 30, w: 60, h: 40 } })] })
}

export type FeedTransport = "ndi" | "browser"

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The output that already has this feed's name (as its name or its NDI source name), if any. */
export function existingFeed(preset: FeedPreset, outputs: readonly BroadcastOutput[]): BroadcastOutput | undefined {
  return outputs.find((o) => same(o.ndi.sourceName, preset.name) || same(o.name, preset.name))
}

/**
 * The new output for a ready-made feed, or why not: an output with that name or NDI source name
 * exists already (two NDI senders with one name collide on the network). The clock feed comes with
 * its scene, new unless the church has a scene of that name. Pure: the caller adds them.
 */
export function readyMadeFeed(
  preset: FeedPreset,
  transport: FeedTransport,
  outputs: readonly BroadcastOutput[],
  themes: readonly Pick<BroadcastTheme, "id">[],
  newId: () => string = () => crypto.randomUUID(),
  scenes: readonly Pick<Scene, "id" | "name">[] = [],
): { output: BroadcastOutput; scene?: Scene } | { taken: BroadcastOutput } {
  const taken = existingFeed(preset, outputs)
  if (taken) return { taken }
  const reuse = preset.clockScene ? scenes.find((x) => same(x.name, preset.name)) : undefined
  const scene = preset.clockScene && !reuse ? clockScene(preset.name) : undefined
  const themeId = preset.themeIds.find((id) => themes.some((t) => t.id === id)) ?? outputs.find((o) => o.id === MAIN_OUTPUT_ID)?.themeId ?? themes[0]?.id ?? ""
  const output: BroadcastOutput = {
    id: newId(),
    name: preset.name,
    type: transport,
    role: preset.countdown ? "stage" : "congregation",
    themeId,
    monitorIndex: 0,
    monitorName: null,
    ndi: { ...defaultNdiSettings(preset.name), alphaMode: preset.alpha ? "straightAlpha" : "noneOpaque" },
    ...(preset.shows.length ? { shows: [...preset.shows] } : {}),
    ...(preset.lowerThirds ? { lowerThirds: true } : {}),
    ...(preset.ticker ? { ticker: true } : {}),
    ...(preset.clockScene ? { sceneId: (reuse ?? scene)!.id } : {}),
    ...(preset.countdown ? { stageLayout: "countdown" as const } : {}),
    ...(transport === "browser" ? { feedToken: newFeedToken() } : {}),
  }
  return scene ? { output, scene } : { output }
}

/**
 * A signage output with no pictures that shows the ticker on a transparent look: the ticker feed as
 * earlier builds made it (now an output that follows only the ticker), not a foyer loop still waiting
 * for its pictures.
 */
export function tickerOnly(o: Pick<BroadcastOutput, "role" | "ticker">, pictures: number, theme: Pick<BroadcastTheme, "background"> | undefined): boolean {
  return o.role === "signage" && o.ticker === true && pictures === 0 && theme?.background.type === "transparent"
}
