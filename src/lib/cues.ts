import { useApprovalGateStore } from "@/stores/approval-gate-store"
import { resetTimerLogged } from "@/lib/timer-reset"
import { isRunning } from "@/lib/timer"
import { leaveRehearsal } from "@/stores/approval-gate-store"
import { presentActions } from "@/studio/present-actions"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useTimerStore } from "@/stores/timer-store"
import { useSettingsStore, type CustomMacro } from "@/stores/settings-store"

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
  "quick.technical": { label: "Quick screen: Technical issue", run: () => presentActions.quickScreen("technical") },
  "quick.logo": { label: "Quick screen: Logo", run: () => presentActions.quickScreen("logo") },
  "quick.black": { label: "Quick screen: Black", run: () => presentActions.quickScreen("black") },
  "quick.back": { label: "Back from quick screen", run: () => presentActions.back() },
  "timer.start": { label: "Start the timer", run: () => useTimerStore.getState().start() },
  "timer.pause": { label: "Pause the timer", run: () => useTimerStore.getState().pause() },
  "timer.reset": { label: "Reset the timer", run: () => resetTimerLogged() },
  // "Start the service" twice must not wipe the timer of a service already running.
  "timer.fresh": { label: "Start the timer from zero (unless it is running)", run: () => {
    if (isRunning(useTimerStore.getState().timer)) return
    resetTimerLogged()
    useTimerStore.getState().start()
  } },
  "stage.clearMessage": { label: "Clear the stage message", run: () => useBroadcastStore.getState().setStageMessage("") },
  "rehearsal.off": { label: "Rehearsal off", run: () => leaveRehearsal() },
} as const satisfies Record<string, { label: string; run: () => unknown }>

export type CueId = keyof typeof CUE_ACTIONS

export interface Macro {
  id: string
  label: string
  description: string
  steps: CueId[]
}

/** Built-in macros. Steps run in order; each is an ordinary action, so a macro is just a shortcut. */
export const MACROS: Macro[] = [
  { id: "service-start", label: "Start the service", description: "Welcome on screen, timer running from zero (left alone if already running), rehearsal off.", steps: ["rehearsal.off", "timer.fresh", "quick.welcome"] },
  { id: "offering", label: "Offering", description: "Offering screen; Back returns to what was live.", steps: ["quick.offering"] },
  { id: "prayer", label: "Prayer", description: "Let us pray; Back returns to what was live.", steps: ["quick.pray"] },
  { id: "service-end", label: "End the service", description: "Clear the screen, pause the timer, clear any stage message.", steps: ["clear", "timer.pause", "stage.clearMessage"] },
]

const isCueId = (s: string): s is CueId => Object.prototype.hasOwnProperty.call(CUE_ACTIONS, s)

/** A church-defined macro as a runnable one; steps this build does not know are dropped. */
export function toMacro(m: CustomMacro): Macro {
  return { id: m.id, label: m.label, description: "Your cue", steps: m.steps.filter(isCueId) }
}

/** Built-in macros, then the church's own (PT-003). */
export function allMacros(custom: CustomMacro[] = useSettingsStore.getState().customMacros): Macro[] {
  return [...MACROS, ...custom.map(toMacro)]
}

export const findMacro = (id: string): Macro | undefined => allMacros().find((m) => m.id === id)

/**
 * A readable id for a new cue (what a Stream Deck or OSC sends: `/rhema/macro baptism`):
 * the name in lowercase letters, digits and dashes, unique among all macros.
 */
export function macroIdFor(label: string, taken: string[]): string {
  const base = label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "cue"
  let id = base
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`
  return id
}

/**
 * Run steps in order, each finishing before the next starts (a Next still
 * loading must not be cancelled by the following Clear or quick screen). A
 * failing step does not stop the rest; a go-live held for approval stops
 * the cue, since the operator is being asked.
 */
export async function runSteps(steps: CueId[]): Promise<CueId[]> {
  for (const step of steps) {
    const askingBefore = useApprovalGateStore.getState().held
    try {
      await CUE_ACTIONS[step].run()
    } catch (e) {
      console.warn(`[cues] step ${step} failed:`, e)
    }
    // Stop only when this step raised the question (one already open does not cut the cue short).
    const asking = useApprovalGateStore.getState().held
    if (asking && asking !== askingBefore) break
  }
  return steps
}

/** Run a macro by id (built-ins win over a custom cue with the same id). Unknown ids do nothing. */
export function runMacro(id: string): Promise<CueId[]> {
  const macro = findMacro(id)
  return macro ? runSteps(macro.steps) : Promise.resolve([])
}
