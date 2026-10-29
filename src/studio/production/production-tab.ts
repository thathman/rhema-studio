import { create } from "zustand"
import { useShellStore } from "@/studio/shell-store"

export type ProductionTab = "timekeeper" | "screens" | "health" | "programs" | "obs" | "cameras" | "operators"
export type LiveToolsTab = "bible" | "listening" | "production"

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
}>(() => ({ requested: null, selected: "timekeeper", scene: null, open: false, liveToolsTab: "bible" }))

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
