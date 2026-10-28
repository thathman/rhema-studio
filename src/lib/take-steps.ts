import { toast } from "sonner"
import { takeSteps, type ParsedTakeStep } from "@/lib/item-intent"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useObsStore } from "@/stores/obs-store"
import { useSettingsStore } from "@/stores/settings-store"
import type { BroadcastOutput, QueueItem } from "@/types"
import { useServiceStore } from "@/stores/service-store"

export { takesSourceOnly } from "@/lib/item-intent"

/**
 * Steps armed on a rundown item for the operator's own Take of it (#243 RS.4, OB.2). Prepare arms
 * them; they run once when the operator (or a joined desk) takes the item on air, after its content
 * is up. A timed move, a phase that runs by itself, the next slide of the same song, a Restore or a
 * return from a quick screen runs none. None of them puts anything live by itself: a scene changes
 * how a screen is arranged, OBS gets a scene, and "Bible feeds only" makes the Take itself smaller.
 */

const isCongregation = (o: BroadcastOutput) => (o.role ?? "congregation") === "congregation"

/**
 * Run an item's scene and OBS steps for the operator's own Take ("Bible feeds only" has already
 * shaped the Take). In rehearsal a scene Take is practice, as in Present's Scenes; OBS is never
 * changed (the OBS store refuses and says so). A step that cannot run says why; the rest still run.
 */
export async function runTakeSteps(item: QueueItem): Promise<void> {
  for (const step of takeSteps(item)) {
    try {
      if (step.kind === "scene") takeItemScene(step)
      else if (step.kind === "obs") await switchObs(step.scene, item.reference)
    } catch (e) {
      console.warn(`[take-steps] ${step.kind} for ${item.reference} failed:`, e)
    }
  }
}

function takeItemScene(step: Extract<ParsedTakeStep, { kind: "scene" }>): void {
  const b = useBroadcastStore.getState()
  const service = useServiceStore.getState()
  const approvedRevision = service.current?.approved_revision
  const hasApprovedRevision = approvedRevision !== null && approvedRevision !== undefined
  const manifest = hasApprovedRevision && service.approvedDesignRevision === approvedRevision
    ? service.approvedDesigns
    : null
  if (hasApprovedRevision && !manifest) {
    toast.warning("Approved scene not taken", {
      description: service.approvedDesignsError ?? "The approved scene snapshot is unavailable. Reload the service or refresh its approval before taking this item.",
    })
    return
  }
  const approved = manifest?.scenes[step.sceneId]
  if (hasApprovedRevision && !approved) {
    toast.warning("Approved scene not taken", {
      description: "This scene is not pinned in the approved service revision. Refresh the approval before taking this item.",
    })
    return
  }
  const scene = approved?.scene ?? b.scenes.find((s) => s.id === step.sceneId)
  if (!scene) {
    toast.warning("Scene not taken", { description: "This item's scene is not on this computer. Choose another in Prepare." })
    return
  }
  const targets = b.outputs.filter((o) => isCongregation(o) && (!step.outputId || o.id === step.outputId))
  if (targets.length === 0) {
    toast.warning(`${scene.name} not taken`, { description: "The screen this item names is not here, or is not a congregation screen." })
    return
  }
  for (const o of targets) {
    const appearance = approved && service.current
      ? approved.outputs[o.id] ?? null
      : null
    if (approved && !appearance) {
      toast.warning("Scene not taken", { description: `${o.name} was not captured at approval. Refresh the service approval before taking its approved scene here.` })
      continue
    }
    const alreadyShowing = o.sceneId === scene.id && o.sceneSnapshot?.updatedAt === scene.updatedAt
    const takenApproval = o.sceneAppearanceSnapshot?.approved
    const alreadyApproved = !!appearance && takenApproval?.appearanceComplete !== false && takenApproval?.programId === service.current?.id && takenApproval?.revision === service.current?.approved_revision
    if (alreadyShowing && (!appearance || alreadyApproved)) continue
    if (appearance && service.current?.approved_revision !== null && service.current?.approved_revision !== undefined) {
      b.takeSceneRevision(o.id, scene, appearance, service.current.id, service.current.approved_revision, undefined, !!approved?.outputs[o.id], { approvedAt: service.current.approved_at, approvedBy: service.current.approved_by })
    } else {
      b.takeScene(o.id, scene.id)
    }
  }
}

async function switchObs(scene: string, reference: string): Promise<void> {
  // Not using OBS at all: nothing to say at every Take.
  if (!useSettingsStore.getState().obs.enabled) return
  const obs = useObsStore.getState()
  if (obs.status !== "connected") {
    toast.info("OBS not switched", { description: `${reference} wants OBS on ${scene}, but OBS is not connected.` })
    return
  }
  if (!obs.scenes.includes(scene)) {
    toast.warning("OBS not switched", { description: `OBS has no scene called ${scene}.` })
    return
  }
  // Both refuse in rehearsal (OBS is the live stream) and say so.
  if (obs.studioMode) await obs.setPreview(scene)
  else if (obs.studioMode === false && obs.program !== scene) await obs.switchProgram(scene)
}
