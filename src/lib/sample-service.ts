import { invoke } from "@tauri-apps/api/core"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import type { QueueItem, Verse } from "@/types"

/**
 * A sample service to try Rhema with (#298 S4.5, S7.7b): a welcome, a few passages from the Bible
 * edition on this computer, notices and a closing slide. No song words (Rhema ships none), nothing
 * saved, and nothing goes on a screen until the operator shows it. It opens as an unsaved rundown.
 */

/** The passages, as book number, chapter and verse; one the edition lacks is left out. */
export const SAMPLE_PASSAGES: ReadonlyArray<[book: number, chapter: number, verse: number]> = [
  [19, 100, 1], // Psalm 100:1
  [19, 23, 1], // Psalm 23:1
  [43, 3, 16], // John 3:16
  [45, 8, 28], // Romans 8:28
]

const slide = (id: string, title: string, body: string, notes: string, now: number): QueueItem => ({
  id,
  kind: "slide",
  slide: { title, body },
  reference: title,
  confidence: 1,
  source: "manual",
  added_at: now,
  notes,
  planned_minutes: 2,
})

/** The sample's items, in order: pure, so it can be checked without a Bible database. */
export function sampleServiceItems(verses: Verse[], now = Date.now(), newId: () => string = () => crypto.randomUUID()): QueueItem[] {
  const passages: QueueItem[] = verses.map((v) => ({
    id: newId(),
    verse: v,
    reference: `${v.book_name} ${v.chapter}:${v.verse}`,
    confidence: 1,
    source: "manual",
    added_at: now,
    planned_minutes: 3,
  }))
  return [
    slide(newId(), "Welcome", "We are glad you are here.", "Sample service: try Show live in Present. Nothing is saved unless you save it.", now),
    ...passages.slice(0, 2),
    slide(newId(), "Notices", "Midweek service · Wednesday 6 pm\nPrayer meeting · Friday 7 pm", "Change these to your church's own notices, or delete them.", now),
    ...passages.slice(2),
    slide(newId(), "Go in peace", "Thank you for worshipping with us.", "", now),
  ]
}

export type SampleOutcome = "started" | "unsaved" | "live"

/**
 * Put the sample in the rundown. Refused, with nothing changed, while the open service has unsaved
 * changes or an unsaved rundown is on screen ("unsaved"), or while something is live ("live").
 * An open, saved service is closed first (it stays saved).
 */
export async function startSampleService(): Promise<SampleOutcome> {
  const b = useBroadcastStore.getState()
  if (b.isLive && !b.rehearsal) return "live"
  const svc = useServiceStore.getState()
  if (svc.dirty || (!svc.current && useQueueStore.getState().items.length > 0)) return "unsaved"
  const translationId = useBibleStore.getState().activeTranslationId
  const verses: Verse[] = []
  for (const [bookNumber, chapter, verse] of SAMPLE_PASSAGES) {
    const v = await invoke<Verse | null>("get_verse", { translationId, bookNumber, chapter, verse }).catch(() => null)
    if (v && typeof v.text === "string") verses.push(v)
  }
  // Looked again: the operator may have started something while the passages were read.
  const again = useServiceStore.getState()
  if (again.dirty || (!again.current && useQueueStore.getState().items.length > 0)) return "unsaved"
  if (again.current && again.closeProgram() !== "closed") return "unsaved"
  useQueueStore.setState({ items: sampleServiceItems(verses), headers: [], activeIndex: null, removedActive: null })
  return "started"
}

/** What to tell the operator when the sample could not start. */
export function sampleRefusal(outcome: Exclude<SampleOutcome, "started">): string {
  return outcome === "live" ? "Not while something is live. Try the sample after the service." : "Save or clear the rundown in Prepare first; the sample would replace it."
}
