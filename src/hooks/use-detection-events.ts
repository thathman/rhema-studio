import { useTauriEvent } from "@/hooks/use-tauri-event"
import {
  useAudioStore,
  useBibleStore,
  useBroadcastStore,
  useDetectionStore,
  useQueueStore,
} from "@/stores"
import { bibleActions } from "@/hooks/use-bible"
import { presentVerse } from "@/hooks/use-broadcast"
import { mark } from "@/lib/latency-marks"
import { pickAutoPresentTarget } from "@/lib/auto-present-target"
import type { DetectionResult, ReadingAdvance } from "@/types"

/**
 * App-level listeners for the Rust detection pipeline. Lifted out of the
 * transcript panel so detections keep flowing to the rundown and the live
 * output no matter which workspace is on screen. Mount once, at the root.
 *
 * The handler bodies are the transcript panel's original code, moved verbatim.
 */
export function useDetectionEvents(): void {
  useTauriEvent<{ rms: number; peak: number }>("audio_level", (payload) => {
    useAudioStore.getState().setLevel(payload)
  })

  useTauriEvent<{ abbreviation: string; translation_id: number }>(
    "translation_command",
    (data) => {
      useBibleStore.getState().setActiveTranslation(data.translation_id)
      console.log(`[VOICE] Translation switched to ${data.abbreviation}`)
    }
  )

  useTauriEvent<DetectionResult[]>("verse_detections", (detections) => {
    mark(
      `verse_detections received src=${detections[0]?.source ?? "?"} n=${detections.length} first=${detections[0]?.verse_ref ?? ""}`
    )
    useDetectionStore.getState().addDetections(detections)
    mark(`addDetections done src=${detections[0]?.source ?? "?"}`)

    // Direct detections: the most confident, non-dismissed one drives the
    // preview / auto-live display — see pickAutoPresentTarget for why.
    const directHit = pickAutoPresentTarget(detections, (verseRef) =>
      useDetectionStore.getState().isDismissed(verseRef, "direct")
    )
    if (directHit && directHit.book_number > 0) {
      const detectedVerse = {
        id: 0,
        translation_id: useBibleStore.getState().activeTranslationId,
        book_number: directHit.book_number,
        book_name: directHit.book_name,
        book_abbreviation: "",
        chapter: directHit.chapter,
        verse: directHit.verse,
        text: directHit.verse_text,
      }
      if (useBroadcastStore.getState().autoLive) {
        void presentVerse(detectedVerse)
      } else {
        bibleActions.selectVerse(detectedVerse)
      }
      useBibleStore.getState().setPendingNavigation({
        bookNumber: directHit.book_number,
        chapter: directHit.chapter,
        verse: directHit.verse,
      })
    }

    for (const d of detections) {
      // A refined verse replaces an earlier chapter-only queue entry in place.
      if (
        !d.is_chapter_only &&
        d.source === "direct" &&
        useQueueStore
          .getState()
          .updateEarlyRef(d.book_number, d.chapter, d.verse, d.verse_ref, d.verse_text)
      ) {
        continue
      }
      if (d.auto_queued) {
        const queue = useQueueStore.getState()
        const dupIdx = d.is_chapter_only
          ? queue.items.findIndex(
              (i) => i.verse.book_number === d.book_number && i.verse.chapter === d.chapter
            )
          : queue.findDuplicate(d.book_number, d.chapter, d.verse)
        if (dupIdx !== -1) {
          const existing = queue.items[dupIdx]
          if (!existing.verse.text && d.verse_text) {
            queue.backfillText(existing.id, d.verse_text)
          }
          queue.flashItem(existing.id)
          if (!d.is_chapter_only) queue.setActive(dupIdx)
          continue
        }
        queue.addItem({
          id: crypto.randomUUID(),
          verse: {
            id: 0,
            translation_id: useBibleStore.getState().activeTranslationId,
            book_number: d.book_number,
            book_name: d.book_name,
            book_abbreviation: "",
            chapter: d.chapter,
            verse: d.verse,
            text: d.verse_text,
          },
          reference: d.verse_ref,
          confidence: d.confidence,
          source: d.source === "direct" ? "ai-direct" : "ai-semantic",
          added_at: Date.now(),
          is_chapter_only: d.is_chapter_only,
        })
      }
    }
  })

  useTauriEvent<ReadingAdvance>("reading_mode_verse", (advance) => {
    mark(`reading_mode_verse received ${advance.reference ?? ""}`)
    if (advance.book_number > 0) {
      const advanceVerse = {
        id: 0,
        translation_id: useBibleStore.getState().activeTranslationId,
        book_number: advance.book_number,
        book_name: advance.book_name,
        book_abbreviation: "",
        chapter: advance.chapter,
        verse: advance.verse,
        text: advance.verse_text,
      }
      if (useBroadcastStore.getState().autoLive) {
        void presentVerse(advanceVerse)
      } else {
        bibleActions.selectVerse(advanceVerse)
      }
      useBibleStore.getState().setPendingNavigation({
        bookNumber: advance.book_number,
        chapter: advance.chapter,
        verse: advance.verse,
      })
    }
  })
}
