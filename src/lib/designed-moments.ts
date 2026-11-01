import { toast } from "sonner"
import { designStore } from "@/design-engine/design-store"
import { resolveDesignedMoment } from "@/design-engine/rhema-scene"
import { captureSceneAppearance, normalizeScene } from "@/lib/scenes"
import { takesSourceOnly } from "@/lib/item-intent"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"
import { isSlideItem, type BroadcastOutput, type DesignedMomentRestore, type QueueItem, type Scene } from "@/types"
import type { DesignPin } from "@/types/scene"

/**
 * A designed moment on Live (C2, docs/contracts/design-documents-v1.md, Pinning): when the operator
 * takes a slide that pins a design version, each congregation screen shows that version's scene
 * while it is up, and gets back what it showed before when the next item is taken. Only the pinned
 * version is ever drawn; when it cannot be (missing after a partial restore, unreadable), the slide
 * shows its own title and body as before and the operator is told why. Nothing is saved to the
 * scene library and no approval changes: the screen holds a snapshot, like a Restore.
 *
 * Fails closed like an approved scene: once a service is approved, a moment shows only the version
 * its approval captured. A pin added or moved since shows the slide's text until approved again.
 */

const isCongregation = (o: BroadcastOutput) => (o.role ?? "congregation") === "congregation"

type GetVersion = Parameters<typeof resolveDesignedMoment>[1]

/** One id per pinned version, so a screen still showing it is recognised at restore. */
const momentSceneId = (ref: DesignPin) => `design-${ref.id}-v${ref.version}`

/** A moment's design on this screen, with or without a way back. */
const showsMoment = (o: BroadcastOutput) => !!o.sceneSnapshot?.design && o.sceneId === momentSceneId(o.sceneSnapshot.design)

/** Why the open service's approval does not cover this pin; null when it does, or nothing is approved. */
function designNotApproved(itemId: string, ref: DesignPin): string | null {
  const service = useServiceStore.getState()
  const revision = service.current?.approved_revision
  if (revision === null || revision === undefined) return null
  if (service.approvedDesignRevision !== revision || !service.approvedDesigns) return service.approvedDesignsError ?? "The approved design list is unavailable. Reload the service or refresh its approval."
  const approved = service.approvedDesigns.moments?.[itemId]
  if (approved && approved.id === ref.id && approved.version === ref.version) return null
  return approved
    ? `This slide pins design v${ref.version}, and v${approved.version} was approved. Refresh the service approval to show it; its text is showing instead.`
    : `This design was pinned after the service was approved. Refresh the service approval to show it; the slide's text is showing instead.`
}

/** Run on the operator's own Take of `item` (after its content is up). */
export async function showDesignedMoment(
  item: QueueItem,
  getVersion: GetVersion = designStore.getVersion,
  isTargetCurrent: () => boolean = () => true,
): Promise<void> {
  if (!isTargetCurrent()) return
  if (!isSlideItem(item) || !item.slide.designRef) return restoreAfterDesignedMoment()
  const ref = item.slide.designRef
  const before = useBroadcastStore.getState()
  const takeRevisions = new Map(before.outputs.map((output) => [output.id, before.sceneTakes[output.id]?.revision ?? null]))
  // A rehearsal Take records no revision, so its scene is compared as well.
  const sceneIds = new Map(before.outputs.map((output) => [output.id, output.sceneId]))
  const { scene: resolved, issues } = await resolveDesignedMoment(item.slide, getVersion)
  if (!isTargetCurrent()) return
  // Checked after the load, so an approval that changed meanwhile counts. Here, because every way to Program draws through this.
  const notApproved = designNotApproved(item.id, ref)
  if (notApproved) {
    restoreAfterDesignedMoment()
    toast.warning("Design needs approval", { id: `design-approval-${item.id}`, description: notApproved })
    return
  }
  if (!resolved) {
    restoreAfterDesignedMoment()
    toast.warning("Design not shown", { id: `design-missing-${item.id}`, description: issues[0]?.message ?? `"${item.slide.title}" shows its text instead.` })
    return
  }
  const scene: Scene = { ...resolved, id: momentSceneId(ref), name: resolved.name?.trim() ? resolved.name : item.slide.title || "Design", design: ref }
  const b = useBroadcastStore.getState()
  const logo = useSettingsStore.getState().brandKit.logoUrl
  // ponytail: every congregation screen, like a scene step with no screen named; a per-moment target when Prepare offers one.
  for (const o of b.outputs.filter(isCongregation)) {
    // A manual Take can happen while the pinned design is loading. Keep that newer per-output choice.
    if (!takeRevisions.has(o.id) || (b.sceneTakes[o.id]?.revision ?? null) !== takeRevisions.get(o.id) || o.sceneId !== sceneIds.get(o.id)) continue
    const earlier = o.designedMomentRestore
    const restore: DesignedMomentRestore = earlier && o.sceneId === earlier.designSceneId
      ? { ...earlier, designSceneId: scene.id, itemId: item.id }
      : {
          designSceneId: scene.id,
          itemId: item.id,
          // A moment with no way back (recovery put it up) is never what to return to: that would bring it back.
          scene: o.sceneId && !showsMoment(o) ? (o.sceneSnapshot ?? b.scenes.find((s) => s.id === o.sceneId) ?? null) : null,
          ...(o.sceneAppearanceSnapshot ? { appearance: o.sceneAppearanceSnapshot } : {}),
          themeId: o.themeId,
          ...(o.themeFor ? { themeFor: o.themeFor } : {}),
        }
    b.updateOutput(o.id, { designedMomentRestore: restore })
    b.restoreSceneSnapshot(o.id, scene, captureSceneAppearance(scene, o, b.themes, logo), { themeId: o.themeId, themeFor: o.themeFor })
  }
}

/**
 * Give each screen back what it showed before the designed moment, unless someone has changed it
 * since (a scene Take, the end of a rehearsal): their choice stays.
 */
export function restoreAfterDesignedMoment(): void {
  const b = useBroadcastStore.getState()
  for (const o of [...b.outputs]) {
    const before = o.designedMomentRestore
    if (!before) {
      // A moment's design with no way back (a recovery put it up after its way back was used):
      // there is nothing to return to, but it must not stay up unchecked.
      if (showsMoment(o)) {
        b.releaseScene(o.id)
        toast.warning("Scene not restored", { description: "The previous scene could not be recovered, so this screen was released to its normal feed." })
      }
      continue
    }
    if (o.sceneId === before.designSceneId) {
      const scene = before.scene ? normalizeScene(before.scene) : null
      if (scene) {
        const originalOutput = { ...o, themeId: before.themeId, themeFor: before.themeFor }
        const appearance = before.appearance ?? captureSceneAppearance(scene, originalOutput, b.themes, useSettingsStore.getState().brandKit.logoUrl)
        b.restoreSceneSnapshot(o.id, scene, appearance, { themeId: before.themeId, themeFor: before.themeFor })
      } else {
        b.releaseScene(o.id)
        if (before.scene) toast.warning("Scene not restored", { description: "The previous scene could not be recovered, so this screen was released to its normal feed." })
      }
    }
    b.updateOutput(o.id, { designedMomentRestore: undefined })
  }
}

/**
 * Make the screens match Program: on a pinned slide they show its checked design, off one they hold
 * no moment. Recovery calls this too, since it can change screens without moving Program.
 */
export function settleDesignedMoments(): void {
  const s = useBroadcastStore.getState()
  if (s.rehearsal) return
  const next = s.isLive && s.liveItemId ? useQueueStore.getState().items.find((item) => item.id === s.liveItemId) : undefined
  if (next && takesSourceOnly(next)) return
  if (next && isSlideItem(next) && next.slide.designRef) {
    // Already up, as this version and still approved (a Take arriving second, or a recovery putting
    // Program back): leave it. Anything else goes through the same check as a Take.
    const ref = next.slide.designRef
    const up = s.outputs.some((o) => o.designedMomentRestore?.itemId === next.id && o.designedMomentRestore.designSceneId === momentSceneId(ref) && o.sceneId === momentSceneId(ref))
    if (up && !designNotApproved(next.id, ref)) return
    void showDesignedMoment(next, undefined, () => {
      const now = useBroadcastStore.getState()
      return !now.rehearsal && now.isLive && now.liveItemId === next.id
    }).catch((e) => console.warn(`[designed-moments] design for ${next.reference} failed:`, e))
    return
  }
  if (s.outputs.some((o) => o.designedMomentRestore || showsMoment(o))) restoreAfterDesignedMoment()
}

/**
 * Program can move with no Take steps: Clear, a verse sent from elsewhere, a detected verse, a timed
 * move, Show this live. The screens follow it, or Live would claim what the design hides: onto a
 * pinned slide they show its design (for a Take this meets `runTakeSteps`, and whichever is second
 * finds it done), and off a moment they get their scene back. A Bible-feeds-only Take leaves the
 * screens alone. A restore saved by an older build names no item, so any move counts as leaving it.
 */
useBroadcastStore.subscribe((s, prev) => {
  if (s.rehearsal) return
  const before = prev.rehearsal ? prev.rehearsalReturn : prev
  if (before && s.isLive === before.isLive && s.liveItemId === before.liveItemId) return
  settleDesignedMoments()
})

/**
 * The approval can change with a moment already up: a refreshed approval, or the service's list
 * arriving after a recovery put the screens back. A moment it no longer covers comes down.
 */
useServiceStore.subscribe((s, prev) => {
  if (s.approvedDesigns === prev.approvedDesigns && s.approvedDesignRevision === prev.approvedDesignRevision && s.current?.approved_revision === prev.current?.approved_revision) return
  const b = useBroadcastStore.getState()
  if (b.rehearsal) return
  const items = useQueueStore.getState().items
  const approved = s.current?.approved_revision !== null && s.current?.approved_revision !== undefined
  // What counts is the design on the screen, not what the item pins now: v2 up with the item moved
  // to an approved v3 is still v2, unapproved. One whose item can't be found can't be shown to be covered.
  const uncovered = b.outputs.some((o) => {
    const restore = o.designedMomentRestore
    // No way back means recovery put it up unchecked: nothing shows it is covered.
    if (!restore) return showsMoment(o)
    if (o.sceneId !== restore.designSceneId) return false
    const item = restore.itemId ? items.find((i) => i.id === restore.itemId) : undefined
    if (!item) return approved
    if (!isSlideItem(item) || !item.slide.designRef) return true
    return o.sceneId !== momentSceneId(item.slide.designRef) || designNotApproved(item.id, item.slide.designRef) !== null
  })
  if (!uncovered) return
  restoreAfterDesignedMoment()
  toast.warning("Design needs approval", { description: "The service's approval no longer covers the design on screen, so the screens went back. Refresh the approval to show it." })
})
