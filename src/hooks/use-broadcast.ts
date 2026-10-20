import { invoke } from "@tauri-apps/api/core"
import { mark } from "@/lib/latency-marks"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useBibleStore } from "@/stores/bible-store"
import type { VerseRenderData } from "@/types"
import type { SongQueueItem, Verse } from "@/types"
import { isMissing, resolveTranslations, type ItemTranslations } from "@/lib/translation-policy"
import { buildSlides, toLyricRenderData } from "@/lib/lyrics"
import { useSongStore } from "@/stores/song-store"

export function toVerseRenderData(
  verse: Verse,
  translation: string
): VerseRenderData {
  return {
    reference: `${verse.book_name} ${verse.chapter}:${verse.verse} (${translation})`,
    segments: [{ verseNumber: verse.verse, text: verse.text }],
  }
}

/**
 * Build one live payload for multiple translations of the same reference.
 * Keeping the translations in one payload means every output advances from
 * the same detected scripture instead of running competing presentation
 * paths.
 */
export function toDualVerseRenderData(
  entries: Array<{ verse: Verse; translation: string }>
): VerseRenderData {
  const first = entries[0]
  if (!first) {
    return { reference: "", segments: [] }
  }

  return {
    reference: `${first.verse.book_name} ${first.verse.chapter}:${first.verse.verse}`,
    segments: [{ text: first.verse.text }],
    translationLines: entries.map(({ verse }) => verse.text),
  }
}

export function getTranslationLabel(
  translationId: number,
  fallback: string
): string {
  return (
    useBibleStore
      .getState()
      .translations.find((translation) => translation.id === translationId)
      ?.abbreviation ?? fallback
  )
}

// Monotonic ticket so an older present whose refetch resolves late can't
// overwrite a newer one (detections can present in quick succession).
let presentSeq = 0

/**
 * Invalidate every present still in flight. Clear/hide call this so a verse
 * that was being fetched when the operator cleared cannot pop up afterwards.
 */
export function cancelPendingPresents(): void {
  presentSeq += 1
}

export interface PresentOptions {
  /** The rundown item the verse came from. Its saved translations apply (see translation-policy). */
  item?: ItemTranslations | null
  /** Put the output on air in the same update as the verse. Nothing changes if the present fails. */
  goLive?: boolean
}

export type PresentOutcome = "presented" | "superseded" | "empty" | "missing_translation"

/**
 * Refetch the full verse from the backend and present it to preview + live
 * output. Queue/detection items may carry partial verse objects (empty text,
 * synthetic id 0, stale translation_id), so always look the verse up by
 * book/chapter/verse. Which translation(s) is decided by `resolveTranslations`:
 * the item's saved choice when there is one, else the operator's active
 * translations. Falls back to the passed verse if the lookup fails — never
 * blanks the output on error.
 *
 * This is the ONLY path that changes the live output verse. Manual selection
 * (verse click, arrow navigation, search) presents directly; detections update
 * only the preview unless the Auto toggle is on.
 */
export async function presentVerse(verse: Verse, opts: PresentOptions = {}): Promise<PresentOutcome> {
  presentSeq += 1
  const ticket = presentSeq
  const ref = `${verse.book_name} ${verse.chapter}:${verse.verse}`
  mark(`presentVerse start ${ref}`)

  const bibleState = useBibleStore.getState()
  const choice = resolveTranslations(opts.item, bibleState)
  if (isMissing(choice)) {
    const active = getTranslationLabel(bibleState.activeTranslationId, "the active translation")
    useBroadcastStore.getState().setPresentWarning(
      `${ref} not shown: it was saved for ${choice.missing.join(", ")}, which is not installed. Install it, or turn on "Use my translation" to show it in ${active}.`
    )
    return "missing_translation"
  }
  const translationIds = [choice.primary, ...(choice.secondary !== null ? [choice.secondary] : [])]

  const fetchedVerses = await Promise.all(
    translationIds.map(async (translationId) => {
      try {
        return await invoke<Verse | null>("get_verse", {
          translationId,
          bookNumber: verse.book_number,
          chapter: verse.chapter,
          verse: verse.verse,
        })
      } catch (e) {
        console.warn(
          `[broadcast] get_verse refetch failed for translation ${translationId}`,
          e
        )
        return null
      }
    })
  )
  const verseToPresent = fetchedVerses[0] ?? verse
  mark(
    `presentVerse get_verse done ${verse.book_name} ${verse.chapter}:${verse.verse}`
  )

  // A newer present (or a Clear) started while we were refetching — let it win.
  if (ticket !== presentSeq) return "superseded"

  // Never present a verse with no text (e.g. a citation that doesn't exist
  // in the chosen translation) — keep whatever is currently live instead.
  if (!verseToPresent.text?.trim()) {
    console.warn("[broadcast] refusing to present verse with empty text:", ref)
    useBroadcastStore.getState().setPresentWarning(
      `${ref} not shown: no text in ${getTranslationLabel(choice.primary, "the chosen translation")}.`
    )
    return "empty"
  }

  const renderEntries = fetchedVerses
    .map((fetchedVerse, index) => {
      const sourceVerse = fetchedVerse ?? (index === 0 ? verse : null)
      if (!sourceVerse?.text?.trim()) return null
      return {
        verse: sourceVerse,
        translation: getTranslationLabel(
          translationIds[index],
          index === 0 ? "KJV" : "Translation"
        ),
      }
    })
    .filter(
      (entry): entry is { verse: Verse; translation: string } => entry !== null
    )

  // Keep the preview in sync with what was just presented.
  bibleState.selectVerse(verseToPresent)
  useBroadcastStore
    .getState()
    .setLiveVerse(
      renderEntries.length > 1
        ? toDualVerseRenderData(renderEntries)
        : toVerseRenderData(
            renderEntries[0]?.verse ?? verseToPresent,
            renderEntries[0]?.translation ?? "KJV"
          ),
      verseToPresent,
      { goLive: opts.goLive, item: opts.item ?? null }
    )
  mark(`presentVerse end ${ref}`)
  return "presented"
}

/**
 * Present one slide of a song item. The sibling of `presentVerse` and the
 * only writer of lyric slides: same ticket, same atomic go-live, same
 * "never blank the output on failure" rule. `index` may be "last" so
 * Previous can land on a song's final slide.
 */
export async function presentSlide(
  item: SongQueueItem,
  index: number | "last",
  opts: { goLive?: boolean } = {}
): Promise<PresentOutcome> {
  presentSeq += 1
  const ticket = presentSeq
  const warn = (message: string) => useBroadcastStore.getState().setPresentWarning(message)
  let song = null
  try {
    song = await useSongStore.getState().load(item.song.song_id)
  } catch (e) {
    console.warn("[broadcast] song load failed:", e)
  }
  if (ticket !== presentSeq) return "superseded"
  if (!song) {
    warn(`${item.song.title} not shown: the song is no longer in the library.`)
    return "empty"
  }
  const slides = buildSlides(song, item.song.arrangement_id, item.song.languages)
  const langs = item.song.languages.length ? item.song.languages : [song.song.primary_language]
  if (slides.length === 0) {
    warn(`${item.song.title} not shown: it has no lyrics in ${langs.join(" / ").toUpperCase()}.`)
    return "empty"
  }
  const i = index === "last" ? slides.length - 1 : Math.min(Math.max(index, 0), slides.length - 1)
  const slide = slides[i]
  useBibleStore.getState().selectSlide({ item, index: i })
  useBroadcastStore.getState().setLiveVerse(toLyricRenderData(song, slide), null, {
    goLive: opts.goLive,
    slide: { itemId: item.id, songId: song.song.id, index: i, total: slides.length },
  })
  if (slide.missing.length > 0) {
    warn(`${slide.sectionLabel} has no ${slide.missing.join(" / ").toUpperCase()} text; showing what there is.`)
  }
  return "presented"
}

export const broadcastActions = {
  setLiveVerse: (verse: VerseRenderData | null) =>
    useBroadcastStore.getState().setLiveVerse(verse),
  setLive: (live: boolean) => useBroadcastStore.getState().setLive(live),
  getActiveTheme: () => {
    const s = useBroadcastStore.getState()
    return s.themes.find((t) => t.id === s.activeThemeId) ?? s.themes[0]
  },
}
