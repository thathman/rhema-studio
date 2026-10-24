import { useApprovalGateStore } from "@/stores/approval-gate-store"
import { resetTimerLogged } from "@/lib/timer-reset"
import { isRunning } from "@/lib/timer"
import { leaveRehearsal } from "@/stores/approval-gate-store"
import { presentActions } from "@/studio/present-actions"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useTimerStore } from "@/stores/timer-store"
import { lowerThirdBacking } from "@/lib/lower-third-backing"
import { useSettingsStore, type CustomMacro } from "@/stores/settings-store"
import { cleanTakeSteps, parseTakeStep } from "@/lib/item-intent"
import type { TakeStep } from "@/types"

/**
 * What a cue step touches (ADR 0001, #246 C04), so a cue can say what it will do before it runs.
 * program: what the main screens show; screen: a quick screen over it; override: Black or Logo
 * over every screen and feed; timer, stage, ticker; rehearsal: leaving it. An item's Take steps
 * (take-steps.ts): scene, a screen's arrangement; obs, OBS's scenes; source, the Bible feeds alone.
 */
export type CueScope = "program" | "screen" | "override" | "timer" | "stage" | "ticker" | "rehearsal" | "scene" | "obs" | "source"

const IMPACT: Record<CueScope, string> = {
  rehearsal: "Leaves rehearsal: the real program comes back",
  program: "Changes what the main screens show",
  screen: "Puts a screen over what the main screens show",
  override: "Covers every screen and feed",
  timer: "Changes the service timer",
  stage: "Changes the stage message",
  ticker: "Starts or stops the ticker",
  scene: "Arranges a congregation screen as a scene: what is live stays live",
  obs: "Changes OBS's preview or program (never in rehearsal)",
  source: "Sends the reading to the Bible feeds only: the main screens keep what they show",
}

/**
 * Every operator verb, named once, so macros, the keyboard, remotes and any
 * future cue list all run the same code. Each action is safe to repeat.
 */
export const CUE_ACTIONS = {
  next: { scope: "program", label: "Next", run: () => presentActions.next() },
  prev: { scope: "program", label: "Previous", run: () => presentActions.prev() },
  showLive: { scope: "program", label: "Take live", run: () => presentActions.showLive() },
  clear: { scope: "program", label: "Clear", run: () => presentActions.clear() },
  restore: { scope: "program", label: "Restore", run: () => presentActions.restore() },
  "quick.welcome": { scope: "screen", label: "Quick screen: Welcome", run: () => presentActions.quickScreen("welcome") },
  "quick.stand": { scope: "screen", label: "Quick screen: Please stand", run: () => presentActions.quickScreen("stand") },
  "quick.pray": { scope: "screen", label: "Quick screen: Let us pray", run: () => presentActions.quickScreen("pray") },
  "quick.offering": { scope: "screen", label: "Quick screen: Offering", run: () => presentActions.quickScreen("offering") },
  "quick.technical": { scope: "screen", label: "Quick screen: Technical issue", run: () => presentActions.quickScreen("technical") },
  "quick.logo": { scope: "override", label: "Quick screen: Logo", run: () => presentActions.quickScreen("logo") },
  "quick.black": { scope: "override", label: "Quick screen: Black", run: () => presentActions.quickScreen("black") },
  "quick.back": { scope: "screen", label: "Back from quick screen", run: () => presentActions.back() },
  "timer.start": { scope: "timer", label: "Start the timer", run: () => useTimerStore.getState().start() },
  "timer.pause": { scope: "timer", label: "Pause the timer", run: () => useTimerStore.getState().pause() },
  "timer.reset": { scope: "timer", label: "Reset the timer", run: () => resetTimerLogged() },
  // "Start the service" twice must not wipe the timer of a service already running.
  "timer.fresh": { scope: "timer", label: "Start the timer from zero (unless it is running)", run: () => {
    if (isRunning(useTimerStore.getState().timer)) return
    resetTimerLogged()
    useTimerStore.getState().start()
  } },
  "stage.clearMessage": { scope: "stage", label: "Clear the stage message", run: () => useBroadcastStore.getState().setStageMessage("") },
  "rehearsal.off": { scope: "rehearsal", label: "Rehearsal off", run: () => leaveRehearsal() },
  // Issue #187: a running ticker is left alone, so a repeated command does not restart the crawl.
  "ticker.take": { scope: "ticker", label: "Take the ticker live (unless it is running)", run: async () => {
    const s = useBroadcastStore.getState()
    if (s.ticker) return
    const backing = await lowerThirdBacking(s.tickerStyle)
    if (!useBroadcastStore.getState().ticker) useBroadcastStore.getState().setTicker({ backing })
  } },
  "ticker.stop": { scope: "ticker", label: "Stop the ticker", run: () => useBroadcastStore.getState().setTicker(null) },
} as const satisfies Record<string, { scope: CueScope; label: string; run: () => unknown }>

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

/** What a cue will touch, one line per kind of effect, in the order its steps first touch it. */
export function cueImpact(steps: readonly CueId[]): string[] {
  const seen: CueScope[] = []
  for (const id of steps) {
    const scope = CUE_ACTIONS[id]?.scope
    if (scope && !seen.includes(scope)) seen.push(scope)
  }
  return seen.map((s) => IMPACT[s])
}

const TAKE_SCOPE = { scene: "scene", obs: "obs", source: "source" } as const satisfies Record<string, CueScope>

/** What an item's Take steps will touch, one line per kind, in the order they run. */
export function takeImpact(steps: readonly TakeStep[] | null | undefined): string[] {
  return cleanTakeSteps(steps).map((s) => IMPACT[TAKE_SCOPE[parseTakeStep(s)!.kind]])
}
