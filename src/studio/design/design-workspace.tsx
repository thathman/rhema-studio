import { useEffect } from "react"
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
import { BrandDesigner } from "@/studio/design/brand-designer"
import { CONTENT_NAMES } from "@/lib/content-names"
import { themeIdsOf, themeUses } from "@/lib/output-themes"
import { cn } from "@/lib/utils"

const TABS: ReadonlyArray<readonly [DesignTab, string, string]> = [
  ["themes", "Themes", "How Bible, songs, hymns, slides and pictures look"],
  ["lower-thirds", "Lower thirds", "Names, scripture and lyrics strips"],
  ["ticker", "News ticker", "The crawl along the screen"],
  ["stage", "Stage", "What the team on the platform sees"],
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

  // Editing starts on the first theme, as the designer always did (leaving the page settles it: see the shell).
  useEffect(() => {
    const s = useBroadcastStore.getState()
    s.setDesignerOpen(true)
    if (!s.draftTheme && s.themes.length > 0) s.startEditing(s.themes[0].id)
  }, [])

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
              tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "themes" && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-8 pb-3 text-xs max-[1200px]:px-5" aria-label="More ways to use this look">
          <span className="font-semibold">More ways to use this look</span>
          {(["lower-thirds", "ticker", "stage", "brand"] as const).map((id) => (
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
            {tab === "lower-thirds" && <LowerThirdDesigner />}
            {tab === "ticker" && <TickerDesigner />}
            {tab === "stage" && <StageDesigner />}
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
  const outputs = useBroadcastStore((s) => s.outputs)
  const themes = useBroadcastStore((s) => s.themes)
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">Which outputs show each look. To change an output's look, open the output: its main look is there, and a different look for some kinds of content is under <span className="font-semibold text-foreground">Advanced: content-specific looks</span>.</p>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" aria-label="Looks and the outputs that use them">
        {themes.map((t) => {
          const uses = themeUses(outputs, t.id)
          return (
            <li key={t.id} aria-label={t.name} className="flex flex-wrap items-start gap-x-4 gap-y-1.5 px-3 py-2.5 text-sm">
              <span className="w-48 shrink-0 font-semibold">{t.name}</span>
              {uses.length === 0 ? (
                <span className="text-xs text-muted-foreground">Not on any output</span>
              ) : (
                <ul className="flex min-w-0 flex-1 flex-col gap-1">
                  {uses.map(({ output: o, main, kinds }) => (
                    <li key={o.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-medium">{o.name}</span>
                      <span className="text-muted-foreground">{[main && "main look", kinds.length > 0 && `${kinds.map((k) => CONTENT_NAMES[k]).join(", ")} only`].filter(Boolean).join(" · ")}</span>
                      <Button size="xs" variant="ghost" className="ml-auto" onClick={() => useShellStore.getState().editOutput(o.id)} aria-label={`Open output ${o.name}`}><ExternalLinkIcon /> Open output</Button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
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
