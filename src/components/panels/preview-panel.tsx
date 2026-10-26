import { useEffect, useRef } from "react"
import { PanelHeader } from "@/components/ui/panel-header"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { useBibleStore, useBroadcastStore } from "@/stores"
import { bibleActions } from "@/hooks/use-bible"
import { toCustomSlideRenderData, toImageRenderData, toVideoRenderData, toVerseRenderData } from "@/hooks/use-broadcast"
import { isAudioItem, isCueItem, isImageItem, isSlideItem, isSongItem } from "@/types"
import { useMediaStore } from "@/stores/media-store"
import { useSongStore } from "@/stores/song-store"
import { songSlides, toLyricRenderData } from "@/lib/lyrics"
import { useServiceSong } from "@/stores/song-pins-store"
import { useSelectedItem } from "@/studio/prepare/use-selected-item"
import { ItemPlan } from "@/studio/prepare/item-plan"
import { planLines } from "@/lib/item-intent"
import { useSettingsStore } from "@/stores/settings-store"
import { usePreviewLabel } from "@/hooks/use-preview-label"

/**
 * What Show live will present, only for the operator. Under it, the previewed rundown item's plan
 * (its scene, look, camera and Take steps). `itemLook` (Prepare): drawn in the item's own look,
 * when it has one, to see how it is meant to look; Present keeps the look Show live will use.
 * `compact` (Present below 1200 px wide, where the full panel has no room): one line, a small
 * picture with what it is in words, so the operator still sees Preview before Take live.
 */
export function PreviewPanel({ itemLook = false, compact = false }: { itemLook?: boolean; compact?: boolean } = {}) {
  const selectedVerse = useBibleStore((s) => s.selectedVerse)
  const selectedSlide = useBibleStore((s) => s.selectedSlide)
  const previewSongId = selectedSlide && isSongItem(selectedSlide.item) ? selectedSlide.item.song.song_id : null
  const previewMediaId = selectedSlide && isImageItem(selectedSlide.item) ? selectedSlide.item.image.media_id : null
  const previewUrl = useMediaStore((s) => (previewMediaId ? s.urls[previewMediaId] : undefined))
  const previewIsVideo = useMediaStore((s) => (previewMediaId ? s.assets.find((a) => a.id === previewMediaId)?.kind === "video" : false))
  const previewIsSound = useMediaStore((s) => (previewMediaId ? s.assets.find((a) => a.id === previewMediaId)?.kind === "audio" : false))
  useEffect(() => {
    if (previewMediaId && !previewUrl && !previewIsVideo) void useMediaStore.getState().dataUrl(previewMediaId)
  }, [previewMediaId, previewUrl, previewIsVideo])
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

  // When the active translation changes, re-fetch the selected verse in the
  // new one — but only if it was following the active translation. A verse
  // previewed in a service item's saved translation stays in it, so the
  // preview keeps matching what Show live will put on the output.
  const prevActive = useRef(activeTranslationId)
  useEffect(() => {
    const was = prevActive.current
    prevActive.current = activeTranslationId
    const verse = useBibleStore.getState().selectedVerse
    if (verse && verse.translation_id === was && verse.book_number > 0 && verse.chapter > 0 && verse.verse > 0) {
      bibleActions
        .fetchVerse(verse.book_number, verse.chapter, verse.verse)
        .then((v) => {
          if (v) bibleActions.selectVerse(v)
        })
        .catch(() => {})
    }
  }, [activeTranslationId])
  const themes = useBroadcastStore((s) => s.themes)
  const activeThemeId = useBroadcastStore((s) => s.activeThemeId)

  const previewed = useSelectedItem()?.item ?? null
  const label = usePreviewLabel()
  // For the compact line's plan (the full panel's ItemPlan reads its own).
  const scenes = useBroadcastStore((s) => s.scenes)
  const outputs = useBroadcastStore((s) => s.outputs)
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
    verseData = { kind: "slide", reference: "", segments: [], lines: [`♪ ${selectedSlide.item.audio.name}`, `Local audio · ${output}`, "Congregation and OBS screens stay unchanged"] }
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

  if (compact) {
    const plan = previewed ? planLines(previewed, { scenes, looks: themes, cameras, outputs }) : []
    return (
      <section data-slot="preview-panel" aria-label="Preview" className="flex min-w-0 items-center gap-2.5 rounded-lg border border-border bg-card p-1.5 pr-3">
        <div className="w-20 shrink-0 overflow-hidden rounded-sm">
          <CanvasVerse theme={activeTheme} verse={verseData} />
        </div>
        <div className="min-w-0 flex-1 text-xs leading-tight">
          <p className="flex items-baseline gap-2">
            <span className="text-[0.625rem] font-bold tracking-[0.08em] text-muted-foreground uppercase">Preview</span>
            <span className="truncate text-[0.6875rem] text-muted-foreground">Only you see this</span>
          </p>
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
        <span className="text-xs text-muted-foreground">{ownLook ? `In its look, ${ownLook.name} · ` : ""}Only you see this</span>
      </PanelHeader>
      {/* The picture fits the panel both ways, so a short panel never crops it. */}
      <div className="flex min-h-0 flex-1 items-center justify-center p-3 [container-type:size]">
        <div style={{ width: `min(100cqw, 100cqh * ${activeTheme.resolution.width / activeTheme.resolution.height})` }}>
          <CanvasVerse theme={activeTheme} verse={verseData} />
        </div>
      </div>
      {previewed && <ItemPlan item={previewed} />}
    </div>
  )
}
