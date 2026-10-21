import { invoke } from "@tauri-apps/api/core"
import { mark } from "@/lib/latency-marks"
import { composeQrSlide } from "@/lib/qr-bulletin"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useBibleStore } from "@/stores/bible-store"
import type { VerseRenderData } from "@/types"
import type { ImageQueueItem, SlideQueueItem, SongQueueItem, Verse } from "@/types"
import { useMediaStore } from "@/stores/media-store"
import { loadThemeImage } from "@/lib/theme-image-cache"
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
  /** The rundown item id the verse came from, for highlighting and stepping. */
  itemId?: string | null
  /** A library picture to draw behind the text. */
  background?: { media_id: string } | null
}

/** Data-URL fill for a background picture, or null (missing file → no background, text still shows). */
export async function backgroundFill(background: { media_id: string } | null | undefined): Promise<VerseRenderData["image"] | undefined> {
  if (!background) return undefined
  try {
    const url = await useMediaStore.getState().dataUrl(background.media_id)
    if (!url) return undefined
    if (typeof Image !== "undefined") await loadThemeImage(url)
    return { url, fit: "cover", blur: 0, brightness: 100, tint: null }
  } catch {
    return undefined
  }
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

  const [image, fetchedVerses] = await Promise.all([
    backgroundFill(opts.background),
    Promise.all(
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
    ),
  ])
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
  const data = renderEntries.length > 1
    ? toDualVerseRenderData(renderEntries)
    : toVerseRenderData(renderEntries[0]?.verse ?? verseToPresent, renderEntries[0]?.translation ?? "KJV")
  useBroadcastStore
    .getState()
    .setLiveVerse(
      image ? { ...data, image } : data,
      verseToPresent,
      { goLive: opts.goLive, item: opts.item ?? null, itemId: opts.itemId ?? null }
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
  const image = await backgroundFill(item.background)
  if (ticket !== presentSeq) return "superseded"
  useBibleStore.getState().selectSlide({ item, index: i })
  useBroadcastStore.getState().setLiveVerse({ ...toLyricRenderData(song, slide), ...(image ? { image } : {}) }, null, {
    goLive: opts.goLive,
    slide: { itemId: item.id, songId: song.song.id, index: i, total: slides.length },
  })
  if (slide.missing.length > 0) {
    warn(`${slide.sectionLabel} has no ${slide.missing.join(" / ").toUpperCase()} text; showing what there is.`)
  }
  return "presented"
}

export function toCustomSlideRenderData(item: SlideQueueItem): VerseRenderData {
  const lines = item.slide.body.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean)
  // The link is always printed under the code, so what is scanned is what is read.
  if (item.slide.link) lines.push(item.slide.link)
  return { kind: "slide", reference: item.slide.title.trim(), segments: [{ text: lines.join(" ") }], lines }
}

/**
 * Present a custom slide. Nothing to fetch, so it lands in one update; it
 * still takes a ticket so a verse or song that was loading cannot overtake it.
 */
export async function presentCustomSlide(item: SlideQueueItem, opts: { goLive?: boolean } = {}): Promise<PresentOutcome> {
  presentSeq += 1
  const ticket = presentSeq
  const data = toCustomSlideRenderData(item)
  if (!data.reference && data.lines?.length === 0) {
    useBroadcastStore.getState().setPresentWarning("Empty slide not shown: give it a title or some text.")
    return "empty"
  }
  // A QR slide is one composed picture (code + words on a white panel) with no
  // text layer, so no scrim or words land on the code; a background picture is
  // not used for it. Otherwise, no background means a synchronous present.
  let render: VerseRenderData = data
  if (item.slide.link) {
    try {
      const body = item.slide.body.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean)
      const url = await composeQrSlide(item.slide.link, item.slide.title, body)
      render = { kind: "slide", reference: "", segments: [], lines: [], image: { url, fit: "contain", blur: 0, brightness: 100, tint: null } }
    } catch (e) {
      console.warn("[broadcast] QR could not be drawn:", e)
      useBroadcastStore.getState().setPresentWarning("The QR code could not be drawn; showing the words and the address only.")
    }
  } else if (item.background) {
    const image = await backgroundFill(item.background)
    if (image) render = { ...data, image }
  }
  if (ticket !== presentSeq) return "superseded"
  useBibleStore.getState().selectSlide({ item, index: 0 })
  useBroadcastStore.getState().setLiveVerse(render, null, { goLive: opts.goLive, itemId: item.id })
  return "presented"
}

export function toVideoRenderData(item: ImageQueueItem, url: string, token = 0): VerseRenderData {
  return { kind: "image", reference: "", segments: [], video: { url, fit: item.image.fit, loop: item.image.loop === true, sound: item.image.sound !== false, name: item.image.name, token } }
}

export function toImageRenderData(item: ImageQueueItem, url: string): VerseRenderData {
  return { kind: "image", reference: "", segments: [], image: { url, fit: item.image.fit, blur: 0, brightness: 100, tint: null } }
}

/**
 * Present a picture item: read it from the media folder (cached), decode
 * it, then put it on air in one update. A missing file is reported and the
 * output left alone; a newer present or Clear supersedes a slow read.
 */
export async function presentImage(item: ImageQueueItem, opts: { goLive?: boolean } = {}): Promise<PresentOutcome> {
  presentSeq += 1
  const ticket = presentSeq
  // A video asset streams to the outputs; nothing is decoded here.
  const media = useMediaStore.getState()
  const asset = media.assets.find((a) => a.id === item.image.media_id) ?? (await media.list()).find((a) => a.id === item.image.media_id)
  if (asset?.kind === "video") {
    const videoUrl = asset.present ? await media.fileUrl(asset.id).catch(() => null) : null
    if (ticket !== presentSeq) return "superseded"
    if (!videoUrl) {
      useBroadcastStore.getState().setPresentWarning(`${item.image.name} not shown: the video file is missing from the media folder.`)
      return "empty"
    }
    useBibleStore.getState().selectSlide({ item, index: 0 })
    useBroadcastStore.getState().setLiveVerse(toVideoRenderData(item, videoUrl, ticket), null, { goLive: opts.goLive, itemId: item.id })
    return "presented"
  }
  let url: string | null = null
  try {
    url = await useMediaStore.getState().dataUrl(item.image.media_id)
    if (url && typeof Image !== "undefined") await loadThemeImage(url)
  } catch (e) {
    console.warn("[broadcast] picture load failed:", e)
  }
  if (ticket !== presentSeq) return "superseded"
  if (!url) {
    useBroadcastStore.getState().setPresentWarning(`${item.image.name} not shown: the picture file is missing from the media folder.`)
    return "empty"
  }
  useBibleStore.getState().selectSlide({ item, index: 0 })
  useBroadcastStore.getState().setLiveVerse(toImageRenderData(item, url), null, { goLive: opts.goLive, itemId: item.id })
  return "presented"
}

/**
 * Built-in screens a volunteer needs in a hurry. Text only; themed like
 * everything else. `yo` lines show under the English when a Yorùbá
 * translation is the active or secondary Bible (the dual-language theme
 * draws them in the secondary style).
 */
export const QUICK_SCREENS = {
  welcome: { title: "Welcome", lines: ["We're glad you're here."], yo: ["Ẹ kú àbọ̀. Inú wa dùn pé ẹ wá."] },
  stand: { title: "", lines: ["Please stand"], yo: ["Ẹ jọ̀wọ́ ẹ dìde"] },
  pray: { title: "", lines: ["Let us pray"], yo: ["Ẹ jẹ́ kí a gbàdúrà"] },
  offering: { title: "Offering", lines: ["Give as the Lord leads"], yo: ["Ẹ fúnni bí Olúwa ṣe darí yín"] },
  technical: { title: "", lines: ["We're having technical difficulties", "Please bear with us"], yo: ["A ní ìṣòro ẹ̀rọ díẹ̀", "Ẹ jọ̀wọ́ ẹ ní sùúrù"] },
} as const
/** Text screens above, plus two without text: a black frame and the church logo. */
export type QuickScreen = keyof typeof QUICK_SCREENS | "black" | "logo"

/** Is a Yorùbá Bible in use right now (active or secondary)? Then screens go bilingual. */
export function yorubaInUse(): boolean {
  const b = useBibleStore.getState()
  return b.translations.some((t) => t.language === "yo" && (t.id === b.activeTranslationId || t.id === b.secondaryTranslationId))
}

/**
 * Put a quick screen on air now. Whatever was live is held so Back can
 * return to it; Next/Previous/Show live drop the hold because the operator
 * has moved on.
 */
export function presentQuickScreen(screen: QuickScreen): void {
  presentSeq += 1
  const store = useBroadcastStore.getState()
  store.holdLive()
  if (screen === "black" || screen === "logo") {
    store.setLiveVerse({ kind: "slide", reference: "", segments: [], lines: [], screen }, null, { goLive: true, keepHeld: true })
    return
  }
  const { title, lines, yo } = QUICK_SCREENS[screen]
  const bilingual = yorubaInUse()
  store.setLiveVerse(
    { kind: "slide", reference: title, segments: [{ text: lines.join(" ") }], lines: [...lines], ...(bilingual ? { secondaryLines: [...yo] } : {}) },
    null,
    { goLive: true, keepHeld: true }
  )
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
