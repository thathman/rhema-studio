import { presentActions } from "@/studio/present-actions"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useTimerStore } from "@/stores/timer-store"

/**
 * Every operator verb, named once, so macros, the keyboard, remotes and any
 * future cue list all run the same code. Each action is safe to repeat.
 */
export const CUE_ACTIONS = {
  next: { label: "Next", run: () => presentActions.next() },
  prev: { label: "Previous", run: () => presentActions.prev() },
  showLive: { label: "Show live", run: () => presentActions.showLive() },
  clear: { label: "Clear", run: () => presentActions.clear() },
  restore: { label: "Restore", run: () => presentActions.restore() },
  "quick.welcome": { label: "Quick screen: Welcome", run: () => presentActions.quickScreen("welcome") },
  "quick.stand": { label: "Quick screen: Please stand", run: () => presentActions.quickScreen("stand") },
  "quick.pray": { label: "Quick screen: Let us pray", run: () => presentActions.quickScreen("pray") },
  "quick.offering": { label: "Quick screen: Offering", run: () => presentActions.quickScreen("offering") },
  "quick.back": { label: "Back from quick screen", run: () => presentActions.back() },
  "timer.start": { label: "Start the timer", run: () => useTimerStore.getState().start() },
  "timer.pause": { label: "Pause the timer", run: () => useTimerStore.getState().pause() },
  "timer.reset": { label: "Reset the timer", run: () => useTimerStore.getState().reset() },
  "stage.clearMessage": { label: "Clear the stage message", run: () => useBroadcastStore.getState().setStageMessage("") },
  "rehearsal.off": { label: "Rehearsal off", run: () => useBroadcastStore.getState().setRehearsal(false) },
} as const satisfies Record<string, { label: string; run: () => void }>

export type CueId = keyof typeof CUE_ACTIONS

export interface Macro {
  id: string
  label: string
  description: string
  steps: CueId[]
}

/** Built-in macros. Steps run in order; each is an ordinary action, so a macro is just a shortcut. */
export const MACROS: Macro[] = [
  { id: "service-start", label: "Start the service", description: "Welcome on screen, timer running, rehearsal off.", steps: ["rehearsal.off", "timer.reset", "timer.start", "quick.welcome"] },
  { id: "offering", label: "Offering", description: "Offering screen; Back returns to what was live.", steps: ["quick.offering"] },
  { id: "prayer", label: "Prayer", description: "Let us pray; Back returns to what was live.", steps: ["quick.pray"] },
  { id: "service-end", label: "End the service", description: "Clear the screen, pause the timer, clear any stage message.", steps: ["clear", "timer.pause", "stage.clearMessage"] },
]

export const findMacro = (id: string): Macro | undefined => MACROS.find((m) => m.id === id)

/** Run a macro's steps in order. Unknown ids do nothing; a failing step does not stop the rest. */
export function runMacro(id: string): CueId[] {
  const macro = findMacro(id)
  if (!macro) return []
  for (const step of macro.steps) {
    try {
      CUE_ACTIONS[step].run()
    } catch (e) {
      console.warn(`[cues] step ${step} of ${id} failed:`, e)
    }
  }
  return macro.steps
}
