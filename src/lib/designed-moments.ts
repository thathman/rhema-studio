import { toast } from "sonner"
import { designStore } from "@/design-engine/design-store"
import { resolveDesignedMoment } from "@/design-engine/rhema-scene"
import { captureSceneAppearance, normalizeScene } from "@/lib/scenes"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import { isSlideItem, type BroadcastOutput, type DesignedMomentRestore, type QueueItem, type Scene } from "@/types"

/**
 * A designed moment on Live (C2, docs/contracts/design-documents-v1.md, Pinning): when the operator
 * takes a slide that pins a design version, each congregation screen shows that version's scene
 * while it is up, and gets back what it showed before when the next item is taken. Only the pinned
 * version is ever drawn; when it cannot be (missing after a partial restore, unreadable), the slide
 * shows its own title and body as before and the operator is told why. Nothing is saved to the
 * scene library and no approval changes: the screen holds a snapshot, like a Restore.
 */

const isCongregation = (o: BroadcastOutput) => (o.role ?? "congregation") === "congregation"

type GetVersion = Parameters<typeof resolveDesignedMoment>[1]

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
  const { scene: resolved, issues } = await resolveDesignedMoment(item.slide, getVersion)
  if (!isTargetCurrent()) return
  if (!resolved) {
    restoreAfterDesignedMoment()
    toast.warning("Design not shown", { description: issues[0]?.message ?? `"${item.slide.title}" shows its text instead.` })
    return
  }
  // One id per pinned version, so a screen still showing it is recognised at restore.
  const scene: Scene = { ...resolved, id: `design-${ref.id}-v${ref.version}`, name: resolved.name?.trim() ? resolved.name : item.slide.title || "Design", design: ref }
  const b = useBroadcastStore.getState()
  const logo = useSettingsStore.getState().brandKit.logoUrl
  // ponytail: every congregation screen, like a scene step with no screen named; a per-moment target when Prepare offers one.
  for (const o of b.outputs.filter(isCongregation)) {
    // A manual Take can happen while the pinned design is loading. Keep that newer per-output choice.
    if (!takeRevisions.has(o.id) || (b.sceneTakes[o.id]?.revision ?? null) !== takeRevisions.get(o.id)) continue
    const earlier = o.designedMomentRestore
    const restore: DesignedMomentRestore = earlier && o.sceneId === earlier.designSceneId
      ? { ...earlier, designSceneId: scene.id }
      : {
          designSceneId: scene.id,
          scene: o.sceneId ? (o.sceneSnapshot ?? b.scenes.find((s) => s.id === o.sceneId) ?? null) : null,
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
    if (!before) continue
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
