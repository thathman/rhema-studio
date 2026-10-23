import { newFeedToken } from "@/lib/output-on-air"
import { defaultNdiSettings, MAIN_OUTPUT_ID, type BroadcastOutput, type BroadcastTheme } from "@/types"
import type { ContentType } from "@/types/broadcast"

/**
 * Ready-made feeds (#299 UX15-4): named outputs for OBS and other receivers, each set up for one
 * job (the Bible full screen, the Bible as a lower third, lyrics, the ticker on alpha). Adding one
 * makes a new output, off until someone turns it on; existing outputs are never renamed or changed.
 */
export interface FeedPreset {
  id: string
  /** The output's name and its NDI source name, as OBS lists it. */
  name: string
  /** One line: what it is for. */
  description: string
  /** The live sources it follows; absent for the ticker feed (it shows no service content). */
  shows?: ContentType[]
  /** The look it starts with: the first of these the church has, else the main output's. */
  themeIds: string[]
  lowerThirds?: boolean
  ticker?: boolean
  /** The ticker alone on a transparent frame: a signage loop with no pictures. */
  tickerOnly?: boolean
  /** Sends transparency (NDI alpha); full-screen feeds are opaque. */
  alpha: boolean
}

// The four built-in themes (src/lib/builtin-themes.ts); their ids never change.
const CLASSIC_DARK = "builtin-classic-dark"
const LOWER_THIRDS = "builtin-broadcast-overlay"

export const FEED_PRESETS: readonly FeedPreset[] = [
  { id: "bible-full", name: "Rhema Bible | Full", description: "The Bible full screen, keeping the verse while a song is on the projector.", shows: ["bible"], themeIds: [CLASSIC_DARK], alpha: false },
  { id: "bible-l3", name: "Rhema Bible | Lower third", description: "The verse as a keyed lower third over the camera, with name bands.", shows: ["bible"], themeIds: [LOWER_THIRDS], lowerThirds: true, alpha: true },
  { id: "lyrics-full", name: "Rhema Lyrics | Full", description: "Song and hymn words full screen.", shows: ["song", "hymn"], themeIds: [CLASSIC_DARK], alpha: false },
  { id: "lyrics-l3", name: "Rhema Lyrics | Lower third", description: "Song and hymn words as a keyed lower third over the camera.", shows: ["song", "hymn"], themeIds: [LOWER_THIRDS], alpha: true },
  { id: "ticker-alpha", name: "Rhema Ticker | Alpha", description: "Only the news ticker, on a transparent frame to key over anything.", themeIds: [LOWER_THIRDS], ticker: true, tickerOnly: true, alpha: true },
]

export type FeedTransport = "ndi" | "browser"

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The output that already has this feed's name (as its name or its NDI source name), if any. */
export function existingFeed(preset: FeedPreset, outputs: readonly BroadcastOutput[]): BroadcastOutput | undefined {
  return outputs.find((o) => same(o.ndi.sourceName, preset.name) || same(o.name, preset.name))
}

/**
 * The new output for a ready-made feed, or why not: an output with that name or NDI source name
 * exists already (two NDI senders with one name collide on the network). Pure: the caller adds it.
 */
export function readyMadeFeed(
  preset: FeedPreset,
  transport: FeedTransport,
  outputs: readonly BroadcastOutput[],
  themes: readonly Pick<BroadcastTheme, "id">[],
  newId: () => string = () => crypto.randomUUID(),
): { output: BroadcastOutput } | { taken: BroadcastOutput } {
  const taken = existingFeed(preset, outputs)
  if (taken) return { taken }
  const themeId = preset.themeIds.find((id) => themes.some((t) => t.id === id)) ?? outputs.find((o) => o.id === MAIN_OUTPUT_ID)?.themeId ?? themes[0]?.id ?? ""
  const output: BroadcastOutput = {
    id: newId(),
    name: preset.name,
    type: transport,
    role: preset.tickerOnly ? "signage" : "congregation",
    themeId,
    monitorIndex: 0,
    monitorName: null,
    ndi: { ...defaultNdiSettings(preset.name), alphaMode: preset.alpha ? "straightAlpha" : "noneOpaque" },
    ...(preset.shows ? { shows: [...preset.shows] } : {}),
    ...(preset.lowerThirds ? { lowerThirds: true } : {}),
    ...(preset.ticker ? { ticker: true } : {}),
    ...(preset.tickerOnly ? { signage: { mediaIds: [], seconds: 10 } } : {}),
    ...(transport === "browser" ? { feedToken: newFeedToken() } : {}),
  }
  return { output }
}

/**
 * A signage output with no pictures that shows the ticker on a transparent look: the ticker feed,
 * not a foyer loop still waiting for its pictures.
 */
export function tickerOnly(o: Pick<BroadcastOutput, "role" | "ticker">, pictures: number, theme: Pick<BroadcastTheme, "background"> | undefined): boolean {
  return o.role === "signage" && o.ticker === true && pictures === 0 && theme?.background.type === "transparent"
}
