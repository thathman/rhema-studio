import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { ExternalLinkIcon, Layers3Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useBroadcastStore } from "@/stores"
import { themeApplyPlan, themeDraftChanged, themeDraftStale } from "@/stores/broadcast-store"
import { designDraftId } from "@/lib/design-drafts"
import { DesignDraftActions } from "@/studio/design/design-draft-actions"
import { SAVE_VOCABULARY } from "@/studio/design/design-vocabulary"
import { DESIGN_GROUPS, designGroupOf, designSectionOf, type DesignGroupId } from "@/studio/design/design-groups"
import { useShellStore, type DesignTab } from "@/studio/shell-store"
import { ThemeLibrary } from "@/components/broadcast/theme-library"
import { DesignCanvas } from "@/components/broadcast/design-canvas"
import { PropertiesPanel } from "@/components/broadcast/properties-panel"
import { LowerThirdDesigner } from "@/studio/design/lower-third-designer"
import { TickerDesigner } from "@/studio/design/ticker-designer"
import { StageDesigner } from "@/studio/design/stage-designer"
import { CountdownDesigner } from "@/studio/design/countdown-designer"
import { BrandDesigner } from "@/studio/design/brand-designer"
import { DesignDocumentsWorkspace, type InitialDesignTemplate } from "@/studio/design/design-documents-workspace"
import { LookLibraryView } from "@/studio/design/look-library-view"
import { designUsage } from "@/lib/design-usage"
import { themeIdsOf } from "@/lib/output-themes"
import { outputOnAir } from "@/lib/output-on-air"
import { sceneForOutput } from "@/lib/scenes"
import { useSettingsStore } from "@/stores/settings-store"
import { mayLeaveDesignDocumentDraft } from "@/lib/design-document-draft"
import { cn } from "@/lib/utils"

/**
 * Design studio: My Designs is the canonical editable scene workflow. Sections sit in three
 * purpose groups (#818): Make, Style and Where used. Each design's and theme's own detail shows
 * where it is used; Where used keeps the overview across every output.
 */
export function DesignWorkspace() {
  const tab = useShellStore((s) => s.designTab)
  const setTab = useShellStore((s) => s.setDesignTab)
  const section = designSectionOf(tab)
  const group = designGroupOf(tab)
  // The section last open in each group, so switching groups returns to it.
  const lastInGroup = useRef<Partial<Record<DesignGroupId, DesignTab>>>({})
  useEffect(() => { lastInGroup.current[group.id] = section.id }, [group.id, section.id])
  const groupTabs = useRef<Array<HTMLButtonElement | null>>([])
  const [styleId, setStyleId] = useState<string>()
  const [pendingTemplate, setPendingTemplate] = useState<InitialDesignTemplate | null>(null)
  const documentRequest = useShellStore((s) => s.designDocumentRequest)
  const changeTab = async (next: DesignTab) => {
    if (next === tab || !(await mayLeaveDesignDocumentDraft())) return
    setTab(next)
  }
  const openGroup = (id: DesignGroupId) => {
    const target = DESIGN_GROUPS.find((g) => g.id === id)!
    void changeTab(lastInGroup.current[id] ?? target.sections[0].id)
  }
  // Tabs pattern, manual activation: arrows, Home and End move focus; Enter or Space opens.
  const onGroupKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = DESIGN_GROUPS.length - 1
    const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null
    if (next === null) return
    event.preventDefault()
    groupTabs.current[next]?.focus()
  }
  const startTemplate = async (look: InitialDesignTemplate["look"], customize: boolean) => {
    if (!(await mayLeaveDesignDocumentDraft())) return
    setPendingTemplate({ look, customize })
    setTab("my-designs")
  }

  // Opening Themes edits nothing until a theme is chosen (#830); leaving the page settles a draft (see the shell).
  useEffect(() => {
    if (tab !== "themes") return
    useBroadcastStore.getState().setDesignerOpen(true)
  }, [tab])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-4 px-8 pt-6 pb-4 max-[1200px]:px-5">
        <div className="min-w-0">
          <h1 className="text-2xl leading-tight font-semibold tracking-tight">Design</h1>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">Start in My Designs: choose a scene template, customize a private draft, then create a version for Prepare. A design version changes public output only through the normal approval and explicit Take flow.</p>
          <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">{SAVE_VOCABULARY}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tab !== "my-designs" && <Button variant="outline" onClick={() => void changeTab("my-designs")}><Layers3Icon /> Open My Designs</Button>}
          {tab === "themes" && <LiveEditSwitch />}
        </div>
      </header>
      <div className="mx-8 mb-3 flex shrink-0 flex-wrap items-end gap-x-4 gap-y-2 border-b border-border max-[1200px]:mx-5">
        <div role="tablist" aria-label="Design groups" className="mb-1.5 inline-flex shrink-0 gap-0.5 rounded-md bg-muted p-0.5">
          {DESIGN_GROUPS.map((g, index) => (
            <button
              key={g.id}
              ref={(el) => { groupTabs.current[index] = el }}
              id={`design-group-${g.id}`}
              type="button"
              role="tab"
              aria-selected={g.id === group.id}
              aria-controls="design-section-panel"
              tabIndex={g.id === group.id ? 0 : -1}
              title={g.hint}
              onClick={() => openGroup(g.id)}
              onKeyDown={(event) => onGroupKey(event, index)}
              className={cn(
                "rounded-[5px] px-3 py-1 text-xs font-bold whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                g.id === group.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
        <nav aria-label="Design sections" className="flex min-w-0 flex-wrap items-center gap-1">
          {group.sections.map(({ id, label, hint }) => (
            <button
              key={id}
              id={section.id === id ? "design-section-current" : undefined}
              type="button"
              aria-current={section.id === id ? "page" : undefined}
              title={hint}
              onClick={() => void changeTab(id)}
              className={cn(
                "-mb-px shrink-0 border-b-[3px] px-3 py-2.5 text-xs font-bold whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                section.id === id ? "border-primary text-primary-text" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
      {tab === "themes" && <div className="shrink-0 px-8 pb-3 max-[1200px]:px-5"><ThemeDraftActions /></div>}
      {tab === "themes" && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-8 pb-3 text-xs max-[1200px]:px-5" aria-label="More ways to use this look">
          <span className="font-semibold">More ways to use this look</span>
          {(["library", "lower-thirds", "ticker", "stage", "brand"] as const).map((id) => (
            <button key={id} type="button" onClick={() => void changeTab(id)} className="rounded-[5px] bg-accent px-2 py-1 text-[0.6875rem] font-bold text-accent-foreground outline-none hover:bg-accent/80 focus-visible:ring-3 focus-visible:ring-ring/50">
              {designSectionOf(id).label}
            </button>
          ))}
        </div>
      )}
      <div id="design-section-panel" role="tabpanel" aria-labelledby={`design-group-${group.id} design-section-current`} className="min-h-0 flex-1 px-8 pb-6 max-[1200px]:px-5">
        {tab === "themes" ? (
          <div className="grid h-full min-h-0 grid-cols-[240px_minmax(0,1fr)_300px] overflow-hidden rounded-lg border border-border bg-card shadow-panel max-[1200px]:grid-cols-[200px_minmax(0,1fr)_280px]">
            <ThemeLibrary />
            <DesignCanvas />
            <PropertiesPanel />
          </div>
        ) : (
          <div className="h-full overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-panel">
            {tab === "library" && <LookLibraryView onOpen={(next, id) => { setStyleId(id); void changeTab(next) }} onSceneTemplate={(look, customize) => { void startTemplate(look, customize) }} />}
            {tab === "my-designs" && <DesignDocumentsWorkspace
              onBrowseTemplates={() => void changeTab("library")}
              initialTemplate={pendingTemplate}
              onInitialTemplateHandled={() => setPendingTemplate(null)}
              initialDesignId={documentRequest}
              onInitialDesignHandled={() => {
                if (documentRequest) useShellStore.getState().clearDesignDocumentRequest(documentRequest)
              }}
            />}
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
      <p className="text-xs text-muted-foreground">Each design in My Designs and each theme also shows where it is used in its own detail; this overview covers every output at once.</p>
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
 * Themes on the same Save draft → Apply to outputs flow as the specialist tools (#830): a theme
 * draft is kept privately and changes the saved theme, and so Program, only through Apply, which
 * names the affected outputs first. Live edit stays the one explicit exception.
 */
export function ThemeDraftActions() {
  const editingThemeId = useBroadcastStore((s) => s.editingThemeId)
  const draftTheme = useBroadcastStore((s) => s.draftTheme)
  const themes = useBroadcastStore((s) => s.themes)
  const outputs = useBroadcastStore((s) => s.outputs)
  const scenes = useBroadcastStore((s) => s.scenes)
  const saved = useBroadcastStore((s) => !!editingThemeId && s.designDrafts.some((draft) => draft.id === designDraftId("theme", editingThemeId)))
  useBroadcastStore((s) => s.draftThemeBase) // the stale check below reads it
  const theme = themes.find((t) => t.id === editingThemeId)
  if (!editingThemeId || !draftTheme || !theme) {
    return <p role="status" className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">Choose a theme on the left to edit it. Edits stay in a private draft until you apply them to outputs.</p>
  }
  // The dialog lists exactly what Apply changes: the same plan Apply carries out.
  const plan = themeApplyPlan({ themes, outputs, scenes }, theme.id)
  const names = plan.outputs.map((change) => change.when === "now" ? change.name : `${change.name} (after the next Take)`)
  const stale = themeDraftStale()
  const scope = plan.copy
    ? `a new copy, “${theme.name} (Custom)”. Built-in themes are never changed, so every theme slot and saved scene layer now on “${theme.name}” switches to the copy`
    : `the theme “${theme.name}” and every output that uses it`
  return (
    <DesignDraftActions
      dirty={themeDraftChanged()}
      saved={saved}
      scope={scope}
      outputs={names}
      onSave={() => useBroadcastStore.getState().saveThemeDraft()}
      onDiscard={() => useBroadcastStore.getState().discardDraft()}
      onApply={() => {
        if (!useBroadcastStore.getState().saveDraft({ overwriteNewer: stale })) {
          throw new Error(`“${theme.name}” was saved again while you were applying. Close this and apply again to review the change.`)
        }
      }}
      onApplied={() => {}}
      staleWarning={stale ? `“${theme.name}” has been saved since this draft began. Applying replaces that newer version with this draft.` : undefined}
      extra={plan.scenes.length ? (
        <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
          <p className="font-semibold">Saved scenes switching to the copy</p>
          <ul className="mt-1 list-inside list-disc text-muted-foreground">{plan.scenes.map((scene) => <li key={scene.id}>{scene.name}</li>)}</ul>
        </div>
      ) : undefined}
      detail={<span className="text-[0.6875rem] text-muted-foreground" aria-label={`“${theme.name}” is used on`}>Used on: {names.length ? names.join(", ") : "no output yet"}</span>}
    />
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
    <label className={cn("flex h-[33px] items-center gap-2 rounded-md border px-3 text-[0.6875rem] font-semibold", on ? "border-on-air/50 bg-on-air/10 text-on-air" : "border-border text-muted-foreground")} title="Off: changes stay in the draft until you apply them. On: the screens using this theme show your changes as you make them.">
      <Switch checked={on} onCheckedChange={(v) => useBroadcastStore.getState().setLiveDesign(v)} aria-label="Live edit: show unsaved changes on the screens" />
      {on ? `Live edit · ${screens.length} ${screens.length === 1 ? "screen" : "screens"}` : "Live edit off"}
    </label>
  )
}
