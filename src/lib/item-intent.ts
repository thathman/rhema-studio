import { isVerseItem, type BroadcastOutput, type QueueItem, type Scene, type TakeStep } from "@/types"

/**
 * How a rundown item is meant to look (#299 6.6, #243 RS.3) and the steps armed for the operator's
 * own Take of it (#243 RS.4, OB.2), as saved in the item's payload: `scene_id`, `look_id`, `camera`
 * and `on_take`. Plain data only, so service files and the church folder carry them; an older
 * build keeps them untouched (FR-03), and a newer step this build does not know is dropped.
 */
export type ParsedTakeStep =
  | { kind: "scene"; sceneId: string; outputId: string | null }
  | { kind: "obs"; scene: string }
  | { kind: "source" }

const ID = /^[A-Za-z0-9_-]{1,80}$/
const MAX_STEP = 200
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/** "Take this scene": every congregation screen, or one (by output id). */
export const sceneStep = (sceneId: string, outputId?: string | null): TakeStep => `scene.take:${sceneId}${outputId ? `@${outputId}` : ""}`
/** "Switch OBS to this scene" (OBS's own name for it). */
export const obsStep = (scene: string): TakeStep => `obs.scene:${scene}`

export function parseTakeStep(step: string): ParsedTakeStep | null {
  if (step === "source.only") return { kind: "source" }
  if (step.startsWith("scene.take:")) {
    const [sceneId, outputId, ...more] = step.slice("scene.take:".length).split("@")
    if (more.length || !ID.test(sceneId) || (outputId !== undefined && !ID.test(outputId))) return null
    return { kind: "scene", sceneId, outputId: outputId ?? null }
  }
  if (step.startsWith("obs.scene:")) {
    const scene = step.slice("obs.scene:".length)
    return scene.trim() ? { kind: "obs", scene } : null
  }
  return null
}

/**
 * Steps worth saving: one source action, one shared scene, one scene per output, and one OBS action.
 * The first action for each target wins. The shared scene always runs before output overrides.
 * Anything malformed or unknown is dropped, as unknown macro steps are.
 */
export function cleanTakeSteps(raw: unknown): TakeStep[] {
  if (!Array.isArray(raw)) return []
  const scenes = new Map<string | null, TakeStep>()
  let source: TakeStep | undefined
  let obs: TakeStep | undefined
  for (const s of raw) {
    if (typeof s !== "string" || s.length > MAX_STEP || CONTROL.test(s)) continue
    const p = parseTakeStep(s)
    if (!p) continue
    if (p.kind === "scene") {
      if (!scenes.has(p.outputId)) scenes.set(p.outputId, s as TakeStep)
    } else if (p.kind === "source" && !source) {
      source = s as TakeStep
    } else if (p.kind === "obs" && !obs) {
      obs = s as TakeStep
    }
  }
  const targeted = [...scenes].filter(([outputId]) => outputId !== null).map(([, step]) => step)
  return [
    ...(source ? [source] : []),
    ...(scenes.has(null) ? [scenes.get(null)!] : []),
    ...targeted,
    ...(obs ? [obs] : []),
  ]
}

/** The item's steps, parsed and cleaned. */
export function takeSteps(item: Pick<QueueItem, "on_take">): ParsedTakeStep[] {
  return cleanTakeSteps(item.on_take).map((s) => parseTakeStep(s)!)
}

/** A Bible reading armed to go to the Bible feeds only: its Take leaves the main screens alone. */
export function takesSourceOnly(item: QueueItem): boolean {
  return isVerseItem(item) && takeSteps(item).some((s) => s.kind === "source")
}

/** What a step will do, in words, for the editor, the rundown and Preview. */
export function takeStepLabel(step: ParsedTakeStep, ctx: { scenes: readonly Pick<Scene, "id" | "name">[]; outputs: readonly Pick<BroadcastOutput, "id" | "name">[] }): string {
  if (step.kind === "source") return "Bible feeds only: the main screens keep what they show"
  if (step.kind === "obs") return `OBS switches to ${step.scene} (in Studio Mode it waits in OBS's preview)`
  const scene = ctx.scenes.find((s) => s.id === step.sceneId)?.name ?? "a scene not on this computer"
  const output = step.outputId ? ctx.outputs.find((o) => o.id === step.outputId)?.name ?? "a screen not on this computer" : "every congregation screen"
  return `Takes the scene ${scene} on ${output}`
}

/** A scene, look or camera id as saved: one short line, or nothing. */
export function cleanIntentId(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const id = raw.trim()
  return id && id.length <= 80 && !CONTROL.test(id) ? id : null
}

export type ItemIntent = Pick<QueueItem, "scene_id" | "look_id" | "camera" | "on_take">

/** The intent fields of an item's payload, only those set. */
export function intentPayload(i: ItemIntent): { scene_id?: string; look_id?: string; camera?: string; on_take?: TakeStep[] } {
  const scene = cleanIntentId(i.scene_id)
  const look = cleanIntentId(i.look_id)
  const camera = cleanIntentId(i.camera)
  const steps = cleanTakeSteps(i.on_take)
  return { ...(scene ? { scene_id: scene } : {}), ...(look ? { look_id: look } : {}), ...(camera ? { camera } : {}), ...(steps.length ? { on_take: steps } : {}) }
}

/** The intent fields from a saved payload (JSON text), only those set and well-formed. */
export function parseItemIntent(raw: string | null | undefined): ReturnType<typeof intentPayload> {
  if (!raw) return {}
  try {
    const p = JSON.parse(raw) as Record<string, unknown> | null
    return p && typeof p === "object" && !Array.isArray(p) ? intentPayload(p as ItemIntent) : {}
  } catch {
    return {}
  }
}

/** The id of the one with this name (any case, spaces trimmed), or null: for an AI draft's suggestions. */
export function idByName(name: string | null | undefined, list: readonly { id: string; name: string }[]): string | null {
  const want = name?.trim().toLowerCase()
  if (!want) return null
  return list.find((x) => x.name.trim().toLowerCase() === want)?.id ?? null
}

export interface PlanContext {
  scenes: readonly Pick<Scene, "id" | "name">[]
  looks: readonly { id: string; name: string }[]
  cameras: readonly { name: string; label: string }[]
  outputs: readonly Pick<BroadcastOutput, "id" | "name">[]
}

/**
 * The item's plan in words, for Preview and the rundown: its scene, look and camera, then what its
 * Take also does. Empty when it has none. One that is not on this computer says so.
 */
export function planLines(item: QueueItem, ctx: PlanContext): string[] {
  const missing = "not on this computer"
  const scene = cleanIntentId(item.scene_id)
  const look = cleanIntentId(item.look_id)
  const camera = cleanIntentId(item.camera)
  return [
    scene ? `Scene: ${ctx.scenes.find((s) => s.id === scene)?.name ?? missing}` : null,
    look ? `Look: ${ctx.looks.find((l) => l.id === look)?.name ?? missing}` : null,
    camera ? `Camera: ${ctx.cameras.find((c) => c.name === camera)?.label ?? missing}` : null,
    ...takeSteps(item).map((s) => `On Take: ${takeStepLabel(s, ctx)}`),
  ].filter((l): l is string => l !== null)
}
