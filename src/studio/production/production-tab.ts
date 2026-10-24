import { create } from "zustand"
import { useShellStore } from "@/studio/shell-store"

export type ProductionTab = "timekeeper" | "screens" | "health" | "programs" | "obs" | "cameras" | "operators"

/**
 * Another page asking Production to open at a tab (the setup's "Join an existing church host" opens
 * Operators), and, for Programs, at a scene (Design → Library's "Use and edit" on a camera scene).
 */
export const useProductionTab = create<{ requested: ProductionTab | null; scene: string | null }>(() => ({ requested: null, scene: null }))

export function openProductionTab(tab: ProductionTab, opts: { sceneId?: string } = {}): void {
  useProductionTab.setState({ requested: tab, scene: opts.sceneId ?? null })
  useShellStore.getState().goTo("production")
}

// Leaving Production forgets the request, so the next visit opens as usual.
useShellStore.subscribe((s, p) => {
  const r = useProductionTab.getState()
  if (p.workspace === "production" && s.workspace !== "production" && (r.requested || r.scene)) useProductionTab.setState({ requested: null, scene: null })
})
