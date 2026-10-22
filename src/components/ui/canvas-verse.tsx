import { useRef, useEffect, useState, useCallback, memo } from "react"
import { drawLowerThird, onThemeFontsLoaded, renderVerse } from "@/lib/verse-renderer"
import { loadThemeImage, preloadThemeImages, themeImageCache } from "@/lib/theme-image-cache"
import type { BroadcastTheme, LowerThird, Ticker, VerseRenderData } from "@/types"
import { drawTicker } from "@/lib/ticker-draw"
import { cn } from "@/lib/utils"

interface CanvasVerseProps {
  theme: BroadcastTheme
  verse: VerseRenderData | null
  /** A lower third drawn over the frame, as the output window does. */
  overlay?: LowerThird | null
  /** The ticker, drawn where it is at this moment (previews do not animate it). */
  ticker?: Ticker | null
  className?: string
}

export const CanvasVerse = memo(function CanvasVerse({
  theme,
  verse,
  overlay,
  ticker,
  className,
}: CanvasVerseProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  // Measure container width with ResizeObserver
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      if (w > 0) setContainerWidth(w)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || containerWidth === 0) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const aspectRatio = theme.resolution.width / theme.resolution.height
    const displayW = containerWidth
    const displayH = displayW / aspectRatio

    canvas.width = displayW * dpr
    canvas.height = displayH * dpr
    canvas.style.width = `${displayW}px`
    canvas.style.height = `${displayH}px`

    ctx.scale(dpr, dpr)
    const scale = displayW / theme.resolution.width
    // A preview that cannot draw (broken picture, damaged theme) stays blank
    // rather than throwing out of the effect and taking the operator's screen with it.
    try {
      renderVerse(ctx, theme, verse, {
        scale,
        imageCache: themeImageCache(),
      })
      if (overlay && verse?.screen !== "black") drawLowerThird(ctx, displayW, displayH, overlay, theme.verseText?.fontFamily, { imageCache: themeImageCache() })
      // A preview shows the words well into the crawl (a fresh ticker's words are still off to the right).
      if (ticker && verse?.screen !== "black") drawTicker(ctx, displayW, displayH, ticker, theme.verseText?.fontFamily, { imageCache: themeImageCache(), now: ticker.startedAt + 4000 })
    } catch (e) {
      console.error("[canvas-verse] preview failed to draw", e)
    }
  }, [theme, verse, overlay, ticker, containerWidth])

  // Preload every image the theme uses so the renderer finds them in the cache.
  useEffect(() => {
    preloadThemeImages(theme, draw)
  }, [theme, draw])
  useEffect(() => {
    if (verse?.image?.url) void loadThemeImage(verse.image.url).then(() => draw())
  }, [verse?.image?.url, draw])
  const backingPicture = overlay?.backing?.kind === "picture" ? overlay.backing.url : ticker?.backing?.kind === "picture" ? ticker.backing.url : null
  useEffect(() => {
    if (backingPicture) void loadThemeImage(backingPicture).then(() => draw())
  }, [backingPicture, draw])

  // Redraw whenever theme, verse, or container size changes.
  useEffect(() => {
    draw()
  }, [draw])

  // Redraw once theme webfonts load so early frames drawn against fallback
  // font metrics are corrected.
  useEffect(() => onThemeFontsLoaded(() => draw()), [draw])

  return (
    <div ref={containerRef} className={cn("w-full", className)}>
      <canvas ref={canvasRef} className="w-full rounded-md" role="img" aria-label={describeVerse(verse)} />
    </div>
  )
})

/** What the canvas shows, in words, for screen readers. */
function describeVerse(verse: VerseRenderData | null): string {
  if (!verse) return "Nothing shown"
  if (verse.screen) return verse.screen === "black" ? "Black screen" : "Logo"
  const words = [verse.reference, ...(verse.lines ?? []), ...(verse.lines?.length ? [] : verse.segments.map((s) => s.text))].filter(Boolean).join(" ")
  return [...words].slice(0, 300).join("") || "Slide"
}
