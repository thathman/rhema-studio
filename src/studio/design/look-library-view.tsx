import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { ask } from "@tauri-apps/plugin-dialog"
import { HeartIcon, MoreHorizontalIcon, PaletteIcon, PencilIcon, PlusIcon, RotateCcwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useBroadcastStore, useSettingsStore } from "@/stores"
import { useShellStore, type DesignTab } from "@/studio/shell-store"
import { LOWER_THIRDS } from "@/lib/builtin-themes"
import { SAMPLE_BILINGUAL_SONG } from "@/lib/theme-migrations"
import { LIBRARY_LOOKS, LOOK_FAMILIES } from "@/lib/look-library-data"
import { adoptLook, brandable, CONTENT_LABELS, filterLooks, isObsOverlay, LAYOUT_NAMES, lookAspects, lookAudio, lookCopies, lookLanguages, OBS_OVERLAY, readLookFavourites, resetCopy, resetLowerThirdCopy, resetSceneCopy, resetSingleLook, showsTwoLanguages, writeLookFavourites, type LibraryLook, type LookAspect, type LookBackground, type LookCopy, type LookFamilyId, type LookLanguage, type LookLayout } from "@/lib/look-library"
import { openProductionTab } from "@/studio/production/production-tab"
import { hasChurchColours, type BrandKit } from "@/lib/brand-kit"
import { mayLeaveThemeDraft } from "@/lib/theme-draft"
import { drawScene } from "@/lib/scene-renderer"
import { drawStage } from "@/lib/stage-canvas"
import { applyStageStyle } from "@/lib/stage-style"
import { onThemeFontsLoaded } from "@/lib/verse-renderer"
import { themeImageCache } from "@/lib/theme-image-cache"
import { cn } from "@/lib/utils"
import type { BroadcastTheme, LowerThird, SceneFrame, StagePayload, Ticker, VerseRenderData } from "@/types"

// Sample words for the previews: public-domain scripture and hymn text, in English and Yorùbá.
const PSALM_EN = "Make a joyful noise unto the LORD, all ye lands."
const PSALM_YO = "Ẹ hó ìhó ayọ̀ sí Olúwa, gbogbo ilẹ̀."
const BIBLE_SAMPLE: VerseRenderData = { content: "bible", reference: "Psalm 100:1", segments: [{ verseNumber: 1, text: PSALM_EN }], translationLines: [PSALM_EN, PSALM_YO] }
const SONG_SAMPLE: VerseRenderData = { ...SAMPLE_BILINGUAL_SONG, content: "hymn" }
const NOTICE_SAMPLE: VerseRenderData = { kind: "slide", content: "slide", reference: "This week", segments: [{ text: "Youth meeting, Friday 6 pm. Choir practice, Saturday 4 pm." }], lines: ["Youth meeting · Friday 6 pm", "Choir practice · Saturday 4 pm"] }
const SPEAKER_SAMPLE = { line1: "Pastor Adéwálé Ògúnlẹ́yẹ", line2: "Senior Pastor · Olùṣọ́-àgùntàn" }
const NOTICES_SAMPLE = ["Ẹ kú àbọ̀: welcome to everyone joining us today", "Youth meeting, Friday 6 pm", "Harvest thanksgiving next Sunday"]
const STAGE_SAMPLE: StagePayload = {
  current: { title: "Psalm 100:1", lines: [PSALM_EN, PSALM_YO] },
  next: "Offering",
  note: "Reader comes to the lectern",
  timer: { label: "12:40", tone: "ok" },
  message: null,
  band: "Key G · 72 bpm",
  finish: { time: "11:42", lateMin: 0 },
}
const NO_WORDS: VerseRenderData = { reference: "", segments: [] }
// A keyed frame with nothing of its own, for previewing bands and tickers over it.
const KEYED: BroadcastTheme = { ...LOWER_THIRDS, id: "look-preview-keyed", textBox: { ...LOWER_THIRDS.textBox, enabled: false } }
// Transparent looks are previewed over the usual sign for "nothing here", so the key is visible.
const CHECKER = { backgroundColor: "#2c3338", backgroundImage: "repeating-conic-gradient(#3a4248 0% 25%, transparent 0% 50%)", backgroundSize: "18px 18px" }

const sampleFor = (shows: string[] | undefined) => (shows?.includes("bible") ? BIBLE_SAMPLE : SONG_SAMPLE)
const themeLook = (id: string | undefined) => {
  const l = LIBRARY_LOOKS.find((x) => x.id === id)
  return l?.kind === "theme" ? l.theme : undefined
}

const LAYOUTS: ReadonlyArray<LookLayout | "obs-overlay" | "all"> = ["all", "fullscreen", "lower-third", "ticker", "scene", "stage", "obs-overlay"]
const layoutLabel = (l: LookLayout | "obs-overlay" | "all") => (l === "all" ? "All layouts" : l === "obs-overlay" ? OBS_OVERLAY : LAYOUT_NAMES[l])
// The aspect filter shows once the library has looks in more than one frame shape.
const ASPECTS = lookAspects(LIBRARY_LOOKS)
const BACKGROUNDS: ReadonlyArray<readonly [LookBackground | "all", string]> = [["all", "Any"], ["dark", "Dark"], ["light", "Light"], ["transparent", "Transparent"]]
const LANGUAGES: ReadonlyArray<readonly [LookLanguage | "both" | "all", string]> = [["all", "Any language"], ["yo", "Yorùbá"], ["en", "English"], ["both", "Both together"]]

const storage = typeof localStorage === "undefined" ? null : localStorage

/**
 * Design → Library: ready-made looks to start from. Use adds the church's own
 * copy; nothing on a screen changes until that copy is chosen for an output.
 */
export function LookLibraryView({ onOpen }: { onOpen: (tab: DesignTab, id?: string) => void }) {
  const [layout, setLayout] = useState<LookLayout | "obs-overlay" | "all">("all")
  const [aspect, setAspect] = useState<LookAspect | "all">("all")
  const [family, setFamily] = useState<LookFamilyId | "all">("all")
  const [background, setBackground] = useState<LookBackground | "all">("all")
  const [language, setLanguage] = useState<LookLanguage | "both" | "all">("all")
  const [favouritesOnly, setFavouritesOnly] = useState(false)
  const [favourites, setFavourites] = useState(() => readLookFavourites(storage))
  const looks = useMemo(() => filterLooks(LIBRARY_LOOKS, { layout, family, background, language, aspect, favouritesOnly, favourites }), [layout, family, background, language, aspect, favouritesOnly, favourites])
  const groups = LOOK_FAMILIES.map((f) => ({ family: f, looks: looks.filter((l) => l.family === f.id) })).filter((g) => g.looks.length > 0)

  const toggleFavourite = (id: string) => {
    const next = new Set(favourites)
    if (!next.delete(id)) next.add(id)
    setFavourites(next)
    writeLookFavourites(storage, next)
  }
  const clear = () => { setLayout("all"); setFamily("all"); setBackground("all"); setLanguage("all"); setAspect("all"); setFavouritesOnly(false) }

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Ready-made looks, made for Rhema Studio and fully offline. <strong className="font-semibold text-foreground">Use</strong> adds your own copy to your looks, to change as you like.
        Nothing on the screens changes until you choose the copy for an output in its settings.
      </p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Layout">
          {LAYOUTS.map((l) => (
            <Chip key={l} on={layout === l} onClick={() => setLayout(l)} title={l === "obs-overlay" ? "Lower thirds and tickers with nothing behind them, to lay over the camera in OBS" : undefined}>{layoutLabel(l)}</Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Background">
          {BACKGROUNDS.map(([b, label]) => (
            <Chip key={b} on={background === b} onClick={() => setBackground(b)}>{b === "all" ? "Any background" : label}</Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Language">
          {LANGUAGES.map(([l, label]) => (
            <Chip key={l} on={language === l} onClick={() => setLanguage(l)}>{label}</Chip>
          ))}
        </div>
        {ASPECTS.length > 1 && (
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Frame shape">
            {(["all", ...ASPECTS] as const).map((a) => (
              <Chip key={a} on={aspect === a} onClick={() => setAspect(a)}>{a === "all" ? "Any shape" : a}</Chip>
            ))}
          </div>
        )}
        <Select value={family} onValueChange={(v) => setFamily(v as LookFamilyId | "all")}>
          <SelectTrigger aria-label="Family" className="h-7 w-48 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every family</SelectItem>
            {LOOK_FAMILIES.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <button type="button" aria-pressed={favouritesOnly} onClick={() => setFavouritesOnly(!favouritesOnly)} className={cn("flex items-center gap-1 rounded-full border px-2.5 py-0.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-3.5", favouritesOnly ? "border-primary/60 bg-primary/10 text-foreground" : "border-border text-muted-foreground")}>
          <HeartIcon className={cn(favouritesOnly && "fill-current text-primary-text")} /> Favourites
        </button>
      </div>
      {groups.length === 0 ? (
        <div className="flex flex-col items-start gap-2 py-8 text-sm text-muted-foreground">
          {favouritesOnly && favourites.size === 0 ? "No favourites yet: mark a look with the heart to keep it here." : "No looks match these filters."}
          <Button size="sm" variant="outline" onClick={clear}>Show every look</Button>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.family.id} aria-label={g.family.name} className="flex flex-col gap-3">
            <header>
              <h3 className="text-sm font-bold">{g.family.name}</h3>
              <p className="text-xs text-muted-foreground">{g.family.description}</p>
            </header>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
              {g.looks.map((l) => <LookCard key={l.id} look={l} favourite={favourites.has(l.id)} onFavourite={() => toggleFavourite(l.id)} onOpen={onOpen} />)}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}

function Chip({ on, onClick, title, children }: { on: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick} title={title} className={cn("rounded-full border px-2.5 py-0.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50", on ? "border-primary/60 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
      {children}
    </button>
  )
}

const BACKGROUND_NAMES: Record<LookBackground, string> = { dark: "Dark", light: "Light", transparent: "Transparent (keyed)" }

/** The card's language line: two at once, either one, or English only. */
function languageWords(look: LibraryLook): string {
  if (showsTwoLanguages(look, LIBRARY_LOOKS)) return "Yorùbá and English together"
  return lookLanguages(look, LIBRARY_LOOKS).includes("yo") ? "Yorùbá or English" : "English"
}

/** The church's copies of a look and what shows each now, kept up to date. */
function useLookCopies(look: LibraryLook): LookCopy[] {
  const themes = useBroadcastStore((s) => s.themes)
  const lowerThirdStyles = useBroadcastStore((s) => s.lowerThirdStyles)
  const scenes = useBroadcastStore((s) => s.scenes)
  const tickerStyle = useBroadcastStore((s) => s.tickerStyle)
  const stageStyle = useBroadcastStore((s) => s.stageStyle)
  const outputs = useBroadcastStore((s) => s.outputs)
  const outputStatus = useBroadcastStore((s) => s.outputStatus)
  const lowerThird = useBroadcastStore((s) => s.lowerThird)
  const ticker = useBroadcastStore((s) => s.ticker)
  return useMemo(() => lookCopies(look, { themes, lowerThirdStyles, scenes, tickerStyle, stageStyle, outputs, outputStatus, lowerThird, ticker }), [look, themes, lowerThirdStyles, scenes, tickerStyle, stageStyle, outputs, outputStatus, lowerThird, ticker])
}

const COPIES_WHERE: Record<LibraryLook["kind"], string> = { theme: "In your themes", "lower-third": "In your lower-third styles", scene: "In your scenes", ticker: "In use", stage: "In use" }

function LookCard({ look, favourite, onFavourite, onOpen }: { look: LibraryLook; favourite: boolean; onFavourite: () => void; onOpen: (tab: DesignTab, id?: string) => void }) {
  const copies = useLookCopies(look)
  return (
    <li className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <LookPreview look={look} />
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="flex items-start gap-2">
          <h4 className="min-w-0 flex-1 text-xs leading-snug font-semibold">{look.name}</h4>
          <button type="button" aria-pressed={favourite} aria-label={favourite ? `Remove ${look.name} from favourites` : `Add ${look.name} to favourites`} onClick={onFavourite} className="-m-1 rounded p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-3.5">
            <HeartIcon className={cn(favourite && "fill-current text-primary-text")} />
          </button>
        </div>
        <p className="text-[0.6875rem] text-muted-foreground">{LAYOUT_NAMES[look.layout]} · {CONTENT_LABELS[look.content]} · {BACKGROUND_NAMES[look.background]}{isObsOverlay(look) ? ` · ${OBS_OVERLAY}` : ""} · {look.aspect}{lookAudio(look) === "own-sound" ? " · Has its own sound" : ""} · {languageWords(look)}</p>
        <p className="text-xs text-muted-foreground">{look.purpose}</p>
        {copies.length > 0 && <p className="text-[0.6875rem] text-muted-foreground">{COPIES_WHERE[look.kind]}: {copies.map((c) => c.name).join(", ")}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-1 pt-1.5">
          <Button size="xs" onClick={() => void addLook(look, false, onOpen)} title="Add your own copy to your looks"><PlusIcon /> Use</Button>
          <Button size="xs" variant="outline" onClick={() => void addLook(look, true, onOpen)} title={look.kind === "scene" ? "Add your own copy and open it in Production → Scenes" : "Add your own copy and open it to edit"}><PencilIcon /> Use and edit</Button>
          {brandable(look) && <ChurchColoursButton look={look} onOpen={onOpen} />}
          {copies.length > 0 && <ResetMenu look={look} copies={copies} />}
        </div>
      </div>
    </li>
  )
}

/**
 * Use with church colours: the copy takes the Brand Kit's colours and fonts. Before the church has
 * set any, it says where to set them instead.
 */
function ChurchColoursButton({ look, onOpen }: { look: LibraryLook; onOpen: (tab: DesignTab, id?: string) => void }) {
  const kit = useSettingsStore((s) => s.brandKit)
  const applied = useBroadcastStore((s) => s.themes.some((t) => t.brandManaged))
  const ready = applied || hasChurchColours(kit)
  const click = () => {
    if (ready) return void addLook(look, false, onOpen, kit)
    toast("Set your church colours in Design → Brand Kit first.", { description: "Then this adds a copy of the look in those colours and fonts.", action: { label: "Open Brand Kit", onClick: () => onOpen("brand") } })
  }
  return (
    <Button size="xs" variant="outline" onClick={click} title={ready ? "Add your own copy in your Brand Kit colours and fonts" : "Set your church colours in Design → Brand Kit"}>
      <PaletteIcon /> Use with church colours
    </Button>
  )
}

/** Reset: put one of the church's copies back as the library has it. Not for a copy a screen shows now. */
function ResetMenu({ look, copies }: { look: LibraryLook; copies: LookCopy[] }) {
  const single = look.kind === "ticker" || look.kind === "stage"
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label={`More for ${look.name}`}><MoreHorizontalIcon /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-72">
        <DropdownMenuLabel className="text-[0.6875rem]">{single ? "Reset to this look" : "Reset a copy to this look"}</DropdownMenuLabel>
        {copies.map((c) => (
          <DropdownMenuItem key={c.id} disabled={c.usedBy.length > 0} onSelect={() => void reset(look, c)}>
            <RotateCcwIcon /> <span className="truncate">{c.name}{c.usedBy.length > 0 ? ` (on ${c.usedBy.join(", ")})` : ""}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Put a copy back as the library look has it. Refused when something shows it now (checked again here). */
async function reset(look: LibraryLook, c: LookCopy) {
  const s = useBroadcastStore.getState()
  const now = lookCopies(look, s).find((x) => x.id === c.id)
  if (!now || now.usedBy.length > 0) return
  switch (look.kind) {
    case "theme": {
      const copy = s.themes.find((t) => t.id === c.id)
      if (!copy) return
      const open = s.editingThemeId === copy.id
      if (open && !(await mayLeaveThemeDraft())) return
      s.saveTheme(resetCopy(copy, look))
      // The Designer reloads the copy, so a later Save does not bring the old version back.
      if (open) useBroadcastStore.getState().startEditing(copy.id)
      break
    }
    case "lower-third": {
      const copy = s.lowerThirdStyles.find((x) => x.id === c.id)
      if (copy) s.saveLowerThirdStyle(resetLowerThirdCopy(copy, look))
      break
    }
    case "scene": {
      const copy = s.scenes.find((x) => x.id === c.id)
      if (!copy) return
      const taken = [...s.themes.map((t) => t.name), ...s.scenes.map((x) => x.name), ...s.lowerThirdStyles.map((x) => x.name)]
      const back = resetSceneCopy(copy, look, { library: LIBRARY_LOOKS, themes: s.themes, takenNames: taken })
      for (const t of back.themes) useBroadcastStore.getState().saveTheme(t)
      useBroadcastStore.getState().saveScene(back.scene)
      break
    }
    case "ticker":
      // Only the saved look (nothing is running: Reset waits until the ticker stops).
      useBroadcastStore.setState({ tickerStyle: resetSingleLook(look) })
      break
    case "stage":
      // No stage screen is on (Reset waits until they are off); they show it when next turned on.
      s.saveStageStyle(resetSingleLook(look))
      break
  }
  toast(`“${c.name}” is back to the library look.`)
}

/**
 * Add the look's copies to the church's looks; with `edit`, open the copy too; with `brand`, the
 * copies take the church's colours and fonts. Never touches an output or the library look.
 */
async function addLook(look: LibraryLook, edit: boolean, onOpen: (tab: DesignTab, id?: string) => void, brand?: BrandKit) {
  if (look.kind === "ticker" && !(await confirm(`Use “${look.name}” as your ticker look?`, "It replaces your ticker's look. A ticker running now keeps its look until you start it again."))) return
  if (look.kind === "stage" && !(await confirm(`Use “${look.name}” on the stage display?`, "It replaces your stage look, and stage screens show it straight away. The congregation never sees the stage display."))) return
  if (edit && look.kind === "theme" && !(await mayLeaveThemeDraft())) return
  const s = useBroadcastStore.getState()
  const taken = [...s.themes.map((t) => t.name), ...s.scenes.map((x) => x.name), ...s.lowerThirdStyles.map((x) => x.name)]
  const added = adoptLook(look, { takenNames: taken, library: LIBRARY_LOOKS, brand })
  for (const t of added.themes) useBroadcastStore.getState().saveTheme(t)
  if (added.lowerThirdStyle) useBroadcastStore.getState().saveLowerThirdStyle(added.lowerThirdStyle)
  // Only the saved look: the ticker on air keeps the look it started with.
  if (added.tickerStyle) useBroadcastStore.setState({ tickerStyle: added.tickerStyle })
  if (added.stageStyle) useBroadcastStore.getState().saveStageStyle(added.stageStyle)
  if (added.scene) useBroadcastStore.getState().saveScene(added.scene)

  const choose = { label: "Choose for a screen", onClick: () => useShellStore.getState().openOutputs() }
  const keptNote = keptColours(added.kept)
  switch (look.kind) {
    case "theme": {
      const copy = added.themes[0]
      if (edit) {
        useBroadcastStore.getState().startEditing(copy.id)
        onOpen("themes")
      }
      toast(`Added “${copy.name}” to your themes.`, { description: `${keptNote}Choose it for an output in the output's settings; nothing on the screens has changed.`, action: choose })
      return
    }
    case "lower-third":
      if (edit) onOpen("lower-thirds", added.lowerThirdStyle?.id)
      toast(`Added “${added.lowerThirdStyle?.name}” to your lower-third styles.`, { description: `${keptNote}Pick it when you show a name in Present. A band on air now keeps its look.` })
      return
    case "ticker":
      if (edit) onOpen("ticker")
      toast(`Your ticker now uses “${look.name}”.`)
      return
    case "stage":
      if (edit) onOpen("stage")
      toast(`The stage display now uses “${look.name}”.`)
      return
    case "scene":
      // Scenes opens the copy in the composer: arranging it there changes nothing on air until Take.
      if (edit && added.scene) openProductionTab("programs", { sceneId: added.scene.id })
      toast(`Added the scene “${added.scene?.name}”${added.themes.length ? ` and its look “${added.themes.map((t) => t.name).join("”, “")}”` : ""}.`, { description: `${keptNote}Set its camera and take it in Production → Scenes; nothing is on air yet.` })
      return
  }
}

/** Which of the look's own colours a church-colour copy kept, and why; empty when none. */
function keptColours(kept: { text: boolean; accent: boolean } | undefined): string {
  if (!kept || (!kept.text && !kept.accent)) return ""
  const which = kept.text && kept.accent ? "text and accent colours" : kept.text ? "text colour" : "accent colour"
  return `Kept the look's own ${which}: your church's would be hard to read on this background. `
}

async function confirm(title: string, message: string): Promise<boolean> {
  try {
    return await ask(message, { title, kind: "info", okLabel: "Use it", cancelLabel: "Cancel" })
  } catch {
    return false
  }
}

/** A realistic preview, drawn by the same code the outputs use. */
function LookPreview({ look }: { look: LibraryLook }) {
  const keyed = look.background === "transparent"
  const label = `Preview of ${look.name}`
  return (
    <div className="aspect-video w-full overflow-hidden border-b border-border" style={keyed ? CHECKER : undefined} aria-label={label} role="img">
      {look.kind === "theme" && <CanvasVerse theme={look.theme} verse={look.content === "bible" ? BIBLE_SAMPLE : look.content === "announcements" ? NOTICE_SAMPLE : SONG_SAMPLE} className="[&_canvas]:rounded-none" />}
      {look.kind === "lower-third" && <CanvasVerse theme={KEYED} verse={NO_WORDS} overlay={{ ...SPEAKER_SAMPLE, style: look.style } satisfies LowerThird} className="[&_canvas]:rounded-none" />}
      {/* Further into the crawl than a fresh ticker, so the preview shows its words. */}
      {look.kind === "ticker" && <CanvasVerse theme={KEYED} verse={NO_WORDS} ticker={{ items: NOTICES_SAMPLE, style: { ...look.style, speed: look.style.speed * 3 }, startedAt: 0, backing: null } satisfies Ticker} className="[&_canvas]:rounded-none" />}
      {look.kind === "stage" && <StagePreview look={look} />}
      {look.kind === "scene" && <ScenePreview look={look} />}
    </div>
  )
}

function StagePreview({ look }: { look: Extract<LibraryLook, { kind: "stage" }> }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext("2d")
    if (ctx) drawStage(ctx, 1280, 720, applyStageStyle(STAGE_SAMPLE, look.style))
  }, [look])
  return <canvas ref={ref} width={1280} height={720} className="block h-full w-full" />
}

// One canvas for every scene preview's feed layer: each is drawn and placed before the next.
let layerCanvas: HTMLCanvasElement | null = null

function ScenePreview({ look }: { look: Extract<LibraryLook, { kind: "scene" }> }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const draw = () => {
      const canvas = ref.current
      const ctx = canvas?.getContext("2d")
      if (!canvas || !ctx) return
      const frame: SceneFrame = {
        sceneId: look.id,
        // A plain stand-in for the camera picture.
        background: "#2a3136",
        layers: look.scene.layers.map((l, i) => l.kind === "camera"
          ? { id: `${i}`, kind: "camera", box: l.box, opacity: 1, label: "Camera" }
          : { id: `${i}`, kind: "feed", box: l.box, opacity: 1, theme: themeLook(l.lookId), verse: sampleFor(l.shows) }),
      }
      try {
        drawScene(ctx, canvas.width, canvas.height, frame, { image: () => null, layerCanvas: () => (layerCanvas ??= document.createElement("canvas")), imageCache: themeImageCache(), preview: true })
      } catch (e) {
        console.error("[look-library] scene preview failed to draw", e)
      }
    }
    draw()
    return onThemeFontsLoaded(draw)
  }, [look])
  return <canvas ref={ref} width={960} height={540} className="block h-full w-full" />
}
