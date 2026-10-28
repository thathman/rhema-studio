import { cancelPendingPresents, presentCustomSlide, presentImage, presentSlide, presentVerse, type PresentOutcome } from "@/hooks/use-broadcast"
import { fetchChapter, stepVerse } from "@/hooks/use-bible"
import { resolveTranslations, isMissing } from "@/lib/translation-policy"
import { useBibleStore } from "@/stores/bible-store"
import { currentActor, useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { isCueItem, isImageItem, isSlideItem, isSongItem, isVerseItem, type CueQueueItem, type QueueItem, type SongWithSections } from "@/types"
import { isSkipped } from "@/lib/run-of-show"
import { useMediaStore } from "@/stores/media-store"
import { serviceSongNow } from "@/stores/song-pins-store"
import { approvalHolds, useApprovalGateStore } from "@/stores/approval-gate-store"
import { runTakeSteps, takesSourceOnly } from "@/lib/take-steps"
import { toast } from "sonner"
import { useJournalStore } from "@/stores/journal-store"
import { useTakeAttemptStore, type TakeAttemptOutcome } from "@/stores/take-attempt-store"
import { useServiceStore } from "@/stores/service-store"

// Audio and Bible-source-only Takes do not supersede a pending audience visual.
// Their rundown commit is ignored if a visual Take has since been requested.
let latestVisualTake = 0

/**
 * After an item's content is presented by the operator's own Take: its armed Take steps run once,
 * when it was not already the item up (not for the next slide of the same song, or a Take again).
 */
function afterTake(item: QueueItem, entering: boolean) {
  return (outcome: PresentOutcome | void) => {
    if (outcome === "presented" && entering) void runTakeSteps(item)
  }
}

/** Whether this item is what is up now: on the main screens, or (a "Bible feeds only" reading) on the Bible source. */
function isUp(item: QueueItem): boolean {
  const b = useBroadcastStore.getState()
  if (takesSourceOnly(item)) return b.sources.bible?.on === true && b.sources.bible.itemId === item.id
  return b.isLive && b.liveItemId === item.id
}

function beginTakeAttempt(itemId: string | null, reference: string): number {
  const by = currentActor()
  const id = useTakeAttemptStore.getState().begin({ itemId, reference, ...(by ? { by } : {}) })
  useJournalStore.getState().add({ kind: "take", label: `Take pending: ${reference}`, itemId, ...(by ? { by } : {}) })
  return id
}

/** Record the attempt separately; only a successful result moves the rundown position. */
function finishTakeAttempt(id: number, itemId: string | null, reference: string, outcome: TakeAttemptOutcome, positionGeneration: number, error?: string): void {
  useTakeAttemptStore.getState().finish(id, outcome, error)
  const attempt = useTakeAttemptStore.getState().attempts.find((current) => current.id === id)
  if (outcome === "presented" && itemId && positionGeneration === latestVisualTake) {
    const index = useQueueStore.getState().items.findIndex((item) => item.id === itemId)
    if (index !== -1) useQueueStore.getState().setActive(index)
  }
  const status = attempt?.status ?? (outcome === "presented" ? "succeeded" : outcome === "superseded" ? "superseded" : "failed")
  const reason = error ? `: ${error}` : outcome !== "presented" ? ` (${outcome})` : ""
  const by = attempt?.by
  useJournalStore.getState().add({ kind: "take", label: `Take ${status}: ${reference}${reason}`, itemId, ...(by ? { by } : {}) })
}

/** A reading armed "Bible feeds only": its Take activates the Bible source; the main screens keep what they show. */
async function takeOnBibleFeeds(item: QueueItem): Promise<PresentOutcome> {
  if (!isVerseItem(item)) return "empty"
  const outcome = await presentVerse(item.verse, { sourceOnly: true, item, itemId: item.id, background: item.background })
  if (outcome === "presented") {
    if (useBroadcastStore.getState().rehearsal) toast.info("Rehearsal: the Bible feeds were not changed")
    else toast.success(`${item.reference} is on the Bible feeds`, { description: "This item is set to Bible feeds only in Prepare: the main screens keep what they show." })
  }
  return outcome
}

function sameSnapshot(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Whether the same Preview target and queue routing are still selected after an approval hold. */
function sendToLivePreviewIsCurrent(bible: ReturnType<typeof useBibleStore.getState>, queue: ReturnType<typeof useQueueStore.getState>): boolean {
  const currentBible = useBibleStore.getState()
  const currentQueue = useQueueStore.getState()
  const selectedSlide = bible.selectedSlide
  if (selectedSlide) {
    const selected = currentBible.selectedSlide
    if (!selected || !sameSnapshot(selected, selectedSlide)) return false
    const capturedQueueItem = queue.items.find((item) => item.id === selectedSlide.item.id)
    const currentQueueItem = currentQueue.items.find((item) => item.id === selected.item.id)
    if (Boolean(capturedQueueItem) !== Boolean(currentQueueItem)) return false
    return sameSnapshot(capturedQueueItem ?? selectedSlide.item, currentQueueItem ?? selected.item)
  }

  const verse = bible.selectedVerse
  if (!verse || !sameSnapshot(currentBible.selectedVerse, verse)) return false
  const matchesVerse = (item: QueueItem) =>
    isVerseItem(item) &&
    item.verse.book_number === verse.book_number &&
    item.verse.chapter === verse.chapter &&
    item.verse.verse === verse.verse
  const capturedQueueItem = queue.items.find(matchesVerse)
  const currentQueueItem = currentQueue.items.find(matchesVerse)
  if (!sameSnapshot(capturedQueueItem ?? null, currentQueueItem ?? null)) return false
  const capturedTranslation = bible.translations.find((item) => item.id === verse.translation_id)?.abbreviation ?? null
  const currentTranslation = currentBible.translations.find((item) => item.id === verse.translation_id)?.abbreviation ?? null
  return capturedTranslation === currentTranslation
}

/** An approval dialog may outlive the selected item or service; never let its retry take stale output. */
function retryHeldTakeIfCurrent(
  attemptId: number,
  itemId: string | null,
  reference: string,
  targetIsCurrent: () => boolean,
  retry: () => void,
): () => void {
  const heldService = useServiceStore.getState().current
  return () => {
    const currentService = useServiceStore.getState().current
    if (
      !heldService ||
      currentService?.id !== heldService.id ||
      currentService.revision !== heldService.revision ||
      !targetIsCurrent()
    ) {
      if (heldService) useApprovalGateStore.getState().revokeAcknowledgment(heldService.id)
      finishTakeAttempt(attemptId, itemId, reference, "superseded", latestVisualTake)
      toast.info("The service or Preview changed while approval was pending. Take the current selection again.")
      return
    }
    retry()
  }
}

/**
 * Find the queue index of the item currently on the live output.
 * Returns null when the live content came from somewhere other than the queue.
 */
function findLiveQueueIndex(): number | null {
  const { liveVerse, liveItemId } = useBroadcastStore.getState()
  if (!liveVerse) return null
  const items = useQueueStore.getState().items
  const index = liveItemId
    ? items.findIndex((item) => item.id === liveItemId)
    : items.findIndex((item) => isVerseItem(item) && item.reference === liveVerse.reference)
  return index >= 0 ? index : null
}

/**
 * Present a rundown item; the active position moves only after a successful Take.
 * Verses go live in their saved translations; songs at `slide` (default the
 * first, "last" for stepping backwards into a song).
 * Next/Previous/double-click/OSC/HTTP all come here.
 */
export async function presentQueueItem(index: number, slide: number | "last" = 0, songAs?: { arrangement_id: string | null; languages: string[]; song?: SongWithSections }, opts: { automatic?: boolean } = {}): Promise<void> {
  const item = useQueueStore.getState().items[index]
  if (!item) return
  const id = item.id
  // A cue-only moment (#193) shows nothing: taking it fires its cues; the screens keep what they show.
  if (isCueItem(item)) return takeCueItem(item, index)
  const sourceOnly = takesSourceOnly(item)
  // A reading for the Bible feeds only does not reach the main screens, like Activate on Bible feeds.
  const attemptId = beginTakeAttempt(id, item.reference)
  const retry = retryHeldTakeIfCurrent(
    attemptId,
    id,
    item.reference,
    () => useQueueStore.getState().items.some((current) => current.id === id && sameSnapshot(current, item)),
    () => {
      const currentIndex = useQueueStore.getState().items.findIndex((current) => current.id === id)
      if (currentIndex !== -1) void presentQueueItem(currentIndex, slide, songAs, opts)
    },
  )
  if (!isSoundItem(item) && !sourceOnly && approvalHolds(retry)) {
    finishTakeAttempt(attemptId, id, item.reference, "held_for_approval", latestVisualTake)
    return
  }
  const positionGeneration = isSoundItem(item) || sourceOnly ? latestVisualTake : ++latestVisualTake
  // A timed move or a phase that runs by itself is not the operator's Take: its steps do not run.
  const took = afterTake(item, !opts.automatic && !isUp(item))
  try {
    let outcome: PresentOutcome
    if (isSlideItem(item)) outcome = await presentCustomSlide(item, { goLive: true })
    else if (isImageItem(item)) outcome = await presentImage(item, { goLive: true })
    else if (isSongItem(item)) {
      // Stepping within the live song keeps the arrangement it went live with.
      const songItem = songAs ? { ...item, song: { ...item.song, arrangement_id: songAs.arrangement_id, languages: songAs.languages } } : item
      outcome = await presentSlide(songItem, slide, { goLive: true, song: songAs?.song })
    } else {
      // Navigate the Bible panel to the presented verse, as detections do.
      useBibleStore.getState().setPendingNavigation({
        bookNumber: item.verse.book_number,
        chapter: item.verse.chapter,
        verse: item.verse.verse,
      })
      outcome = sourceOnly
        ? await takeOnBibleFeeds(item)
        : await presentVerse(item.verse, { item, goLive: true, itemId: item.id, background: item.background })
    }
    finishTakeAttempt(attemptId, id, item.reference, outcome, positionGeneration)
    took(outcome)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    finishTakeAttempt(attemptId, id, item.reference, "error", positionGeneration, error)
    console.warn("[remote-actions] presentQueueItem failed:", e)
  }
}

/**
 * Take a cue-only moment (#193): it becomes the active item, and its event starts (following the
 * screens) so its cues run; with the clock run on its own its "when it starts" cues run now, and
 * the timekeeper starts its event. Nothing on the screens changes. Not in rehearsal.
 */
async function takeCueItem(item: CueQueueItem, index: number): Promise<void> {
  // Cue-only moments are event actions, not screen Takes: their event clock and cue semantics stay independent.
  useQueueStore.getState().setActive(index)
  if (useBroadcastStore.getState().rehearsal) {
    toast.info(`Rehearsal: the cues of ${item.reference} were not run`)
    return
  }
  // Imported when needed: these modules import this one.
  const [{ useEventClock }, { runItemCues }] = await Promise.all([import("@/stores/event-clock-store"), import("@/stores/on-live-cues")])
  const clock = useEventClock.getState()
  if (clock.mode === "screens") clock.start(item.id)
  else await runItemCues(item, "live")
}

/** From `index` on in direction `dir`, the first item Present runs (hidden ones and a skipped phase are passed over, #193). */
function shownFrom(index: number, dir: 1 | -1): number {
  const { items, headers } = useQueueStore.getState()
  let i = index
  while (i >= 0 && i < items.length && isSkipped(items, headers, i)) i += dir
  return i
}

/**
 * Next/Previous step through a song's slides first, then on to the next
 * item; stepping back into a song lands on its last slide.
 */
/** A rundown item whose library file is a sound. */
function isSoundItem(item: QueueItem | undefined): boolean {
  if (!item || !isImageItem(item)) return false
  const id = item.image.media_id
  return useMediaStore.getState().assets.find((a) => a.id === id)?.kind === "audio"
}

function stepQueue(offset: number): Promise<void> {
  const { items, activeIndex } = useQueueStore.getState()
  if (items.length === 0) return Promise.resolve()

  const current = activeIndex ?? findLiveQueueIndex()
  // A quick screen over a song: Next/Previous carry on in the song underneath.
  const b = useBroadcastStore.getState()
  const live = b.liveSlide ?? (b.liveVerse?.quick ? b.heldLive?.liveSlide ?? null : null)
  // The live item was removed: step to the item that followed it, or the one before.
  // (Only while one of them is still in the rundown: another service opened since makes it stale;
  // a neighbour removed since is found from the other one.)
  const gap = useQueueStore.getState().removedActive
  const known = (id: string | null) => (id ? items.findIndex((i) => i.id === id) : -1)
  const prev = gap ? known(gap.prevId) : -1
  const nextNeighbour = gap ? known(gap.nextId) : -1
  if (gap && (prev !== -1 || nextNeighbour !== -1)) {
    const near = offset > 0 ? (nextNeighbour !== -1 ? nextNeighbour : gap.nextId === null ? -1 : prev + 1) : prev !== -1 ? prev : gap.prevId === null ? -1 : nextNeighbour - 1
    const index = near < 0 ? near : shownFrom(near, offset > 0 ? 1 : -1)
    return index < 0 || index >= items.length ? Promise.resolve() : presentQueueItem(index)
  }
  if (current !== null) {
    const item = items[current]
    // Within the live song, unless it has been deleted from the library (then Next moves on).
    if (item && isSongItem(item) && live && live.itemId === item.id && serviceSongNow(item.song.song_id)) {
      const next = live.index + offset
      if (next >= 0 && next < live.total) {
        // An arrangement or language change made while the song is live applies the next time it is entered.
        const songAs = live.arrangementId !== undefined ? { arrangement_id: live.arrangementId, languages: live.languages ?? item.song.languages, song: live.song } : undefined
        return presentQueueItem(current, next, songAs)
      }
    }
  }
  const dir = offset > 0 ? 1 : -1
  // Hidden items and a skipped phase are passed over; with none left that way, it stays put (#193).
  const passed = current === null ? -1 : shownFrom(current + offset, dir)
  let target =
    current === null
      ? shownFrom(0, 1)
      : passed < 0 || passed >= items.length ? current : passed
  // Sound items play only when reached going forward: Previous steps over
  // them (walk-in music does not start again on the way back), and Next at
  // the end of the service does not replay a final sound.
  if (current !== null && isSoundItem(items[target])) {
    if (offset < 0) {
      while (target > 0 && isSoundItem(items[target])) target -= 1
      if (isSoundItem(items[target])) return Promise.resolve()
    } else if (target === current) return Promise.resolve()
  }
  const atEdge = target === current
  const song = items[target] && isSongItem(items[target])
  // At the edge a song stays on its slide (re-presents it, e.g. after Clear);
  // a verse re-presents too. Entering a song from below starts at its last slide.
  return presentQueueItem(target, song ? (atEdge ? (live?.index ?? 0) : offset < 0 ? "last" : 0) : 0)
}

// Chapter-crossing ticket: a slow lookup must not land after a newer step.
let verseStepSeq = 0

/**
 * Continue a reading: present the verse after (or before) the one on the
 * live output, in the same translations, on air in one step. Crosses
 * chapter boundaries; stops at the ends of a book. With nothing live it
 * steps the Bible panel instead (the preview), like the panel's arrows.
 */
export async function stepLiveVerse(offset: 1 | -1): Promise<void> {
  const { liveSourceVerse: source, liveItem, liveItemId } = useBroadcastStore.getState()
  // Who stepped (a joined Bible desk): known only now, before the chapter lookups.
  const by = currentActor()
  if (!source) {
    // No verse to continue: step the Bible panel. Off air it also readies that verse;
    // with a song, slide or quick screen on air it never replaces it (preview only).
    await stepVerse(offset === 1 ? "next" : "prev", { present: !useBroadcastStore.getState().isLive })
    return
  }
  verseStepSeq += 1
  const ticket = verseStepSeq
  const bible = useBibleStore.getState()
  const choice = resolveTranslations(liveItem, bible)
  const translationId = isMissing(choice) ? bible.activeTranslationId : choice.primary
  try {
    let target: { chapter: number; verse: number } | null = null
    if (offset === 1) {
      const same = await fetchChapter(source.book_number, source.chapter, translationId)
      if (same.some((v) => v.verse === source.verse + 1)) target = { chapter: source.chapter, verse: source.verse + 1 }
      else {
        const next = await fetchChapter(source.book_number, source.chapter + 1, translationId)
        if (next.length > 0) target = { chapter: source.chapter + 1, verse: next[0].verse }
      }
    } else if (source.verse > 1) {
      target = { chapter: source.chapter, verse: source.verse - 1 }
    } else if (source.chapter > 1) {
      const prev = await fetchChapter(source.book_number, source.chapter - 1, translationId)
      if (prev.length > 0) target = { chapter: source.chapter - 1, verse: prev[prev.length - 1].verse }
    }
    if (ticket !== verseStepSeq) return
    if (!target) {
      useBroadcastStore.getState().setPresentWarning(
        offset === 1 ? `${source.book_name} ends at ${source.chapter}:${source.verse}.` : `${source.book_name} starts at 1:1.`
      )
      return
    }
    const verse = { ...source, ...target, id: 0, text: "" }
    useBibleStore.getState().setPendingNavigation({ bookNumber: verse.book_number, chapter: verse.chapter, verse: verse.verse })
    // Still the operator's item (its background, and Next continues from it).
    const background = liveItemId ? (useQueueStore.getState().items.find((i) => i.id === liveItemId)?.background ?? null) : null
    await presentVerse(verse, { item: liveItem, goLive: true, itemId: liveItemId, background, by })
  } catch (e) {
    console.warn("[remote-actions] stepLiveVerse failed:", e)
  }
}

/**
 * Operator actions reachable from every control surface — OSC, the HTTP API,
 * and (from Phase 2) the keyboard. Each surface dispatches into this registry
 * rather than carrying its own copy of the behaviour, so the surfaces cannot
 * drift apart.
 *
 * Plain functions over `getState()`, never hooks: these run from Tauri event
 * callbacks, outside React's render cycle.
 */
function sendToLivePreview(
  bible: ReturnType<typeof useBibleStore.getState>,
  queue: ReturnType<typeof useQueueStore.getState>,
): Promise<void> {
  // A cue-only moment in Preview: Take fires its cues and shows nothing, so approval is not asked (#193).
  const cue = bible.selectedSlide?.item
  if (cue && isCueItem(cue)) {
    const at = useQueueStore.getState().items.findIndex((i) => i.id === cue.id)
    return at === -1 ? Promise.resolve() : takeCueItem(cue, at)
  }
  if (bible.selectedSlide) {
    const { item, index, song } = bible.selectedSlide
    // The copy taken when the song went live only while that song is still on air.
    const stillLive = useBroadcastStore.getState().liveSlide?.itemId === item.id
    const idx = queue.items.findIndex((i) => i.id === item.id)
    // The rundown's copy carries the steps armed in Prepare since it was put in Preview.
    const queueItem = queue.items[idx] ?? item
    const sourceOnly = isVerseItem(item) && idx !== -1 && takesSourceOnly(queueItem)
    const attemptId = beginTakeAttempt(idx === -1 ? null : item.id, queueItem.reference)
    if (
      !isSoundItem(item) &&
      !sourceOnly &&
      approvalHolds(retryHeldTakeIfCurrent(
        attemptId,
        idx === -1 ? null : item.id,
        queueItem.reference,
        () => sendToLivePreviewIsCurrent(bible, queue),
        () => void sendToLivePreview(bible, queue),
      ))
    ) {
      finishTakeAttempt(attemptId, idx === -1 ? null : item.id, queueItem.reference, "held_for_approval", latestVisualTake)
      return Promise.resolve()
    }
    const positionGeneration = isSoundItem(item) || sourceOnly ? latestVisualTake : ++latestVisualTake
    const took = afterTake(queueItem, !isUp(item))
    const presenting: Promise<PresentOutcome> = isSlideItem(item)
      ? presentCustomSlide(item, { goLive: true })
      : isImageItem(item)
        ? presentImage(item, { goLive: true })
        : isSongItem(item)
          ? presentSlide(item, index, { goLive: true, song: stillLive ? song : undefined })
          : Promise.resolve<PresentOutcome>("empty")
    return presenting.then((outcome) => {
      finishTakeAttempt(attemptId, idx === -1 ? null : item.id, queueItem.reference, outcome, positionGeneration)
      took(outcome)
    }).catch((e) => {
      const error = e instanceof Error ? e.message : String(e)
      finishTakeAttempt(attemptId, idx === -1 ? null : item.id, queueItem.reference, "error", positionGeneration, error)
      console.warn("[remote-actions] sendToLive (slide) failed:", e)
    })
  }
  const selectedVerse = bible.selectedVerse
  if (!selectedVerse) return Promise.resolve()
  const idx = queue.items.findIndex(
    (item) =>
      isVerseItem(item) &&
      item.verse.book_number === selectedVerse.book_number &&
      item.verse.chapter === selectedVerse.chapter &&
      item.verse.verse === selectedVerse.verse,
  )
  const rundownItem = idx === -1 ? null : queue.items[idx]
  const itemId = rundownItem?.id ?? null
  const reference = rundownItem?.reference ?? `${selectedVerse.book_name} ${selectedVerse.chapter}:${selectedVerse.verse}`
  const sourceOnly = rundownItem !== null && takesSourceOnly(rundownItem)
  const attemptId = beginTakeAttempt(itemId, reference)
  if (
    !sourceOnly &&
    approvalHolds(retryHeldTakeIfCurrent(
      attemptId,
      itemId,
      reference,
      () => sendToLivePreviewIsCurrent(bible, queue),
      () => void sendToLivePreview(bible, queue),
    ))
  ) {
    finishTakeAttempt(attemptId, itemId, reference, "held_for_approval", latestVisualTake)
    return Promise.resolve()
  }
  const positionGeneration = sourceOnly ? latestVisualTake : ++latestVisualTake
  const took = rundownItem ? afterTake(rundownItem, !isUp(rundownItem)) : () => {}
  // A reading armed "Bible feeds only" in Prepare: Take live sends it there, in its own translations.
  if (rundownItem && sourceOnly) return takeOnBibleFeeds(rundownItem).then((outcome) => {
    finishTakeAttempt(attemptId, itemId, reference, outcome, positionGeneration)
    took(outcome)
  }).catch((e) => {
    const error = e instanceof Error ? e.message : String(e)
    finishTakeAttempt(attemptId, itemId, reference, "error", positionGeneration, error)
    console.warn("[remote-actions] sendToLive (Bible feeds) failed:", e)
  })
  const previewed = bible.translations.find((t) => t.id === selectedVerse.translation_id)?.abbreviation ?? null
  return presentVerse(selectedVerse, {
    goLive: true,
    itemId: rundownItem?.id ?? null,
    background: rundownItem?.background ?? null,
    item: {
      translation: previewed,
      secondary_translation: rundownItem && isVerseItem(rundownItem) ? (rundownItem.secondary_translation ?? null) : null,
    },
  }).then((outcome) => {
    finishTakeAttempt(attemptId, itemId, reference, outcome, positionGeneration)
    took(outcome)
  }).catch((e) => {
    const error = e instanceof Error ? e.message : String(e)
    finishTakeAttempt(attemptId, itemId, reference, "error", positionGeneration, error)
    console.warn("[remote-actions] sendToLive failed:", e)
  })
}

export const remoteActions = {
  /**
   * Present what Program preview shows, on air, in the translation the preview
   * is in. When the preview is a rundown item, that item becomes active and its
   * saved secondary translation applies.
   */
  // Returns when the content is on air (or the present failed), so a cue's next step waits for it.
  sendToLive: (): Promise<void> =>
    sendToLivePreview(useBibleStore.getState(), useQueueStore.getState()),

  /** Queue the verse showing in Program preview. Duplicates are dropped by the store. */
  addToQueue: () => {
    const { selectedVerse } = useBibleStore.getState()
    if (!selectedVerse) return
    useQueueStore.getState().addItem({
      id: crypto.randomUUID(),
      verse: selectedVerse,
      reference: `${selectedVerse.book_name} ${selectedVerse.chapter}:${selectedVerse.verse}`,
      confidence: 1,
      source: "manual",
      added_at: Date.now(),
    })
  },

  queueNext: (): Promise<void> => stepQueue(1),
  queuePrev: (): Promise<void> => stepQueue(-1),

  /** Step the Bible Text panel one verse. Leaves the queue alone. */
  bibleNext: () => stepVerse("next"),
  biblePrev: () => stepVerse("prev"),

  /** Continue the reading on the live output by one verse. */
  verseNext: (): Promise<void> => stepLiveVerse(1),
  versePrev: (): Promise<void> => stepLiveVerse(-1),

  /** Off air also cancels any present still loading, so it cannot reappear later. */
  toggleOnAir: (active: boolean) => {
    if (active && approvalHolds(() => remoteActions.toggleOnAir(true))) return
    if (!active) cancelPendingPresents()
    useBroadcastStore.getState().setLive(active)
  },
}
