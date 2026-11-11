import { create } from "zustand"
import { useShellStore } from "@/studio/shell-store"

export type ProductionTab = "timekeeper" | "screens" | "health" | "programs" | "obs" | "cameras" | "operators"
export type LiveToolsTab = "bible" | "listening" | "production" | "controls"

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
   * Which Live tools tabs fill the console as a full-height sheet instead of the strip under
   * Program (#812 F1). Production tools (Scenes, OBS, Cameras, Show health, Operators) are whole
   * workspaces, so they start expanded; Find & cue starts as the strip so Preview stays in view.
   * The operator's choice per tab is kept for this session.
   */
  expanded: Partial<Record<LiveToolsTab, boolean>>
}>(() => ({ requested: null, selected: "timekeeper", scene: null, open: false, liveToolsTab: "bible", liveOutputId: null, expanded: {} }))

/** Whether this Live tools tab shows as the full-height sheet (#812 F1). */
export function liveToolsExpanded(expanded: Partial<Record<LiveToolsTab, boolean>>, tab: LiveToolsTab): boolean {
  return expanded[tab] ?? tab === "production"
}

/** Expand this Live tools tab to the full-height sheet, or restore it to the strip under Program. */
export function setLiveToolsExpanded(tab: LiveToolsTab, value: boolean): void {
  useProductionTab.setState((s) => ({ expanded: { ...s.expanded, [tab]: value } }))
}

export function openProductionTab(tab: ProductionTab, opts: { sceneId?: string } = {}): void {
  useProductionTab.setState({ requested: tab, selected: tab, scene: opts.sceneId ?? null, open: true, liveToolsTab: "production" })
  useShellStore.getState().goTo("present")
}

// Leaving Live dismisses any contextual tool request. The selected tool remains available next time.
useShellStore.subscribe((s, p) => {
  const r = useProductionTab.getState()
  const wasLive = p.workspace === "present" || p.workspace === "production"
  const isLive = s.workspace === "present" || s.workspace === "production"
  if (!wasLive || isLive) return
  if (s.workspace !== "prepare") useShellStore.getState().clearPrepareDesignReturn()
  if (r.requested || r.scene || r.open) useProductionTab.setState({ requested: null, scene: null, open: false })
})
