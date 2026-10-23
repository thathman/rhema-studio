import type { ContentType, VerseRenderData } from "@/types/broadcast"

/**
 * Independent live sources (ADR 0001, LS-002). Each kind of content has its own active value, so a
 * Bible verse stays live for the feeds that follow Bible while a hymn is on the projector. Quick
 * screens (Welcome, Offering…) are their own source; Black and Logo cover every public feed.
 */
export type SourceId = ContentType | "quick"

export interface LiveSource {
  value: VerseRenderData
  /** The rundown item it came from, if any. */
  itemId: string | null
  /** Activation order across all sources: higher is newer. */
  revision: number
  activatedAt: number
  /** Who activated it: the operator's name, a joined desk or phone, or "Auto"; absent when not known (older snapshots). */
  by?: string
  /** Off: cleared, the value kept for Restore. */
  on: boolean
}

export type LiveSources = Partial<Record<SourceId, LiveSource>>

const BY_KIND: Record<NonNullable<VerseRenderData["kind"]>, ContentType> = { verse: "bible", lyric: "song", slide: "slide", image: "picture" }

/** Which source a frame belongs to. */
export function sourceOf(v: VerseRenderData): SourceId {
  if (v.quick || v.screen) return "quick"
  return v.content ?? BY_KIND[v.kind ?? "verse"]
}

/**
 * What a feed shows: an output that follows nothing in particular shows the program (the latest
 * thing put on air, as before); one that follows chosen sources shows the newest of those that is
 * on. Black and Logo cover every feed.
 */
export function feedFrame(s: { isLive: boolean; liveVerse: VerseRenderData | null; sources: LiveSources }, shows?: readonly ContentType[]): VerseRenderData | null {
  const program = s.isLive ? s.liveVerse : null
  if (!shows?.length || program?.screen) return program
  let best: LiveSource | undefined
  for (const id of shows) {
    const x = s.sources[id]
    if (x?.on && (!best || x.revision > best.revision)) best = x
  }
  return best?.value ?? null
}

/** "by Tolu 10:42": who activated a source and when, for the strip and joined desks. */
export function activatedLabel(src: { by?: string; activatedAt?: number }): string {
  const at = typeof src.activatedAt === "number" && src.activatedAt > 0 ? new Date(src.activatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""
  return [src.by ? `by ${src.by}` : "", at].filter(Boolean).join(" ")
}
