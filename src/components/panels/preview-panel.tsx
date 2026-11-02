import { useEffect, useRef, useState } from "react"
import { PanelHeader } from "@/components/ui/panel-header"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { useBibleStore, useBroadcastStore } from "@/stores"
import { bibleActions } from "@/hooks/use-bible"
import { toCustomSlideRenderData, toDualVerseRenderData, toImageRenderData, toVideoRenderData, toVerseRenderData } from "@/hooks/use-broadcast"
import { isAudioItem, isCueItem, isImageItem, isSlideItem, isSongItem, isVerseItem } from "@/types"
import { useMediaStore } from "@/stores/media-store"
import { useSongStore } from "@/stores/song-store"
import { songSlides, toLyricRenderData } from "@/lib/lyrics"
import { useServiceSong } from "@/stores/song-pins-store"
import { useSelectedItem } from "@/studio/prepare/use-selected-item"
import { ItemPlan } from "@/studio/prepare/item-plan"
import { planLines } from "@/lib/item-intent"
import { useSettingsStore } from "@/stores/settings-store"
import { usePreviewLabel } from "@/hooks/use-preview-label"
import { useServiceStore } from "@/stores/service-store"
import { forOutputLanguage, isOutputLanguageFallback, OUTPUT_LANGUAGE_FALLBACK_NOTICE } from "@/lib/output-language"
import { isMissing, resolveTranslations } from "@/lib/translation-policy"
import type { Verse } from "@/types"

/**
 * What Show live will present, only for the operator. Under it, the previewed rundown item's plan
 * (its scene, look, camera and Take steps). `itemLook` (Prepare): drawn in the item's own look,
 * when it has one, to see how it is meant to look; Present keeps the look Show live will use.
 * `compact` (Present below 1200 px wide, where the full panel has no room): one line, a small
 * picture with what it is in words, so the operator still sees Preview before Take live.
 */
export function PreviewPanel({ itemLook = false, compact = false, outputLanguageId, onOutputLanguageIdChange }: {
  itemLook?: boolean
  compact?: boolean
  outputLanguageId?: string | null
  onOutputLanguageIdChange?: (outputId: string) => void
} = {}) {
  const selectedVerse = useBibleStore((s) => s.selectedVerse)
  const selectedSlide = useBibleStore((s) => s.selectedSlide)
  const selectedQueueItemId = useBibleStore((s) => s.selectedQueueItemId)
  const isSamplePreview = useBibleStore((s) => s.samplePreview)
  const currentService = useServiceStore((s) => s.current)
  const previewSongId = selectedSlide && isSongItem(selectedSlide.item) ? selectedSlide.item.song.song_id : null
  const previewAudioId = selectedSlide && isAudioItem(selectedSlide.item) ? selectedSlide.item.audio.media_id : null
  const previewMediaId = selectedSlide && isImageItem(selectedSlide.item) ? selectedSlide.item.image.media_id : null
  const previewUrl = useMediaStore((s) => (previewMediaId ? s.urls[previewMediaId] : undefined))
  const previewIsVideo = useMediaStore((s) => (previewMediaId ? s.assets.find((a) => a.id === previewMediaId)?.kind === "video" : false))
  const previewIsSound = useMediaStore((s) => (previewMediaId ? s.assets.find((a) => a.id === previewMediaId)?.kind === "audio" : false))
  const previewAudio = useMediaStore((s) => (previewAudioId ? s.assets.find((a) => a.id === previewAudioId) : undefined))
  const mediaLoaded = useMediaStore((s) => s.loaded)
  const mediaLoading = useMediaStore((s) => s.loading)
  const mediaError = useMediaStore((s) => s.error)
  useEffect(() => {
    if (previewMediaId && !previewUrl && !previewIsVideo) void useMediaStore.getState().dataUrl(previewMediaId)
  }, [previewMediaId, previewUrl, previewIsVideo])
  useEffect(() => {
    if (previewAudioId && !mediaLoaded && !mediaLoading) void useMediaStore.getState().list()
  }, [previewAudioId, mediaLoaded, mediaLoading])
  // The approved service's words of the song when it has them (#193), else the library's.
  const savedSong = useServiceSong(previewSongId)
  // A slide picked from the live song shows the song as it went live (what Show live will present).
  const liveSlideItemId = useBroadcastStore((s) => s.liveSlide?.itemId ?? null)
  const previewSong = (selectedSlide?.song && liveSlideItemId === selectedSlide.item.id ? selectedSlide.song : undefined) ?? savedSong
  useEffect(() => {
    if (previewSongId && !previewSong) void useSongStore.getState().load(previewSongId).catch(() => {})
  }, [previewSongId, previewSong])
  const translations = useBibleStore((s) => s.translations)
  const activeTranslationId = useBibleStore((s) => s.activeTranslationId)
  const secondaryTranslationId = useBibleStore((s) => s.secondaryTranslationId)
  const overrideServiceTranslations = useBibleStore((s) => s.overrideServiceTranslations)

  // When the active translation changes, re-fetch the selected verse in the
  // new one — but only if it was following the active translation. A verse
  // previewed in a service item's saved translation stays in it, so the
  // preview keeps matching what Show live will put on the output.
  const prevActive = useRef(activeTranslationId)
  const pendingActiveRefresh = useRef<{ verse: Verse; queueItemId: string | null } | null>(null)
  useEffect(() => {
    const was = prevActive.current
    prevActive.current = activeTranslationId
    const selection = useBibleStore.getState()
    const verse = selection.selectedVerse
    const followsPendingRefresh =
      pendingActiveRefresh.current?.verse === verse &&
      pendingActiveRefresh.current.queueItemId === selection.selectedQueueItemId
    if (verse && (verse.translation_id === was || followsPendingRefresh) && verse.book_number > 0 && verse.chapter > 0 && verse.verse > 0) {
      pendingActiveRefresh.current = { verse, queueItemId: selection.selectedQueueItemId }
      bibleActions
        .fetchVerse(verse.book_number, verse.chapter, verse.verse, activeTranslationId)
        .then((v) => {
          // Translation loading is asynchronous. A verse may have been the
          // selection when this request started, then the operator may have
          // previewed a different service item. Don't let the old response
          // clear that newer selection.
          const current = useBibleStore.getState()
          if (
            v &&
            v.translation_id === activeTranslationId &&
            v.book_number === verse.book_number &&
            v.chapter === verse.chapter &&
            v.verse === verse.verse &&
            current.activeTranslationId === activeTranslationId &&
            current.selectedVerse === verse &&
            current.selectedSlide === null &&
            current.selectedQueueItemId === selection.selectedQueueItemId
          ) {
            bibleActions.selectVerse(v)
            if (pendingActiveRefresh.current?.verse === verse && pendingActiveRefresh.current.queueItemId === selection.selectedQueueItemId) {
              pendingActiveRefresh.current = null
            }
          }
        })
        .catch(() => {})
    }
  }, [activeTranslationId])
  const themes = useBroadcastStore((s) => s.themes)
  const activeThemeId = useBroadcastStore((s) => s.activeThemeId)

  const previewed = useSelectedItem()?.item ?? null
  const label = usePreviewLabel()
  const bibleItem = previewed && isVerseItem(previewed) ? previewed : null
  const translationChoice = resolveTranslations(bibleItem, { activeTranslationId, secondaryTranslationId, translations, overrideServiceTranslations })
  const secondaryBibleId = isMissing(translationChoice) ? null : translationChoice.secondary
  const primaryBibleId = isMissing(translationChoice) ? null : translationChoice.primary
  const [secondaryPreview, setSecondaryPreview] = useState<{ key: string; verse: Verse | null; status: "ready" | "missing" } | null>(null)
  const outputs = useBroadcastStore((s) => s.outputs)
  const congregationOutputs = outputs.filter((output) => (output.role ?? "congregation") === "congregation")
  const selectedPreviewOutput = outputLanguageId === undefined
    ? undefined
    : congregationOutputs.find((output) => output.id === outputLanguageId) ?? congregationOutputs[0]
  const previewLanguage = selectedPreviewOutput?.language ?? "both"
  const selectedVerseId = selectedVerse?.id
  const selectedBookNumber = selectedVerse?.book_number
  const selectedChapter = selectedVerse?.chapter
  const selectedVerseNumber = selectedVerse?.verse
  const selectedVerseTranslationId = selectedVerse?.translation_id
  const selectedSlideId = selectedSlide?.item.id ?? null
  const selectedOutputId = selectedPreviewOutput?.id
  const secondaryPreviewKey = selectedSlideId === null && selectedOutputId && selectedVerseId !== undefined && selectedBookNumber !== undefined && selectedChapter !== undefined && selectedVerseNumber !== undefined && selectedVerseTranslationId !== undefined && secondaryBibleId !== null
    ? `${selectedOutputId}:${selectedVerseId}:${selectedBookNumber}:${selectedChapter}:${selectedVerseNumber}:${selectedVerseTranslationId}:${secondaryBibleId}`
    : null
  const secondaryFetchPending = !!secondaryPreviewKey && previewLanguage !== "first" && primaryBibleId !== null && selectedVerseTranslationId === primaryBibleId && secondaryPreview?.key !== secondaryPreviewKey
  useEffect(() => {
    let current = true
    if (
      !secondaryFetchPending || !secondaryPreviewKey || selectedSlideId !== null || selectedBookNumber === undefined || selectedChapter === undefined || selectedVerseNumber === undefined ||
      secondaryBibleId === null || primaryBibleId === null || selectedVerseTranslationId !== primaryBibleId
    ) return () => { current = false }
    void bibleActions.fetchVerse(selectedBookNumber, selectedChapter, selectedVerseNumber, secondaryBibleId)
      .then((verse) => {
        if (!current) return
        if (!verse?.text?.trim()) {
          setSecondaryPreview({ key: secondaryPreviewKey, verse: null, status: "missing" })
          return
        }
        if (verse.book_number === selectedBookNumber && verse.chapter === selectedChapter && verse.verse === selectedVerseNumber && verse.translation_id === secondaryBibleId) {
          setSecondaryPreview({ key: secondaryPreviewKey, verse, status: "ready" })
        } else {
          setSecondaryPreview({ key: secondaryPreviewKey, verse: null, status: "missing" })
        }
      })
      .catch(() => {
        if (current) setSecondaryPreview({ key: secondaryPreviewKey, verse: null, status: "missing" })
      })
    return () => { current = false }
  }, [secondaryFetchPending, secondaryPreviewKey, selectedSlideId, selectedBookNumber, selectedChapter, selectedVerseNumber, selectedVerseTranslationId, secondaryBibleId, primaryBibleId, previewLanguage])
  const secondaryPreviewVerse = secondaryPreview?.key === secondaryPreviewKey && secondaryPreview.status === "ready" ? secondaryPreview.verse : null
  const sampleNotice =
    isSamplePreview && selectedVerse && !selectedSlide && selectedQueueItemId === null && !previewed
      ? currentService
        ? "Sample preview — not in this service"
        : "Sample preview — no service selected"
      : null
  // For the compact line's plan (the full panel's ItemPlan reads its own).
  const scenes = useBroadcastStore((s) => s.scenes)
  const cameras = useSettingsStore((s) => s.cameras)
  const ownLook = itemLook && previewed?.look_id ? themes.find((t) => t.id === previewed.look_id) : undefined
  const activeTheme = ownLook ?? themes.find((t) => t.id === activeThemeId) ?? themes[0]
  // Label the preview with the translation the verse is actually in.
  const translation =
    translations.find((t) => t.id === selectedVerse?.translation_id)?.abbreviation ??
    translations.find((t) => t.id === activeTranslationId)?.abbreviation ??
    "KJV"

  let verseData = selectedVerse ? toVerseRenderData(selectedVerse, translation) : null
  if (selectedSlide && isAudioItem(selectedSlide.item)) {
    const output = selectedSlide.item.audio.output_device_id ? "the selected output on this computer" : "this computer’s default output"
    const status = mediaError
      ? `The local media library couldn't be checked: ${mediaError}`
      : !mediaLoaded
        ? "Checking the local media library…"
        : !previewAudio?.present
          ? `Audio file “${selectedSlide.item.audio.name}” is missing from this computer's media library.`
          : null
    verseData = {
      kind: "slide",
      reference: "",
      segments: [],
      lines: [
        `♪ ${selectedSlide.item.audio.name}`,
        status ?? `Local audio · ${output}`,
        "Congregation and OBS screens stay unchanged",
      ],
    }
  } else if (selectedSlide && isImageItem(selectedSlide.item)) {
    // A video previews as "▶ name"; it plays only on the outputs.
    // A sound item has no picture: Preview says what Show live will do.
    verseData = previewIsSound
      ? { kind: "slide", reference: "", segments: [], lines: [`♪ ${selectedSlide.item.image.name}`, "Plays on this computer; the screens stay as they are"] }
      : previewIsVideo ? toVideoRenderData(selectedSlide.item, "") : previewUrl ? toImageRenderData(selectedSlide.item, previewUrl) : null
  } else if (selectedSlide && isCueItem(selectedSlide.item)) {
    // A cue-only moment (#193): Take fires its cues; nothing changes on the screens.
    verseData = { kind: "slide", reference: "", segments: [], lines: [`Cue: ${selectedSlide.item.reference}`, "Take fires its cues; the screens keep what they show"] }
  } else if (selectedSlide && isSlideItem(selectedSlide.item)) {
    verseData = toCustomSlideRenderData(selectedSlide.item)
  } else if (selectedSlide && isSongItem(selectedSlide.item)) {
    // A song slide in preview: exactly what Show live will present.
    const slides = previewSong ? songSlides(previewSong, selectedSlide.item.song) : []
    const slide = slides[Math.min(selectedSlide.index, slides.length - 1)]
    verseData = previewSong && slide ? toLyricRenderData(previewSong, slide) : null
  }

  if (
    !selectedSlide && selectedVerse && secondaryPreviewVerse && !isMissing(translationChoice) &&
    selectedVerse.translation_id === translationChoice.primary &&
    secondaryPreviewVerse.translation_id === translationChoice.secondary &&
    selectedVerse.book_number === secondaryPreviewVerse.book_number &&
    selectedVerse.chapter === secondaryPreviewVerse.chapter &&
    selectedVerse.verse === secondaryPreviewVerse.verse
  ) {
    verseData = toDualVerseRenderData([
      { verse: selectedVerse, translation: translations.find((translation) => translation.id === selectedVerse.translation_id)?.abbreviation ?? "First" },
      { verse: secondaryPreviewVerse, translation: translations.find((translation) => translation.id === secondaryPreviewVerse.translation_id)?.abbreviation ?? "Second" },
    ])
  }
  const languageFallback = !!selectedPreviewOutput && !secondaryFetchPending && isOutputLanguageFallback(verseData, previewLanguage)
  const outputVerseData = selectedPreviewOutput ? forOutputLanguage(verseData, previewLanguage) : verseData
  const outputPicker = onOutputLanguageIdChange && congregationOutputs.length > 0 ? (
    <label className="flex items-center gap-1 text-[0.625rem] font-medium text-muted-foreground">
      <span className="sr-only">Preview output</span>
      <select
        aria-label="Preview output"
        value={selectedPreviewOutput?.id ?? ""}
        onChange={(event) => onOutputLanguageIdChange(event.currentTarget.value)}
        className="max-w-44 rounded border border-border bg-background px-1.5 py-1 text-[0.625rem] text-foreground"
      >
        {congregationOutputs.map((output) => (
          <option key={output.id} value={output.id}>
            {output.name} · {output.language === "first" ? "First language" : output.language === "second" ? "Second language" : "Both languages"}
          </option>
        ))}
      </select>
    </label>
  ) : null

  if (compact) {
    const plan = previewed ? planLines(previewed, { scenes, looks: themes, cameras, outputs }) : []
    return (
      <section data-slot="preview-panel" aria-label="Preview" className="flex min-w-0 items-center gap-2.5 rounded-lg border border-border bg-card p-1.5 pr-3">
        <div className="w-20 shrink-0 overflow-hidden rounded-sm">
          <CanvasVerse theme={activeTheme} verse={outputVerseData} />
        </div>
        <div className="min-w-0 flex-1 text-xs leading-tight">
          <p className="flex items-center gap-2">
            <span className="text-[0.625rem] font-bold tracking-[0.08em] text-muted-foreground uppercase">Preview</span>
            <span className="truncate text-[0.6875rem] text-muted-foreground">Only you see this</span>
            {outputPicker}
          </p>
          {sampleNotice && <p className="truncate text-[0.6875rem] text-muted-foreground">{sampleNotice}</p>}
          {secondaryFetchPending && <p role="status" className="truncate text-[0.625rem] text-muted-foreground">Checking second language…</p>}
          {languageFallback && <p role="status" className="truncate text-[0.625rem] text-confidence-mid">{OUTPUT_LANGUAGE_FALLBACK_NOTICE}</p>}
          <p className="truncate font-medium text-foreground">{label ?? "Nothing in Preview: click a running-order item or find a verse"}</p>
          {plan.length > 0 && <p className="truncate text-[0.6875rem] text-muted-foreground" title={plan.join(" · ")}>Planned · {plan.join(" · ")}</p>}
        </div>
      </section>
    )
  }

  return (
    <div
      data-slot="preview-panel"
      className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      <PanelHeader title="Preview">
        {outputPicker}
        <span className="text-xs text-muted-foreground">{ownLook ? `In its look, ${ownLook.name} · ` : ""}Only you see this</span>
      </PanelHeader>
      {sampleNotice && <p className="px-3 pt-2 text-xs text-muted-foreground">{sampleNotice}</p>}
      {secondaryFetchPending && <p role="status" className="px-3 pt-2 text-xs text-muted-foreground">Checking the selected output’s second language…</p>}
      {languageFallback && <p role="status" className="px-3 pt-2 text-xs text-confidence-mid">{selectedPreviewOutput?.name}: {OUTPUT_LANGUAGE_FALLBACK_NOTICE}</p>}
      {/* The picture fits the panel both ways, so a short panel never crops it. */}
      <div className="flex min-h-0 flex-1 items-center justify-center p-3 [container-type:size]">
        <div style={{ width: `min(100cqw, 100cqh * ${activeTheme.resolution.width / activeTheme.resolution.height})` }}>
          <CanvasVerse theme={activeTheme} verse={outputVerseData} />
        </div>
      </div>
      {previewed && <ItemPlan item={previewed} />}
    </div>
  )
}
