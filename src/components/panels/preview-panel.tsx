import { useEffect, useRef } from "react"
import { PanelHeader } from "@/components/ui/panel-header"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { useBibleStore, useBroadcastStore } from "@/stores"
import { bibleActions } from "@/hooks/use-bible"
import { toCustomSlideRenderData, toImageRenderData, toVideoRenderData, toVerseRenderData } from "@/hooks/use-broadcast"
import { isImageItem, isSlideItem, isSongItem } from "@/types"
import { useMediaStore } from "@/stores/media-store"
import { useSongStore } from "@/stores/song-store"
import { buildSlides, toLyricRenderData } from "@/lib/lyrics"

export function PreviewPanel() {
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
  const previewSong = useSongStore((s) => (previewSongId ? s.songs[previewSongId] : undefined))
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

  const activeTheme = themes.find((t) => t.id === activeThemeId) ?? themes[0]
  // Label the preview with the translation the verse is actually in.
  const translation =
    translations.find((t) => t.id === selectedVerse?.translation_id)?.abbreviation ??
    translations.find((t) => t.id === activeTranslationId)?.abbreviation ??
    "KJV"

  let verseData = selectedVerse ? toVerseRenderData(selectedVerse, translation) : null
  if (selectedSlide && isImageItem(selectedSlide.item)) {
    // A video previews as "▶ name"; it plays only on the outputs.
    // A sound item has no picture: Preview says what Show live will do.
    verseData = previewIsSound
      ? { kind: "slide", reference: "", segments: [], lines: [`♪ ${selectedSlide.item.image.name}`, "Plays on this computer; the screens stay as they are"] }
      : previewIsVideo ? toVideoRenderData(selectedSlide.item, "") : previewUrl ? toImageRenderData(selectedSlide.item, previewUrl) : null
  } else if (selectedSlide && isSlideItem(selectedSlide.item)) {
    verseData = toCustomSlideRenderData(selectedSlide.item)
  } else if (selectedSlide && isSongItem(selectedSlide.item)) {
    // A song slide in preview: exactly what Show live will present.
    const slides = previewSong ? buildSlides(previewSong, selectedSlide.item.song.arrangement_id, selectedSlide.item.song.languages) : []
    const slide = slides[Math.min(selectedSlide.index, slides.length - 1)]
    verseData = previewSong && slide ? toLyricRenderData(previewSong, slide) : null
  }

  return (
    <div
      data-slot="preview-panel"
      className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      <PanelHeader title="Program preview" />
      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        <CanvasVerse theme={activeTheme} verse={verseData} />
      </div>
    </div>
  )
}
