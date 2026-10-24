import type { ContentType, FeedSourceKind, VerseRenderData } from "@/types/broadcast"
import type { Ticker } from "@/types/broadcast-output"
import { elapsedMs, formatMs, remainingMs, type TimerState } from "@/lib/timer"

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
export function feedFrame(s: { isLive: boolean; liveVerse: VerseRenderData | null; sources: LiveSources }, shows?: readonly FeedSourceKind[]): VerseRenderData | null {
  const program = s.isLive ? s.liveVerse : null
  if (!shows?.length || program?.screen) return program
  let best: LiveSource | undefined
  for (const id of shows) {
    // The ticker is drawn over the frame (followsTicker), never as its content.
    if (id === "ticker") continue
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

/**
 * Sources with no frame of their own (ADR 0001): the ticker, the service timer and each camera on
 * the church network ("camera:pulpit", by its name in the camera router). Each records who last
 * changed it and when, like a content source, and is never changed by rehearsal.
 */
export type StateSourceId = "ticker" | "timer" | `camera:${string}`

/** Any live source: a content source or one of the above. */
export type AnySourceId = SourceId | StateSourceId

export interface StateSource {
  /** Bumped with every change, from the same count as content activations: higher is newer. */
  revision: number
  /** When it last changed (ms). */
  activatedAt: number
  /** Who changed it last: the operator's name, a joined desk or phone; absent when not known. */
  by?: string
  /** Ticker: running (held still counts); timer: running; camera: in scenes (off: hidden, its layers show their fallback). */
  on: boolean
  /** Ticker taken off: the ticker it was, for Restore. */
  ticker?: Ticker
}

export type StateSources = Partial<Record<StateSourceId, StateSource>>

export const cameraSourceId = (name: string): StateSourceId => `camera:${name}`

export function isStateSource(id: string): id is StateSourceId {
  return id === "ticker" || id === "timer" || /^camera:[a-z0-9][a-z0-9_-]{0,39}$/.test(id)
}

/** The router's name in a camera layer's address (http://192.168.1.20:8889/pulpit/whep → "pulpit"), or null. */
export function cameraPathOf(url: string): string | null {
  try {
    const m = new URL(url).pathname.match(/^\/([^/]+)\/whep\/?$/)
    return m ? decodeURIComponent(m[1]) : null
  } catch {
    return null
  }
}

/** A camera layer's camera is hidden from scenes (its hold is on): the layer shows its fallback. */
export function cameraHidden(st: StateSources | undefined, url: string): boolean {
  const name = cameraPathOf(url)
  return !!name && st?.[cameraSourceId(name)]?.on === false
}

/** The output draws the ticker: its ticker switch, or it follows the ticker. */
export function followsTicker(o: { ticker?: boolean; shows?: readonly FeedSourceKind[] }): boolean {
  return o.ticker === true || !!o.shows?.includes("ticker")
}

/** It follows only the ticker (Rhema Ticker | Alpha): the ticker and nothing from the service. */
export function followsOnlyTicker(o: { shows?: readonly FeedSourceKind[] }): boolean {
  return !!o.shows?.length && o.shows.every((k) => k === "ticker")
}

/** The ticker's first words, for the strip, the log and joined desks. */
export function tickerWords(t: Pick<Ticker, "items"> | null | undefined, max = 60): string {
  const first = t?.items.map((i) => i.trim()).find(Boolean) ?? ""
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first
}

/** The service timer in a few words: "12:34 left" counting down, "8:02" counting up. */
export function timerWords(t: TimerState, mono: number): string {
  return t.durationMs > 0 ? `${formatMs(Math.max(0, remainingMs(t, mono)))} left` : formatMs(elapsedMs(t, mono))
}
