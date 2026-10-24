import { invoke } from "@tauri-apps/api/core"
import { presentVerse, type PresentOutcome } from "@/hooks/use-broadcast"
import { followerCount, sourceOf } from "@/lib/live-sources"
import { parseTypedReference } from "@/lib/quick-search"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { toast } from "sonner"
import type { BroadcastOutput, Scene, Verse } from "@/types"

/**
 * One rule for every Bible activation that is not the operator's own Show Live (ADR 0001, C11):
 * while a song, hymn, slide or quick screen is on the main screens, the verse goes to the feeds
 * that follow Bible and waits in the preview; otherwise it is shown on the main screens too.
 * Auto (heard verses), the remote and a joined Bible operator all use it.
 */
export function bibleScope(): { sourceOnly?: boolean } {
  const { isLive, liveVerse } = useBroadcastStore.getState()
  return isLive && liveVerse && sourceOf(liveVerse) !== "bible" ? { sourceOnly: true } : {}
}

/** A typed reference ("Romans 8:28", "jn 3 16") activated on the Bible source; null when it is not a reference. */
export async function activateBibleReference(reference: string): Promise<PresentOutcome | null> {
  const ref = parseTypedReference(reference, useBibleStore.getState().books)
  if (!ref) return null
  const verse = { id: 0, translation_id: useBibleStore.getState().activeTranslationId ?? 1, book_number: ref.book.book_number, book_name: ref.book.name, book_abbreviation: ref.book.abbreviation ?? "", chapter: ref.chapter, verse: ref.verse, text: "" }
  const scope = bibleScope()
  return presentVerse(verse, scope.sourceOnly ? scope : { goLive: true })
}

/**
 * A typed reference put in Preview only (an action request answered Preview, Comms C2): the verse
 * in the active translation is selected and the Bible panel goes to it; nothing goes live and no
 * feed changes. "empty" when that verse has no text here; null when it is not a reference.
 */
export async function previewBibleReference(reference: string): Promise<"previewed" | "empty" | null> {
  const bible = useBibleStore.getState()
  const ref = parseTypedReference(reference, bible.books)
  if (!ref) return null
  const verse = await invoke<Verse | null>("get_verse", { translationId: bible.activeTranslationId ?? 1, bookNumber: ref.book.book_number, chapter: ref.chapter, verse: ref.verse }).catch(() => null)
  if (!verse?.text?.trim()) return "empty"
  useBibleStore.getState().selectVerse(verse)
  useBibleStore.getState().setPendingNavigation({ bookNumber: verse.book_number, chapter: verse.chapter, verse: verse.verse })
  return "previewed"
}

/**
 * The main desk's "Activate on Bible feeds": the verse becomes the live Bible source, so every feed
 * that follows Bible (NDI, browser feeds, a scene's Bible box) shows it, and the main screens keep
 * what they show. It waits in the preview for Show live.
 */
export async function activateOnBibleFeeds(verse: Verse, opts: { itemId?: string | null; by?: string } = {}): Promise<PresentOutcome> {
  const outcome = await presentVerse(verse, { sourceOnly: true, itemId: opts.itemId ?? null, by: opts.by })
  if (outcome === "presented") {
    if (useBroadcastStore.getState().rehearsal) toast.info("Rehearsal: the Bible feeds were not changed")
    else toast.success(`${verse.book_name} ${verse.chapter}:${verse.verse} is on the Bible feeds`, { description: "The main screens still show what they showed. Take live puts it there too." })
  }
  return outcome
}

/** How many outputs follow Bible (on their own or through a scene's Bible box): where "Activate on Bible feeds" shows. */
export function bibleFeedCount(outputs: readonly BroadcastOutput[], scenes: readonly Scene[]): number {
  return followerCount("bible", outputs, scenes)
}
