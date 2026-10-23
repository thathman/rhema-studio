import { useEffect, useState } from "react"
import { SaveIcon, TrashIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useBroadcastStore } from "@/stores"
import { useShellStore, type DesignTab } from "@/studio/shell-store"
import { ThemeLibrary } from "@/components/broadcast/theme-library"
import { DesignCanvas } from "@/components/broadcast/design-canvas"
import { PropertiesPanel } from "@/components/broadcast/properties-panel"
import { LowerThirdDesigner } from "@/studio/design/lower-third-designer"
import { TickerDesigner } from "@/studio/design/ticker-designer"
import { StageDesigner } from "@/studio/design/stage-designer"
import { BrandDesigner } from "@/studio/design/brand-designer"
import { LookLibraryView } from "@/studio/design/look-library-view"
import { CONTENT_TYPES } from "@/types/broadcast"
import { CONTENT_NAMES } from "@/lib/content-names"
import { themeIdsOf, withThemeFor } from "@/lib/output-themes"
import { cn } from "@/lib/utils"

const TABS: ReadonlyArray<readonly [DesignTab, string, string]> = [
  ["themes", "Themes", "How Bible, songs, hymns, slides and pictures look"],
  ["library", "Library", "Ready-made looks to start from"],
  ["lower-thirds", "Lower thirds", "Names, scripture and lyrics strips"],
  ["ticker", "News ticker", "The crawl along the screen"],
  ["stage", "Stage", "What the team on the platform sees"],
  ["brand", "Brand kit", "Logo, colours and fonts once"],
  ["outputs", "Output looks", "Which theme each screen uses"],
]

/**
 * Design studio: every design edit in one place — themes for each kind of
 * content, lower thirds, the news ticker, the church brand and which look
 * each output uses.
 */
export function DesignWorkspace() {
  const tab = useShellStore((s) => s.designTab)
  const setTab = useShellStore((s) => s.setDesignTab)
  // A lower-third style just added from the Library opens selected.
  const [styleId, setStyleId] = useState<string>()

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
            {tab === "lower-thirds" && <LowerThirdDesigner initialId={styleId} />}
            {tab === "ticker" && <TickerDesigner />}
            {tab === "stage" && <StageDesigner />}
            {tab === "brand" && <BrandDesigner />}
            {tab === "outputs" && <OutputLooks />}
          </div>
        )}
      </div>
    </div>
  )
}

/** Each output's main theme and, if wanted, a theme of its own for each kind of content. */
function OutputLooks() {
  const outputs = useBroadcastStore((s) => s.outputs)
  const themes = useBroadcastStore((s) => s.themes)
  const shown = outputs.filter((o) => o.role !== "stage")
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Each screen shows everything in its main theme unless a kind of content has its own here (hymns in gold, the Bible in blue…). The stage display has no theme.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] border-separate border-spacing-y-1 text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-2 py-1 font-semibold">Output</th>
              <th className="px-2 py-1 font-semibold">Main theme</th>
              {CONTENT_TYPES.map((c) => <th key={c} className="px-2 py-1 font-semibold">{CONTENT_NAMES[c]}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((o) => (
              <tr key={o.id} className="bg-surface-sunken/60">
                <td className="rounded-l-lg px-2 py-2 font-medium">{o.name}<span className="block text-xs font-normal text-muted-foreground">{o.role === "signage" ? "Signage" : o.type === "ndi" ? "NDI" : "Screen"}</span></td>
                <td className="px-2 py-2">
                  <Select value={o.themeId} onValueChange={(v) => useBroadcastStore.getState().setOutputTheme(o.id, v)}>
                    <SelectTrigger aria-label={`Main theme for ${o.name}`} className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{themes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                  </Select>
                </td>
                {CONTENT_TYPES.map((c, i) => (
                  <td key={c} className={cn("px-2 py-2", i === CONTENT_TYPES.length - 1 && "rounded-r-lg")}>
                    <Select value={o.themeFor?.[c] || "__same"} onValueChange={(v) => useBroadcastStore.getState().updateOutput(o.id, { themeFor: withThemeFor(o, c, v === "__same" ? null : v) })}>
                      <SelectTrigger aria-label={`${CONTENT_NAMES[c]} on ${o.name}`} className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__same">Main theme</SelectItem>
                        {themes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
