import { create } from "zustand"
import { useShellStore } from "@/studio/shell-store"

export type ProductionTab = "timekeeper" | "screens" | "health" | "programs" | "obs" | "cameras" | "operators"

/** Another page asking Production to open at a tab (the setup's "Join an existing church host" opens Operators). */
export const useProductionTab = create<{ requested: ProductionTab | null }>(() => ({ requested: null }))

export function openProductionTab(tab: ProductionTab): void {
  useProductionTab.setState({ requested: tab })
  useShellStore.getState().goTo("production")
}

// Leaving Production forgets the request, so the next visit opens as usual.
useShellStore.subscribe((s, p) => {
  if (p.workspace === "production" && s.workspace !== "production" && useProductionTab.getState().requested) useProductionTab.setState({ requested: null })
})
