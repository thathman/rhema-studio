import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { useBroadcastStore } from "@/stores"
import { useMediaStore } from "@/stores/media-store"
import type { Ticker, TickerStyle } from "@/types"
import { MAIN_OUTPUT_ID } from "@/types"
import { BUNDLED_FONTS } from "@/lib/fonts"
import { SlideBackground } from "@/studio/prepare/slide-composer"
import { lowerThirdBacking } from "@/lib/lower-third-backing"
import { Colour, NumberField, Row } from "@/studio/design/lower-third-designer"

const SAMPLE_ITEMS = ["Youth meeting, Friday 6 pm", "Choir practice, Saturday 4 pm", "Harvest thanksgiving next Sunday"]

/** How the news ticker looks and moves. Edits apply at once, to a running ticker too. */
export function TickerDesigner() {
  const style = useBroadcastStore((s) => s.tickerStyle)
  const items = useBroadcastStore((s) => s.tickerItems)
  const outputs = useBroadcastStore((s) => s.outputs)
  const themes = useBroadcastStore((s) => s.themes)
  const assets = useMediaStore((s) => s.assets)
  const [backing, setBacking] = useState<Ticker["backing"]>(null)
  const output = outputs.find((o) => o.ticker) ?? outputs.find((o) => o.id === MAIN_OUTPUT_ID)
  const theme = themes.find((t) => t.id === output?.themeId) ?? themes[0]
  const words = items.some((i) => i.trim()) ? items : SAMPLE_ITEMS
  // A fixed moment of the crawl, so the preview holds still while you design.
  const preview = useMemo<Ticker>(() => ({ items: words, style, startedAt: 0, backing }), [words, style, backing])
  const save = (next: TickerStyle, media = false) => {
    useBroadcastStore.getState().saveTickerStyle(next)
    if (media) void lowerThirdBacking(next).then((b) => { setBacking(b); useBroadcastStore.getState().saveTickerStyle(next, b) })
  }
  const patch = (p: Partial<TickerStyle>) => save({ ...style, ...p })
  const media = style.background.mediaId ? assets.find((a) => a.id === style.background.mediaId) : undefined
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the picture or video behind the band
  useEffect(() => { void lowerThirdBacking(style).then(setBacking) }, [])
  return (
    <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">How the news ticker looks and moves. Changes apply at once, also to a running ticker. The words are typed in Present (Ticker).</p>
<div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]">
            {/* The preview stays in view beside the settings on a wide window. */}
            <div className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-0">
          {theme && <CanvasVerse theme={theme} verse={{ reference: "", segments: [] }} ticker={preview} />}
          {style.background.kind === "video" && <p className="text-[0.6875rem] text-muted-foreground">The video plays behind the band on the outputs; this preview shows its shade only.</p>}
            </div>
            <div className="flex min-w-0 flex-col gap-3">
          <Row label="Position">
            {(["bottom", "top"] as const).map((p) => <Button key={p} size="xs" variant={style.position === p ? "default" : "outline"} onClick={() => patch({ position: p })}>{p === "top" ? "Top" : "Bottom"}</Button>)}
          </Row>
          <Row label="Motion">
            <Button size="xs" variant={style.motion !== "pages" ? "default" : "outline"} onClick={() => patch({ motion: "crawl" })}>Crawl</Button>
            <Button size="xs" variant={style.motion === "pages" ? "default" : "outline"} onClick={() => patch({ motion: "pages" })}>One at a time, still</Button>
            {style.motion === "pages" && <NumberField label="Seconds each" value={style.pageSeconds} min={2} max={60} suffix="s" onChange={(pageSeconds) => patch({ pageSeconds })} />}
          </Row>
          <Row label="Moves">
            {(["left", "right"] as const).map((d) => <Button key={d} size="xs" variant={style.direction === d ? "default" : "outline"} onClick={() => patch({ direction: d })}>{d === "left" ? "Toward the left" : "Toward the right"}</Button>)}
          </Row>
          <Row label="Height"><NumberField label="Band height" value={style.height} min={3} max={25} suffix="%" onChange={(height) => patch({ height })} /></Row>
          <Row label="Speed"><NumberField label="Speed" value={style.speed} min={20} max={600} suffix="" onChange={(speed) => patch({ speed })} /><span className="text-muted-foreground">pixels a second</span></Row>
          <Row label="Font">
            <Input aria-label="Font" list="tk-fonts" placeholder="The theme's font" value={style.fontFamily ?? ""} onChange={(e) => patch({ fontFamily: e.target.value.trim() || null })} className="h-7 text-xs" />
            <datalist id="tk-fonts">{BUNDLED_FONTS.map((f) => <option key={f} value={f} />)}</datalist>
          </Row>
          <Row label="Words">
            <Colour label="Words colour" value={style.color} onChange={(color) => patch({ color })} />
            <NumberField label="Words size" value={style.size} min={20} max={90} suffix="%" onChange={(size) => patch({ size })} />
            <select aria-label="Words weight" value={style.weight} onChange={(e) => patch({ weight: Number(e.target.value) })} className="h-7 rounded border border-border bg-background px-1 text-xs">
              {[400, 500, 600, 700, 800].map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </Row>
          <Row label="Between items"><Input aria-label="Between items" value={style.separator} maxLength={8} onChange={(e) => patch({ separator: e.target.value })} className="h-7 w-20 text-xs" /></Row>
          <Row label="Tag">
            <Input aria-label="Tag (empty for none)" value={style.label} maxLength={24} placeholder="None" onChange={(e) => patch({ label: e.target.value })} className="h-7 w-32 text-xs" />
            <Colour label="Tag words colour" value={style.labelColor} onChange={(labelColor) => patch({ labelColor })} />
            <Colour label="Tag colour" value={style.labelBackground} onChange={(labelBackground) => patch({ labelBackground })} />
          </Row>
          <Row label="Band colour">
            <Colour label="Band colour" value={style.background.color} onChange={(color) => patch({ background: { ...style.background, color } })} />
            <NumberField label="Band colour opacity" value={Math.round(style.background.opacity * 100)} min={0} max={100} suffix="%" onChange={(o) => patch({ background: { ...style.background, opacity: o / 100 } })} />
          </Row>
          <SlideBackground
            label="Picture or video"
            noneLabel="None (colour only)"
            hint="Behind the band; the colour lies over it at its opacity. A video loops silently."
            value={style.background.mediaId ? { media_id: style.background.mediaId, name: media?.name ?? "" } : null}
            onChange={(v) => save({ ...style, background: { ...style.background, kind: v ? (v.kind === "video" ? "video" : "picture") : "color", mediaId: v?.media_id ?? null } }, true)}
          />
            </div>
        </div>
    </div>
  )
}
