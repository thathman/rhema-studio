import { useEffect, useRef } from "react"
import { presentVerse } from "@/hooks/use-broadcast"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { isMissing, resolveTranslations } from "@/lib/translation-policy"

let changedByVoice = false

/** The next translation change came from speech ("read it in NIV"), not the operator. */
export function noteVoiceTranslationChange(): void {
  changedByVoice = true
}

/**
 * When the operator changes translation, a verse on the output follows it
 * (an item's saved translations still win). Through presentVerse, so the
 * item, its background and stale-result protection are kept. Only on an
 * actual change: never when a panel opens (PRD §2: preparing never changes
 * on-air pixels). A change made by speech moves the screen only when Auto is
 * on (FR-01). Mounted once, at the root.
 */
export function useLiveTranslationFollow(): void {
  const active = useBibleStore((s) => s.activeTranslationId)
  const secondary = useBibleStore((s) => s.secondaryTranslationId)
  const last = useRef<string | null>(null)
  useEffect(() => {
    const key = `${active}|${secondary}`
    const previous = last.current
    last.current = key
    const byVoice = changedByVoice
    changedByVoice = false
    if (previous === null || previous === key) return
    const [prevActive, prevSecondary] = previous.split("|").map((x) => (x === "null" ? null : Number(x)))
    followTranslationOnAir(byVoice, { activeTranslationId: prevActive as number, secondaryTranslationId: prevSecondary })
  }, [active, secondary])
}

export function followTranslationOnAir(byVoice: boolean, before?: { activeTranslationId: number; secondaryTranslationId: number | null }): void {
  const { liveSourceVerse, liveItem, liveItemId, autoLive, sources } = useBroadcastStore.getState()
  if (byVoice && !autoLive) return
  // An item's saved translations can make the change irrelevant to what is on air.
  const changesFor = (item: typeof liveItem) => {
    if (!before) return true
    const bible = useBibleStore.getState()
    const was = resolveTranslations(item, { ...bible, ...before })
    const now = resolveTranslations(item, bible)
    return isMissing(was) || isMissing(now) || was.primary !== now.primary || was.secondary !== now.secondary
  }
  // A verse sent to the Bible feeds alone (Auto "Bible feeds only"), other than Program's: it follows
  // too, after Program, so the feeds keep showing it and not Program's verse (#446).
  const feed = sources.bible?.on && sources.bible.verse ? sources.bible : null
  const sameVerse = (a: { book_number: number; chapter: number; verse: number }, b: typeof a | null) => !!b && a.book_number === b.book_number && a.chapter === b.chapter && a.verse === b.verse
  const feedApart = feed && !sameVerse(feed.verse!, liveSourceVerse) && changesFor(feed.item ?? null) ? feed : null
  const program = liveSourceVerse && changesFor(liveItem) ? liveSourceVerse : null
  if (!program && !feedApart) return
  const background = liveItemId ? (useQueueStore.getState().items.find((i) => i.id === liveItemId)?.background ?? null) : null
  // One after the other: each present supersedes one still loading.
  void (async () => {
    if (program) await presentVerse(program, { item: liveItem, itemId: liveItemId, background, follow: true })
    if (feedApart) await presentVerse(feedApart.verse!, { item: feedApart.item ?? null, itemId: feedApart.itemId, sourceOnly: true })
  })()
}
