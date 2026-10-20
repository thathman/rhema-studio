import { useEffect, useRef } from "react"
import { PanelHeader } from "@/components/ui/panel-header"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { useBibleStore, useBroadcastStore } from "@/stores"
import { bibleActions } from "@/hooks/use-bible"
import { toVerseRenderData } from "@/hooks/use-broadcast"

export function PreviewPanel() {
  const selectedVerse = useBibleStore((s) => s.selectedVerse)
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

  const verseData = selectedVerse ? toVerseRenderData(selectedVerse, translation) : null

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
