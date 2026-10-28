import { create } from "zustand"
import { load } from "@tauri-apps/plugin-store"
import { useSettingsStore } from "./settings-store"

interface TutorialState {
  isRunning: boolean
  startTutorial: () => void
  stopTutorial: () => void
}

export const useTutorialStore = create<TutorialState>((set) => ({
  isRunning: false,
  startTutorial: () => set({ isRunning: true }),
  stopTutorial: () => set({ isRunning: false }),
}))

const operatorPart = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

/** Load onboardingComplete from disk into settings store. */
export async function hydrateOnboardingState(): Promise<void> {
  try {
    const store = await load("settings.json", { autoSave: false, defaults: {} })
    // In the operator part of the file (#298 M11); a file from before the parts has it at the top.
    const operator = operatorPart(await store.get("operator"))
    const completed = operator && "onboardingComplete" in operator ? operator.onboardingComplete : await store.get<boolean>("onboardingComplete")
    if (completed === true) {
      useSettingsStore.getState().setOnboardingComplete(true)
    }
  } catch {
    console.warn("[tutorial] Failed to load persisted state, using defaults")
  }
}

/** Write onboardingComplete=true to both Zustand and disk. */
export async function persistOnboardingComplete(): Promise<void> {
  useSettingsStore.getState().setOnboardingComplete(true)
  try {
    const store = await load("settings.json", { autoSave: false, defaults: {} })
    const operator = operatorPart(await store.get("operator"))
    if (operator) await store.set("operator", { ...operator, onboardingComplete: true })
    else await store.set("onboardingComplete", true)
    await store.save()
  } catch {
    console.warn("[tutorial] Failed to persist onboarding state")
  }
}
