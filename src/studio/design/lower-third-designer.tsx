import { useEffect, useMemo, useState } from "react"
import { CopyIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { useBroadcastStore } from "@/stores"
import { useMediaStore } from "@/stores/media-store"
import type { LowerThird, LowerThirdStyle, VerseRenderData } from "@/types"
import { MAIN_OUTPUT_ID } from "@/types"
import { DEFAULT_LOWER_THIRD_STYLE, normalizeLowerThirdStyle, overlayFor } from "@/lib/lower-third-style"
import { BUNDLED_FONTS } from "@/lib/fonts"
import { SlideBackground } from "@/studio/prepare/slide-composer"
import { lowerThirdBacking } from "@/lib/lower-third-backing"
import { cn } from "@/lib/utils"
import { DesignDraftActions } from "@/studio/design/design-draft-actions"
import { useDesignDraft } from "@/studio/design/use-design-draft"
import { followsLowerThird } from "@/lib/live-sources"
import { designDraftId } from "@/lib/design-drafts"

type Sample = "name" | "scripture" | "lyrics"
const SAMPLES: Record<Sample, { lt: LowerThird; verse: VerseRenderData | null }> = {
  name: { lt: { line1: "Pastor Tolu Adeyemi", line2: "Senior Pastor" }, verse: null },
  scripture: { lt: { line1: "", line2: "", follow: "scripture" }, verse: { reference: "John 3:16 (KJV)", segments: [{ text: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.", verseNumber: 16 }] } },
  lyrics: { lt: { line1: "", line2: "", follow: "lyrics" }, verse: { kind: "lyric", reference: "Amazing Grace · Verse 1", segments: [], lines: ["Amazing grace, how sweet the sound", "That saved a wretch like me"] } },
}

/** A labelled row of the form. */
export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-2">{children}</span>
    </label>
  )
}

export function NumberField({ value, onChange, min, max, suffix, label }: { value: number; onChange: (n: number) => void; min: number; max: number; suffix: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <input type="range" aria-label={label} min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-28 accent-primary" />
      <span className="w-12 tabular-nums text-muted-foreground">{value}{suffix}</span>
    </span>
  )
}

export function Colour({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  // The picker takes #rrggbb only; a saved #rrggbbaa keeps its alpha out of reach (set opacity instead).
  return <input type="color" aria-label={label} value={value.slice(0, 7)} onChange={(e) => onChange(e.target.value)} className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent" />
}

/**
 * Lower third styles: position, size, fonts, colours, a picture or video
 * behind the band, an accent and how it comes on. Edits stay in a local
 * design draft until the operator deliberately applies them.
 */
export function LowerThirdDesigner({ initialId }: { initialId?: string } = {}) {
  const styles = useBroadcastStore((s) => s.lowerThirdStyles)
  const outputs = useBroadcastStore((s) => s.outputs)
  const scenes = useBroadcastStore((s) => s.scenes)
  const liveLowerThird = useBroadcastStore((s) => s.lowerThird)
  const themes = useBroadcastStore((s) => s.themes)
  const assets = useMediaStore((s) => s.assets)
  const [selectedId, setSelectedId] = useState(() => initialId ?? useBroadcastStore.getState().lowerThirdStyles[0]?.id ?? "")
  const [sample, setSample] = useState<Sample>("name")
  const savedStyle = styles.find((x) => x.id === selectedId) ?? styles[0] ?? DEFAULT_LOWER_THIRD_STYLE
  const draft = useDesignDraft("lower-third", savedStyle.id, savedStyle, normalizeLowerThirdStyle)
  const style = draft.value
  const output = outputs.find((o) => o.lowerThirds) ?? outputs.find((o) => o.id === MAIN_OUTPUT_ID)
  const theme = themes.find((t) => t.id === output?.themeId) ?? themes[0]
  const [backing, setBacking] = useState<LowerThird["backing"]>(null)
  const preview = useMemo(() => overlayFor({ ...SAMPLES[sample].lt, style, backing }, SAMPLES[sample].verse), [sample, style, backing])

  const patch = (p: Partial<LowerThirdStyle>) => draft.update(normalizeLowerThirdStyle({ ...style, ...p }))
  const pick = (id: string) => {
    if (id === selectedId) return
    if (draft.dirty) draft.save()
    setSelectedId(id)
    setBacking(null)
  }
  const add = (from: LowerThirdStyle) => {
    const copy = normalizeLowerThirdStyle({ ...from, id: crypto.randomUUID(), name: from === DEFAULT_LOWER_THIRD_STYLE ? "New style" : `${from.name} copy` })
    useBroadcastStore.getState().saveLowerThirdStyle(copy)
    pick(copy.id)
  }
  const media = style.background.mediaId ? assets.find((a) => a.id === style.background.mediaId) : undefined
  const lowerThirdIsLive = liveLowerThird?.style?.id === style.id
  const liveOutputs = lowerThirdIsLive ? outputs.filter((candidate) => {
    if ((candidate.role ?? "congregation") !== "congregation") return false
    const scene = scenes.find((saved) => saved.id === candidate.sceneId)
    const sceneOwnsBand = scene?.layers.some((layer) => layer.kind === "lowerThird" && layer.visible) ?? false
    return followsLowerThird(candidate) || sceneOwnsBand
  }).map((candidate) => candidate.name) : []
  const styleBackgroundKind = style.background.kind
  const styleBackgroundMediaId = style.background.mediaId
  useEffect(() => {
    let current = true
    void lowerThirdBacking({ background: { kind: styleBackgroundKind, mediaId: styleBackgroundMediaId } }).then((value) => { if (current) setBacking(value) }).catch(() => { if (current) setBacking(null) })
    return () => { current = false }
  }, [styleBackgroundKind, styleBackgroundMediaId])

  const apply = async () => {
    const normalized = normalizeLowerThirdStyle(style)
    const resolved = await lowerThirdBacking(normalized)
    useBroadcastStore.getState().saveLowerThirdStyle(normalized, resolved)
  }

  return (
    <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">Design the band for names, scripture and lyrics. Preview and save a draft here; applying is a deliberate action.</p>
        <DesignDraftActions
          dirty={draft.dirty}
          saved={draft.saved}
          scope={lowerThirdIsLive ? "the lower third currently on air and congregation outputs subscribed to it" : "the saved lower-third style for future uses"}
          outputs={liveOutputs}
          onSave={draft.save}
          onDiscard={draft.discard}
          onApply={apply}
          onApplied={draft.markApplied}
        />
        <div className="grid gap-4 md:grid-cols-[11rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-1" role="listbox" aria-label="Styles">
            {styles.map((x) => (
              <button key={x.id} type="button" role="option" aria-selected={x.id === style.id} onClick={() => pick(x.id)} className={cn("truncate rounded-md px-2 py-1.5 text-left text-xs", x.id === style.id ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted")}>
                {x.name}
              </button>
            ))}
            <div className="mt-2 flex flex-wrap gap-1">
              <Button size="xs" variant="outline" onClick={() => add(DEFAULT_LOWER_THIRD_STYLE)}><PlusIcon /> New</Button>
              <Button size="xs" variant="outline" onClick={() => add(style)}><CopyIcon /> Duplicate</Button>
              <Button size="xs" variant="ghost" disabled={styles.length < 2 || draft.dirty} title={draft.dirty ? "Save or discard the draft before deleting this style" : "Delete style"} onClick={() => {
                useBroadcastStore.getState().deleteDesignDraft(designDraftId("lower-third", style.id))
                useBroadcastStore.getState().deleteLowerThirdStyle(style.id)
                pick(styles.find((x) => x.id !== style.id)?.id ?? "")
              }} aria-label="Delete style"><Trash2Icon /></Button>
            </div>
          </div>
<div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]">
            {/* The preview stays in view beside the settings on a wide window. */}
            <div className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-0">
            <div className="flex gap-1" role="radiogroup" aria-label="Preview">
              {(["name", "scripture", "lyrics"] as const).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={sample === v} onClick={() => setSample(v)} className={cn("rounded-full border px-2.5 py-0.5 text-xs", sample === v ? "border-primary/60 bg-primary/15" : "border-border text-muted-foreground")}>
                  {v === "name" ? "Name and title" : v === "scripture" ? "Scripture strip" : "Lyrics strip"}
                </button>
              ))}
            </div>
            {theme && <CanvasVerse theme={theme} verse={SAMPLES[sample].verse ?? { reference: "", segments: [] }} overlay={preview} />}
            {style.background.kind === "video" && <p className="text-xs text-muted-foreground">The video plays behind the band on the outputs; this preview shows its shade only.</p>}
            </div>
            <div className="flex min-w-0 flex-col gap-3">

            <Row label="Name"><Input aria-label="Style name" value={style.name} onChange={(e) => patch({ name: e.target.value })} className="h-7 text-xs" /></Row>
            <Row label="Position">
              {(["left", "center", "right"] as const).map((a) => (
                <Button key={a} size="xs" variant={style.align === a ? "default" : "outline"} onClick={() => patch({ align: a })}>{a === "center" ? "Centre" : a === "left" ? "Left" : "Right"}</Button>
              ))}
            </Row>
            <Row label="From the side"><NumberField label="Gap from the side" value={style.margin} min={0} max={40} suffix="%" onChange={(margin) => patch({ margin })} /></Row>
            <Row label="From the bottom"><NumberField label="Gap from the bottom" value={style.bottom} min={0} max={90} suffix="%" onChange={(bottom) => patch({ bottom })} /></Row>
            <Row label="Width"><NumberField label="Band width (0 fits the words)" value={style.width} min={0} max={100} suffix="%" onChange={(width) => patch({ width })} /><span className="text-muted-foreground">{style.width === 0 ? "fits the words" : ""}</span></Row>
            <Row label="Height"><NumberField label="Band height" value={style.height} min={4} max={50} suffix="%" onChange={(height) => patch({ height })} /></Row>
            <Row label="Corners"><NumberField label="Corner rounding" value={style.radius} min={0} max={50} suffix="%" onChange={(radius) => patch({ radius })} /></Row>
            <Row label="Font">
              <Input aria-label="Font" list="lt-fonts" placeholder="The theme's font" value={style.fontFamily ?? ""} onChange={(e) => patch({ fontFamily: e.target.value.trim() || null })} className="h-7 text-xs" />
              <datalist id="lt-fonts">{BUNDLED_FONTS.map((f) => <option key={f} value={f} />)}</datalist>
            </Row>
            <Row label="First line">
              <Colour label="First line colour" value={style.line1.color} onChange={(color) => patch({ line1: { ...style.line1, color } })} />
              <NumberField label="First line size" value={style.line1.size} min={5} max={90} suffix="%" onChange={(size) => patch({ line1: { ...style.line1, size } })} />
              <select aria-label="First line weight" value={style.line1.weight} onChange={(e) => patch({ line1: { ...style.line1, weight: Number(e.target.value) } })} className="h-7 rounded border border-border bg-background px-1 text-xs">
                {[400, 500, 600, 700, 800].map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
              <label className="flex items-center gap-1"><input type="checkbox" checked={style.line1.uppercase} onChange={(e) => patch({ line1: { ...style.line1, uppercase: e.target.checked } })} /> Capitals</label>
            </Row>
            <Row label="Second line">
              <Colour label="Second line colour" value={style.line2.color} onChange={(color) => patch({ line2: { ...style.line2, color } })} />
              <NumberField label="Second line size" value={style.line2.size} min={5} max={90} suffix="%" onChange={(size) => patch({ line2: { ...style.line2, size } })} />
              <select aria-label="Second line weight" value={style.line2.weight} onChange={(e) => patch({ line2: { ...style.line2, weight: Number(e.target.value) } })} className="h-7 rounded border border-border bg-background px-1 text-xs">
                {[300, 400, 500, 600, 700].map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </Row>
            <Row label="Band colour">
              <Colour label="Band colour" value={style.background.color} onChange={(color) => patch({ background: { ...style.background, color } })} />
              <NumberField label="Band colour opacity" value={Math.round(style.background.opacity * 100)} min={0} max={100} suffix="%" onChange={(o) => patch({ background: { ...style.background, opacity: o / 100 } })} />
              <span className="text-muted-foreground">{style.background.mediaId ? "over the picture" : ""}</span>
            </Row>
            <SlideBackground
              label="Picture or video"
              noneLabel="None (colour only)"
              hint="Behind the band; the colour lies over it at its opacity. A video loops silently."
              value={style.background.mediaId ? { media_id: style.background.mediaId, name: media?.name ?? "" } : null}
              onChange={(v) => patch({ background: { ...style.background, kind: v ? (v.kind === "video" ? "video" : "picture") : "color", mediaId: v?.media_id ?? null } })}
            />
            <Row label="Accent">
              <label className="flex items-center gap-1"><input type="checkbox" checked={style.accent.enabled} onChange={(e) => patch({ accent: { ...style.accent, enabled: e.target.checked } })} /> Bar</label>
              <Colour label="Accent colour" value={style.accent.color} onChange={(color) => patch({ accent: { ...style.accent, color } })} />
              <NumberField label="Accent thickness" value={style.accent.width} min={1} max={60} suffix="px" onChange={(width) => patch({ accent: { ...style.accent, width } })} />
            </Row>
            <Row label="Comes on">
              {(["none", "fade", "slide"] as const).map((a) => (
                <Button key={a} size="xs" variant={style.animation === a ? "default" : "outline"} onClick={() => patch({ animation: a })}>{a === "none" ? "At once" : a === "fade" ? "Fade" : "Slide up"}</Button>
              ))}
            </Row>
            </div>
          </div>
        </div>
    </div>
  )
}
