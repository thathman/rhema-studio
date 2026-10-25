import { create } from "zustand"
import { presentSlide } from "@/hooks/use-broadcast"
import { buildSlides } from "@/lib/lyrics"
import { outputOnAir } from "@/lib/output-on-air"
import { presentQueueItem } from "@/lib/remote-actions"
import { outputsForScreens, useBroadcastStore, type LiveSlide } from "@/stores/broadcast-store"
import { useDetectionStore } from "@/stores/detection-store"
import { useQueueStore } from "@/stores/queue-store"
import { useSongStore } from "@/stores/song-store"
import { isSongItem, type SongQueueItem, type SongWithSections } from "@/types"
import type { ReadinessCheck } from "@/studio/readiness"

/**
 * What the host shares for the joined desk consoles (#197 P1 "Department workspaces"), in the one
 * Live State every desk follows: the song on the screens with its sections (Worship), the verses
 * Auto Bible heard (Bible), every output and what it shows (Screens), and the readiness checks
 * (the director). The host's server passes each part only to the desks it is for (rhema-api
 * `live_for`) and adds who is connected for the director itself.
 */

/** The song or hymn on the screens, for a Worship desk: where in it, and its sections in order. */
export interface LiveLyrics {
  itemId: string
  /** The slide on the screens (the host's server tells two section steps apart by it). */
  index: number
  title: string
  kind: "song" | "hymn"
  /** The section on the screens, in `sections`. */
  section: number
  sections: string[]
}

/** One output as a Screens desk's output map shows it. */
export interface OutputMapRow {
  id: string
  name: string
  kind: "display" | "ndi" | "browser"
  role: "congregation" | "stage" | "signage"
  on: boolean
  /** The scene it shows, by name; null: its own feed. */
  scene: string | null
}

/** A verse Auto Bible heard, for a Bible desk to Activate with one click. */
export interface HeardVerse {
  reference: string
  text: string
  confidence: number
  source: "direct" | "semantic"
}

export interface SharedReadiness {
  ready: boolean
  checks: Pick<ReadinessCheck, "id" | "status" | "label" | "detail">[]
}

/** The host's readiness checks as its own views computed them last (set by `ShareReadiness`). */
export const useSharedReadiness = create<{ readiness: SharedReadiness | null; set: (r: SharedReadiness) => void }>((set) => ({
  readiness: null,
  set: (readiness) => set({ readiness }),
}))

interface Sections {
  /** The first slide of each section, in order. */
  starts: number[]
  labels: string[]
  /** The section the slide on the screens is in. */
  at: number
}

/** A song's sections as its slides run: a new one wherever the section changes (a chorus sung twice is two). */
export function sectionsOf(slides: readonly { sectionId: string; sectionLabel: string }[], index: number): Sections {
  const starts: number[] = []
  const labels: string[] = []
  slides.forEach((s, i) => {
    if (i === 0 || s.sectionId !== slides[i - 1].sectionId) {
      starts.push(i)
      labels.push(s.sectionLabel)
    }
  })
  let at = 0
  starts.forEach((start, n) => { if (start <= index) at = n })
  return { starts, labels, at }
}

let cached: { live: LiveSlide; song: SongWithSections; sections: Sections } | null = null

/** The song on the screens and its sections, or null when no song or hymn is up. */
function liveSections(): { live: LiveSlide; song: SongWithSections; sections: Sections } | null {
  const b = useBroadcastStore.getState()
  const live = b.liveSlide
  const content = b.liveVerse?.content
  if (!b.isLive || !live || (content !== "song" && content !== "hymn")) return null
  if (cached?.live === live) return cached
  const song = live.song ?? useSongStore.getState().songs[live.songId]
  if (!song) return null
  const slides = buildSlides(song, live.arrangementId ?? null, live.languages?.length ? live.languages : [song.song.primary_language])
  cached = { live, song, sections: sectionsOf(slides, live.index) }
  return cached
}

/** The Live State's `lyrics`: null when no song or hymn is on the screens. */
export function liveLyrics(): LiveLyrics | null {
  const s = liveSections()
  if (!s) return null
  return { itemId: s.live.itemId, index: s.live.index, title: s.song.song.title, kind: useBroadcastStore.getState().liveVerse?.content === "hymn" ? "hymn" : "song", section: s.sections.at, sections: s.sections.labels.slice(0, 40) }
}

/**
 * Step the song on the screens to its next or previous section (a Worship desk, desk consoles):
 * only within that song, in the arrangement and languages it went live with. Null when done, else
 * why not, for the main desk's toast.
 */
export async function stepLiveSection(step: 1 | -1): Promise<string | null> {
  const s = liveSections()
  if (!s) return "no song or hymn is on the screens"
  const target = s.sections.starts[s.sections.at + step]
  if (target === undefined) return step > 0 ? "that is the song's last section" : "that is the song's first section"
  const { live, song } = s
  const languages = live.languages?.length ? live.languages : [song.song.primary_language]
  const items = useQueueStore.getState().items
  const index = items.findIndex((i) => i.id === live.itemId)
  if (index !== -1 && isSongItem(items[index])) {
    await presentQueueItem(index, target, { arrangement_id: live.arrangementId ?? null, languages, song: live.song })
    return null
  }
  // A song asked for on the spot (not in the run of show): the same item again, one section on.
  const item: SongQueueItem = { id: live.itemId, kind: "song", song: { song_id: live.songId, title: song.song.title, arrangement_id: live.arrangementId ?? null, languages }, reference: song.song.title, confidence: 1, source: "manual", added_at: Date.now() }
  const outcome = await presentSlide(item, target, { goLive: true, song: live.song })
  return outcome === "presented" ? null : "it was not shown"
}

/** Every output as the real screens have it (never rehearsal's scenes), for a Screens desk's map. */
export function outputMap(): OutputMapRow[] {
  const b = useBroadcastStore.getState()
  return outputsForScreens(b).map((o) => ({
    id: o.id,
    name: o.name,
    kind: o.type,
    role: o.role ?? "congregation",
    on: outputOnAir(o, b.outputStatus[o.id]),
    scene: o.sceneId ? (b.scenes.find((sc) => sc.id === o.sceneId)?.name ?? null) : null,
  }))
}

/** The latest verses Auto Bible heard (never the words said around them). */
export function heardVerses(): HeardVerse[] {
  return useDetectionStore.getState().detections.slice(0, 6).map((d) => ({ reference: d.verse_ref, text: d.verse_text.slice(0, 160), confidence: Math.round(d.confidence * 100) / 100, source: d.source }))
}

/** The desk consoles' parts of the Live State. */
export function deskConsoleState(): { lyrics: LiveLyrics | null; outputMap: OutputMapRow[]; heard: HeardVerse[]; readiness?: SharedReadiness } {
  const readiness = useSharedReadiness.getState().readiness
  return { lyrics: liveLyrics(), outputMap: outputMap(), heard: heardVerses(), ...(readiness ? { readiness } : {}) }
}

/** Publish again when one of these parts changes (`soon`: the Live State publisher's own). */
export function watchDeskConsoles(soon: () => void): (() => void)[] {
  return [
    useBroadcastStore.subscribe((s, p) => { if (s.liveSlide !== p.liveSlide || s.outputStatus !== p.outputStatus) soon() }),
    useDetectionStore.subscribe((s, p) => { if (s.detections !== p.detections) soon() }),
    useSharedReadiness.subscribe(() => soon()),
  ]
}
