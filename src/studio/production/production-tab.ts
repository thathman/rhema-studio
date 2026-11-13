import { create } from "zustand"
import { useShellStore } from "@/studio/shell-store"

export type ProductionTab = "timekeeper" | "screens" | "health" | "programs" | "obs" | "cameras" | "operators"
export type LiveToolsTab = "bible" | "listening" | "production" | "controls"

/** The production tools, in order; Live's tools dock lists them in its one row of tabs. */
export const PRODUCTION_TABS: ReadonlyArray<readonly [ProductionTab, string]> = [
  ["timekeeper", "Timekeeper"],
  ["screens", "Screens"],
  ["health", "Show health"],
  ["obs", "OBS"],
  ["cameras", "Cameras"],
  ["operators", "Operators"],
]

/**
 * Another page asking Production to open at a tab (the setup's "Join an existing church host" opens
 * Operators), and, for Scenes (id "programs"), at a scene (Design → Templates' "Customize a copy").
 */
export const useProductionTab = create<{
  requested: ProductionTab | null
  selected: ProductionTab
  scene: string | null
  open: boolean
  liveToolsTab: LiveToolsTab
  liveOutputId: string | null
  /**
   * Which Live tools tabs take the tall panel under Program instead of the strip (#812 F1). The
   * panel grows into the Preview/Program row and never covers Program or Take/Clear, which shrink
   * but stay in view. The operator's choice per tab is kept for this session.
   */
  expanded: Partial<Record<LiveToolsTab, boolean>>
  /** Live tools was opened by a link (openProductionTab), so it starts as the strip. */
  linked: boolean
}>(() => ({ requested: null, selected: "timekeeper", scene: null, open: false, liveToolsTab: "bible", liveOutputId: null, expanded: {}, linked: false }))

/**
 * Whether this Live tools tab is the tall panel (#812 F1). The operator's own choice wins. Without
 * one, Production tools start tall only while nothing is live and it was not opened from a link;
 * on air, the strip keeps Preview and Program at full size.
 */
export function liveToolsExpanded(
  state: { expanded: Partial<Record<LiveToolsTab, boolean>>; linked: boolean },
  tab: LiveToolsTab,
  isLive: boolean,
): boolean {
  return state.expanded[tab] ?? (tab === "production" && !isLive && !state.linked)
}

/** Expand this Live tools tab to the full-height sheet, or restore it to the strip under Program. */
export function setLiveToolsExpanded(tab: LiveToolsTab, value: boolean): void {
  useProductionTab.setState((s) => ({ expanded: { ...s.expanded, [tab]: value } }))
}

export function openProductionTab(tab: ProductionTab, opts: { sceneId?: string } = {}): void {
  // Scenes ("programs") are arranged in Design → Scenes now (UX audit slice 4); old links land there, at the scene.
  if (tab === "programs") {
    useProductionTab.setState({ requested: null, scene: opts.sceneId ?? null })
    useShellStore.getState().setDesignTab("scenes")
    useShellStore.getState().goTo("design")
    return
  }
  useProductionTab.setState({ requested: tab, selected: tab, scene: opts.sceneId ?? null, open: true, liveToolsTab: "production", linked: true })
  useShellStore.getState().goTo("present")
}

// Closing Live tools forgets that a link opened it.
useProductionTab.subscribe((s, p) => {
  if (p.open && !s.open && s.linked) useProductionTab.setState({ linked: false })
})

// Leaving Live dismisses any contextual tool request. The selected tool remains available next time.
useShellStore.subscribe((s, p) => {
  const r = useProductionTab.getState()
  const wasLive = p.workspace === "present" || p.workspace === "production"
  const isLive = s.workspace === "present" || s.workspace === "production"
  if (!wasLive || isLive) return
  if (s.workspace !== "prepare") useShellStore.getState().clearPrepareDesignReturn()
  if (r.requested || r.scene || r.open) useProductionTab.setState({ requested: null, scene: null, open: false })
})
