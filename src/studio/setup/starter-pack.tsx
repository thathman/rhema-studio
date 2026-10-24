import { useMemo, useState } from "react"
import { toast } from "sonner"
import { CheckIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { cn } from "@/lib/utils"
import { hasChurchColours } from "@/lib/brand-kit"
import { buildStarterPack, planStarterPack, starterPacks, type StarterPack } from "@/lib/starter-pack"
import { SAMPLE_BILINGUAL_SONG } from "@/lib/theme-migrations"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import type { BroadcastTheme, VerseRenderData } from "@/types"

// Public-domain sample words, as in Design → Library.
const PSALM_EN = "Make a joyful noise unto the LORD, all ye lands."
const PSALM_YO = "Ẹ hó ìhó ayọ̀ sí Olúwa, gbogbo ilẹ̀."
const BIBLE: VerseRenderData = { content: "bible", reference: "Psalm 100:1", segments: [{ verseNumber: 1, text: PSALM_EN }], translationLines: [PSALM_EN, PSALM_YO] }
const SONG: VerseRenderData = { ...SAMPLE_BILINGUAL_SONG, content: "hymn" }
const NOTICE: VerseRenderData = { kind: "slide", content: "slide", reference: "This week", segments: [{ text: "Youth meeting, Friday 6 pm. Choir practice, Saturday 4 pm." }], lines: ["Youth meeting · Friday 6 pm", "Choir practice · Saturday 4 pm"] }

const PACKS = starterPacks()
let previewIds = 0
const previewId = () => `starter-preview-${++previewIds}`

/**
 * Setup step 3's starter looks (#298 S3.2/S3.3): choose a family, see its looks drawn in the church
 * colours, then Apply (and confirm) to add them and set them on the outputs that are off. Until
 * Apply nothing is saved; an output that is on never changes.
 */
export function StarterPackChooser() {
  const [familyId, setFamilyId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const pack = PACKS.find((p) => p.family.id === familyId) ?? null
  const choose = (id: string | null) => {
    setFamilyId(id)
    setConfirming(false)
    setDone(null)
  }
  return (
    <section aria-labelledby="setup-starter" className="flex max-w-3xl flex-col gap-3 border-t border-border pt-4">
      <div>
        <h3 id="setup-starter" className="text-sm font-semibold">Starter looks (optional)</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          A ready-made family of looks for scripture, songs, notices, name bands, the ticker and camera scenes. Choosing one only shows it here; nothing is added or changed until you press Apply.
        </p>
      </div>
      <div role="radiogroup" aria-label="Starter looks" className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
        {PACKS.map((p) => (
          <button
            key={p.family.id}
            type="button"
            role="radio"
            aria-checked={familyId === p.family.id}
            onClick={() => choose(familyId === p.family.id ? null : p.family.id)}
            className={cn("flex flex-col gap-0.5 rounded-lg border p-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50", familyId === p.family.id ? "border-primary bg-primary/10" : "border-border bg-card hover:border-foreground/30")}
          >
            <span className="text-xs font-semibold">{p.family.name}</span>
            <span className="text-[0.6875rem] text-muted-foreground">{p.family.description}</span>
          </button>
        ))}
      </div>
      {pack && <PackDraft key={pack.family.id} pack={pack} confirming={confirming} setConfirming={setConfirming} done={done} onDone={setDone} />}
    </section>
  )
}

function PackDraft({ pack, confirming, setConfirming, done, onDone }: { pack: StarterPack; confirming: boolean; setConfirming: (on: boolean) => void; done: string | null; onDone: (text: string) => void }) {
  const kit = useSettingsStore((s) => s.brandKit)
  const outputs = useBroadcastStore((s) => s.outputs)
  const outputStatus = useBroadcastStore((s) => s.outputStatus)
  const themes = useBroadcastStore((s) => s.themes)
  const plan = planStarterPack(pack, { outputs, outputStatus, themes })
  const branded = hasChurchColours(kit)
  // The copies Apply would add, drawn by the outputs' own renderer (ids are throwaway: nothing is saved).
  const preview = useMemo(() => buildStarterPack(pack, { set: [], kept: [], stage: false, stageOn: [] }, [], { brand: kit, newId: previewId }), [pack, kit])
  const [scripture, lyrics, announcement, band] = preview.themes

  const apply = () => {
    // Worked out again now: an output may have been switched on since the plan was shown.
    const s = useBroadcastStore.getState()
    const now = planStarterPack(pack, s)
    const taken = [...s.themes.map((t) => t.name), ...s.scenes.map((x) => x.name), ...s.lowerThirdStyles.map((x) => x.name)]
    const result = buildStarterPack(pack, now, s.outputs, { brand: useSettingsStore.getState().brandKit, takenNames: taken })
    for (const t of result.themes) useBroadcastStore.getState().saveTheme(t)
    useBroadcastStore.getState().saveLowerThirdStyle(result.lowerThirdStyle)
    // Only the saved look: a ticker running now keeps its look until it is started again.
    useBroadcastStore.setState({ tickerStyle: result.tickerStyle })
    if (result.stageStyle) useBroadcastStore.getState().saveStageStyle(result.stageStyle)
    for (const scene of result.scenes) useBroadcastStore.getState().saveScene(scene)
    for (const o of result.outputs) useBroadcastStore.getState().updateOutput(o.id, { themeId: o.themeId, themeFor: o.themeFor })
    setConfirming(false)
    const names = now.set.map((o) => o.name)
    const text = `Added the ${pack.family.name} looks${names.length ? ` and set them on ${names.join(", ")}` : ""}.`
    onDone(text)
    toast.success(text, { description: "Change any of them in Design; nothing on air changed." })
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Preview label="Scripture" theme={scripture} verse={BIBLE} />
        <Preview label="Songs and hymns" theme={lyrics} verse={SONG} />
        <Preview label="Notices" theme={announcement} verse={NOTICE} />
        <Preview label="Over a camera" theme={band} verse={BIBLE} keyed />
      </div>
      <p className="text-xs text-muted-foreground">
        {branded ? "Shown in your Brand Kit's colours and fonts (as last applied above); a colour that would be hard to read on a look stays as the look has it." : "Shown as the library has them. Apply church colours in the Brand Kit above first to have the copies take them."}
      </p>
      <div className="grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <p className="font-semibold">Adds to your looks</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
            <li>5 themes: {[pack.scripture, pack.lyrics, pack.announcement, pack.scriptureBand, pack.lyricsBand].map((l) => l.name).join(", ")}</li>
            <li>A name band: {pack.speaker.name}</li>
            <li>Camera scenes: {pack.scenes.map((l) => l.name).join(", ")}</li>
            <li>Your ticker look becomes {pack.ticker.name} (a ticker running now keeps its look until it starts again)</li>
            {pack.stage && <li>{plan.stage ? `Your stage display look becomes ${pack.stage.name}` : `The stage look stays: ${plan.stageOn.join(", ")} is on now`}</li>}
          </ul>
        </div>
        <div>
          <p className="font-semibold">Outputs</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {plan.set.map((o) => <li key={o.id}>{o.name}: gets {o.keyed ? "the over-the-camera bands" : "the full-screen looks"} (it is off)</li>)}
            {plan.kept.map((o) => <li key={o.id}>{o.name}: left as it is, {o.why}</li>)}
            {outputs.length === 0 && <li>No outputs yet: choose the looks for them when you add them.</li>}
          </ul>
        </div>
      </div>
      {done ? (
        <p role="status" className="flex items-center gap-1.5 text-xs font-medium text-confidence-high"><CheckIcon className="size-3.5" />{done}</p>
      ) : confirming ? (
        <div role="alertdialog" aria-labelledby="starter-confirm-title" aria-describedby="starter-confirm-text" className="rounded-lg border border-border bg-muted/40 p-3">
          <p id="starter-confirm-title" className="text-sm font-semibold">Apply the {pack.family.name} looks?</p>
          <p id="starter-confirm-text" className="mt-1 text-xs text-muted-foreground">
            {plan.set.length > 0 ? `They are added to your looks and set on ${plan.set.map((o) => o.name).join(", ")}, which ${plan.set.length === 1 ? "is" : "are"} off.` : "They are added to your looks; no output changes."} Outputs that are on keep what they show. You can change or remove each look later in Design.
          </p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="ghost" autoFocus onClick={() => setConfirming(false)}>Cancel</Button>
            <Button size="sm" onClick={apply}>Apply starter looks</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" className="self-start" onClick={() => setConfirming(true)}>Apply…</Button>
      )}
    </div>
  )
}

function Preview({ label, theme, verse, keyed }: { label: string; theme: BroadcastTheme; verse: VerseRenderData; keyed?: boolean }) {
  return (
    <figure className="flex flex-col gap-1">
      {/* A plain stand-in for the camera picture behind a keyed look. */}
      <div role="img" aria-label={`Preview: ${theme.name}`} className="aspect-video w-full overflow-hidden rounded border border-border" style={keyed ? { backgroundColor: "#2a3136" } : undefined}>
        <CanvasVerse theme={theme} verse={verse} className="[&_canvas]:rounded-none" />
      </div>
      <figcaption className="text-[0.6875rem] text-muted-foreground">{label}</figcaption>
    </figure>
  )
}
