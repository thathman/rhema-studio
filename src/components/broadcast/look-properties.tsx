import { useBroadcastStore } from "@/stores/broadcast-store"
import { Button } from "@/components/ui/button"
import { applyLook, LOOK_FONTS, LOOK_RATIOS, LOOK_SIZES, lookOf, type LookChange } from "@/lib/theme-look"
import { cn } from "@/lib/utils"

const LABEL = "text-[0.6875rem] font-semibold text-muted-foreground"
const SELECT = "h-9 w-full rounded-lg border border-input bg-card px-2.5 text-xs"

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={LABEL}>{label}</span>
      {children}
      {hint && <span className="text-[0.6875rem] text-muted-foreground">{hint}</span>}
    </label>
  )
}

function Colour({ label, value, onChange }: { label: string; value: string; onChange: (c: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs">
      <span className="font-semibold">{label}</span>
      <input type="color" aria-label={label} value={value.slice(0, 7)} onChange={(e) => onChange(e.target.value)} className="h-8 w-12 cursor-pointer rounded-md border border-border bg-transparent p-0.5" />
    </label>
  )
}

/**
 * Edit the look (approved design, DS-004): the theme in a volunteer's terms. Typography,
 * colours and composition in a few choices; the Text, Background and Layout tabs hold the rest.
 */
export function LookProperties() {
  const theme = useBroadcastStore((s) => s.draftTheme)
  if (!theme) return null
  const look = lookOf(theme)
  const change = (c: LookChange) => useBroadcastStore.getState().updateDraft(applyLook(theme, c))
  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Typography" className="flex flex-col gap-3">
        <h3 className="text-[1.0625rem] font-bold tracking-[-0.03em]">Typography</h3>
        <Field label="Scripture and lyric font" hint={look.font === "custom" ? `Now: ${theme.verseText.fontFamily} (set in Text)` : undefined}>
          <select className={SELECT} value={look.font} onChange={(e) => e.target.value !== "custom" && change({ font: e.target.value as Exclude<typeof look.font, "custom"> })}>
            {look.font === "custom" && <option value="custom">{theme.verseText.fontFamily}</option>}
            {LOOK_FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </Field>
        <Field label="Text size">
          <select className={SELECT} value={look.size} onChange={(e) => change({ size: e.target.value as typeof look.size })}>
            {LOOK_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Space between languages" hint="Room between the two languages of a bilingual verse or song.">
          <span className="flex items-center gap-2">
            <input type="range" aria-label="Space between languages" min={0} max={240} step={4} value={look.languageGap} onChange={(e) => change({ languageGap: Number(e.target.value) })} className="flex-1 accent-primary" />
            <span className="w-12 text-right text-xs tabular-nums">{look.languageGap}px</span>
          </span>
        </Field>
      </section>

      <section aria-label="Colours and backgrounds" className="flex flex-col gap-3 border-t border-border pt-4">
        <h3 className="text-[1.0625rem] font-bold tracking-[-0.03em]">Colours &amp; backgrounds</h3>
        {look.background !== null ? (
          <Colour label="Background" value={look.background} onChange={(background) => change({ background })} />
        ) : (
          <p className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Background: a {theme.background.type} (Background tab)</span>
            <Button size="sm" variant="outline" onClick={() => change({ background: "#152835" })}>Use a colour</Button>
          </p>
        )}
        <Colour label="Words" value={look.words} onChange={(words) => change({ words })} />
        <Colour label="Accent (the reference)" value={look.accent} onChange={(accent) => change({ accent })} />
        <p className="text-[0.6875rem] text-muted-foreground">What the congregation sees is independent of the app's light and dark modes.</p>
      </section>

      <section aria-label="Composition" className="flex flex-col gap-3 border-t border-border pt-4">
        <h3 className="text-[1.0625rem] font-bold tracking-[-0.03em]">Composition</h3>
        <Field label="Text alignment">
          <span role="group" aria-label="Text alignment" className="flex rounded-lg bg-muted p-1">
            {(["left", "center", "right"] as const).map((a) => (
              <button key={a} type="button" aria-pressed={look.align === a} onClick={() => change({ align: a })} className={cn("flex-1 rounded-md py-1.5 text-xs font-semibold capitalize", look.align === a ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}>
                {a === "center" ? "Centre" : a}
              </button>
            ))}
          </span>
        </Field>
        <Field label="Safe area" hint="Space kept clear around the words, so nothing is cut at the screen's edge.">
          <span className="flex items-center gap-2">
            <input type="range" aria-label="Safe area" min={3} max={18} step={1} value={Math.min(18, Math.max(3, look.margin))} onChange={(e) => change({ margin: Number(e.target.value) })} className="flex-1 accent-primary" />
            <span className="w-10 text-right text-xs tabular-nums">{look.margin}%</span>
          </span>
        </Field>
        <Field label="Output shape">
          <select className={SELECT} value={look.ratio} onChange={(e) => e.target.value !== "custom" && change({ ratio: e.target.value as Exclude<typeof look.ratio, "custom"> })}>
            {look.ratio === "custom" && <option value="custom">{theme.resolution.width} × {theme.resolution.height}</option>}
            {LOOK_RATIOS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </Field>
      </section>
      <p className="rounded-md bg-accent px-3 py-2 text-[0.6875rem] text-accent-foreground">Changes are a preview until you Save theme. Click the words or the reference on the canvas for every detail.</p>
    </div>
  )
}
