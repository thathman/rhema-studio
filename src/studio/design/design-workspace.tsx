import { useEffect, useState } from "react"
import { ExternalLinkIcon, SaveIcon, TrashIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useBroadcastStore } from "@/stores"
import { useShellStore, type DesignTab } from "@/studio/shell-store"
import { ThemeLibrary } from "@/components/broadcast/theme-library"
import { DesignCanvas } from "@/components/broadcast/design-canvas"
import { PropertiesPanel } from "@/components/broadcast/properties-panel"
import { LowerThirdDesigner } from "@/studio/design/lower-third-designer"
import { TickerDesigner } from "@/studio/design/ticker-designer"
import { StageDesigner } from "@/studio/design/stage-designer"
import { CountdownDesigner } from "@/studio/design/countdown-designer"
import { BrandDesigner } from "@/studio/design/brand-designer"
import { LookLibraryView } from "@/studio/design/look-library-view"
import { DesignDocumentsWorkspace } from "@/studio/design/design-documents-workspace"
import { designUsage } from "@/lib/design-usage"
import { themeIdsOf } from "@/lib/output-themes"
import { outputOnAir } from "@/lib/output-on-air"
import { sceneForOutput } from "@/lib/scenes"
import { useSettingsStore } from "@/stores/settings-store"
import { cn } from "@/lib/utils"

const TABS: ReadonlyArray<readonly [DesignTab, string, string]> = [
  ["themes", "Themes", "How Bible, songs, hymns, slides and pictures look"],
  ["library", "Templates", "Ready-made looks and layouts to start from"],
  ["my-designs", "My Designs", "Church-owned designs, drafts and immutable versions"],
  ["lower-thirds", "Lower thirds", "Names, scripture and lyrics strips"],
  ["ticker", "News ticker", "The crawl along the screen"],
  ["stage", "Stage", "What the team on the platform sees"],
  ["countdown", "Countdown", "One big time that turns amber, then red, as time runs out"],
  ["brand", "Brand kit", "Logo, colours and fonts once"],
  ["used-on", "Used on…", "Which outputs show each look"],
]

/**
 * Design studio: every design edit in one place — themes for each kind of
 * content, lower thirds, the news ticker and the church brand, and where each
 * look is used (choosing it per output is in the output's editor).
 */
export function DesignWorkspace() {
  const tab = useShellStore((s) => s.designTab)
  const setTab = useShellStore((s) => s.setDesignTab)
  // A lower-third style just added from Templates opens selected.
  const [styleId, setStyleId] = useState<string>()

  // Editing starts on the first theme, as the designer always did (leaving the page settles it: see the shell).
  useEffect(() => {
    if (tab !== "themes") return
    const s = useBroadcastStore.getState()
    s.setDesignerOpen(true)
    if (!s.draftTheme && s.themes.length > 0) s.startEditing(s.themes[0].id)
  }, [tab])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-4 px-8 pt-6 pb-4 max-[1200px]:px-5">
        <div className="min-w-0">
          <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">The creative workspace</p>
          <h1 className="mt-1 text-[1.625rem] leading-tight font-bold tracking-[-0.035em]">Design once. Beautiful everywhere.</h1>
          <p className="mt-1 text-xs text-muted-foreground">Every look in one place: scripture, songs, hymns, slides, pictures, lower thirds, the ticker, the stage display and your brand.</p>
        </div>
        {tab === "themes" && (
          <div className="flex flex-wrap items-center gap-2">
            <LiveEditSwitch />
            <Button variant="outline" onClick={() => useBroadcastStore.getState().discardDraft()}><TrashIcon /> Discard changes</Button>
            <Button onClick={() => useBroadcastStore.getState().saveDraft()}><SaveIcon /> Save theme</Button>
          </div>
        )}
      </header>
      <div role="tablist" aria-label="What you are designing" className="mx-8 mb-3 flex shrink-0 gap-1 overflow-x-auto border-b border-border max-[1200px]:mx-5">
        {TABS.map(([id, label, hint]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            title={hint}
            onClick={() => setTab(id)}
            className={cn(
              "-mb-px shrink-0 border-b-[3px] px-3 py-2.5 text-xs font-bold whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              tab === id ? "border-primary text-primary-text" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "themes" && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-8 pb-3 text-xs max-[1200px]:px-5" aria-label="More ways to use this look">
          <span className="font-semibold">More ways to use this look</span>
          {(["library", "lower-thirds", "ticker", "stage", "brand"] as const).map((id) => (
            <button key={id} type="button" onClick={() => setTab(id)} className="rounded-[5px] bg-accent px-2 py-1 text-[0.6875rem] font-bold text-accent-foreground outline-none hover:bg-accent/80 focus-visible:ring-3 focus-visible:ring-ring/50">
              {TABS.find((t) => t[0] === id)?.[1]}
            </button>
          ))}
        </div>
      )}
      <div role="tabpanel" aria-label={TABS.find((t) => t[0] === tab)?.[1]} className="min-h-0 flex-1 px-8 pb-6 max-[1200px]:px-5">
        {tab === "themes" ? (
          <div className="grid h-full min-h-0 grid-cols-[240px_minmax(0,1fr)_300px] overflow-hidden rounded-lg border border-border bg-card shadow-panel max-[1200px]:grid-cols-[200px_minmax(0,1fr)_280px]">
            <ThemeLibrary />
            <DesignCanvas />
            <PropertiesPanel />
          </div>
        ) : (
          <div className="h-full overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-panel">
            {tab === "library" && <LookLibraryView onOpen={(next, id) => { setStyleId(id); setTab(next) }} />}
            {tab === "my-designs" && <DesignDocumentsWorkspace />}
            {tab === "lower-thirds" && <LowerThirdDesigner initialId={styleId} />}
            {tab === "ticker" && <TickerDesigner />}
            {tab === "stage" && <StageDesigner />}
            {tab === "countdown" && <CountdownDesigner />}
            {tab === "brand" && <BrandDesigner />}
            {(tab === "used-on" || tab === "outputs") && <UsedOn />}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Where each look is used (#299 UX15-4): the outputs showing it, as their main look or for some
 * kinds of content. Choosing an output's looks happens in its own editor (Open output), so Design
 * keeps the looks and Production keeps where they go.
 */
export function UsedOn() {
  const themes = useBroadcastStore((s) => s.themes)
  const outputs = useBroadcastStore((s) => s.outputs)
  const outputStatus = useBroadcastStore((s) => s.outputStatus)
  const scenes = useBroadcastStore((s) => s.scenes)
  const lowerThirdStyles = useBroadcastStore((s) => s.lowerThirdStyles)
  const lowerThird = useBroadcastStore((s) => s.lowerThird)
  const tickerStyle = useBroadcastStore((s) => s.tickerStyle)
  const ticker = useBroadcastStore((s) => s.ticker)
  const stageStyle = useBroadcastStore((s) => s.stageStyle)
  const countdownLook = useBroadcastStore((s) => s.countdownLook)
  const liveDesign = useBroadcastStore((s) => s.liveDesign)
  const draftTheme = useBroadcastStore((s) => s.draftTheme)
  const brandKit = useSettingsStore((s) => s.brandKit)
  const usage = designUsage({
    themes, outputs, outputStatus, scenes, lowerThirdStyles, lowerThird,
    tickerStyle, ticker, stageStyle, countdownLook, brandKit,
  })
  const liveEditConfiguredOutputs = liveDesign && draftTheme
    ? outputs.filter((output) => {
      if ((output.role ?? "congregation") !== "congregation") return false
      return themeIdsOf(output).includes(draftTheme.id)
    })
    : []
  const liveEditSceneOutputs = liveDesign && draftTheme
    ? outputs.filter((output) => {
      if ((output.role ?? "congregation") !== "congregation") return false
      const scene = sceneForOutput(output, scenes)
      // Keep this condition aligned with the scene Live Edit branch in broadcast-store.
      return !!scene?.layers.some((layer) =>
        layer.themeId === draftTheme.id ||
        (!layer.themeId && ["feed", "clock", "camera", "ticker", "lowerThird"].includes(layer.kind) && themeIdsOf(output).includes(draftTheme.id)),
      )
    })
    : []
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <p className="text-sm text-muted-foreground">Saved assignments and output status are shown here. Name bands and the ticker appear only while their source is running; taken scenes pin their appearance until refreshed. Drafts in the other design tools stay private until their deliberate Apply or Take action. Theme Live Edit is the explicit exception.</p>
      {liveDesign && (
        <p role="status" className="rounded-md border border-on-air/30 bg-on-air/5 px-3 py-2 text-sm">
          {draftTheme
            ? `Theme Live Edit is on for “${draftTheme.name}”. Configured congregation outputs: ${liveEditConfiguredOutputs.length ? liveEditConfiguredOutputs.map((output) => `${output.name} (${outputOnAir(output, outputStatus[output.id]) ? "on" : "off"})`).join(", ") : "none"}. Assigned scenes with layers that can render this draft: ${liveEditSceneOutputs.length ? liveEditSceneOutputs.map((output) => output.name).join(", ") : "none"}.`
            : "Theme Live Edit is on, but no theme draft is open."}
        </p>
      )}
      <p className="text-xs text-muted-foreground">To change an output's look, open it: its main look is there, and content-specific looks are under <span className="font-semibold text-foreground">Advanced: content-specific looks</span>.</p>
      {usage.map((section) => (
        <section key={section.id} aria-labelledby={`design-usage-${section.id}`}>
          <h2 id={`design-usage-${section.id}`} className="mb-2 text-sm font-semibold">{section.title}</h2>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" aria-label={section.id === "themes" ? "Looks and the outputs that use them" : `${section.title} and the outputs that use them`}>
            {section.entries.map((entry) => (
              <li key={entry.id} aria-label={entry.name} className="flex flex-wrap items-start gap-x-4 gap-y-1.5 px-3 py-2.5 text-sm">
                <div className="w-48 min-w-0 shrink-0">
                  <span className="font-semibold">{entry.name}</span>
                  {entry.source && <span className="block text-xs font-normal text-muted-foreground">From {entry.source}</span>}
                </div>
                {entry.outputs.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{section.emptyLabel}</span>
                ) : (
                  <ul className="flex min-w-0 flex-1 flex-col gap-1">
                    {entry.outputs.map((output) => (
                      <li key={output.outputId} className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-medium">{output.outputName}</span>
                        <span className="text-muted-foreground">{output.detail}</span>
                        <span className={cn("rounded px-1.5 py-0.5 font-semibold", output.on ? "bg-on-air/10 text-on-air" : "bg-muted text-muted-foreground")}>{output.on ? "Output on" : "Output off"}</span>
                        <Button size="xs" variant="ghost" className="ml-auto" onClick={() => useShellStore.getState().editOutput(output.outputId)} aria-label={`Open output ${output.outputName} from ${entry.name}`}><ExternalLinkIcon /> Open output</Button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/**
 * Live edit (ADR 0001): off, a draft stays in the Designer; on, the screens using this theme show it
 * as it is edited. It turns itself off when editing ends.
 */
function LiveEditSwitch() {
  const on = useBroadcastStore((s) => s.liveDesign)
  const editing = useBroadcastStore((s) => s.editingThemeId)
  const outputs = useBroadcastStore((s) => s.outputs)
  const screens = editing ? outputs.filter((o) => (o.role ?? "congregation") === "congregation" && themeIdsOf(o).includes(editing)) : []
  if (!editing) return null
  return (
    <label className={cn("flex h-[33px] items-center gap-2 rounded-md border px-3 text-[0.6875rem] font-semibold", on ? "border-on-air/50 bg-on-air/10 text-on-air" : "border-border text-muted-foreground")} title="Off: changes stay here until you save. On: the screens using this theme show your changes as you make them.">
      <Switch checked={on} onCheckedChange={(v) => useBroadcastStore.getState().setLiveDesign(v)} aria-label="Live edit: show unsaved changes on the screens" />
      {on ? `Live edit · ${screens.length} ${screens.length === 1 ? "screen" : "screens"}` : "Live edit off"}
    </label>
  )
}
