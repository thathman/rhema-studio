import { toast } from "sonner"
import { designStore } from "@/design-engine/design-store"
import { resolveDesignedMoment } from "@/design-engine/rhema-scene"
import { captureSceneAppearance } from "@/lib/scenes"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import { isSlideItem, type BroadcastOutput, type QueueItem, type Scene } from "@/types"

/**
 * A designed moment on Live (C2, docs/contracts/design-documents-v1.md, Pinning): when the operator
 * takes a slide that pins a design version, each congregation screen shows that version's scene
 * while it is up, and gets back what it showed before when the next item is taken. Only the pinned
 * version is ever drawn; when it cannot be (missing after a partial restore, unreadable), the slide
 * shows its own title and body as before and the operator is told why. Nothing is saved to the
 * scene library and no approval changes: the screen holds a snapshot, like a Restore.
 */

const isCongregation = (o: BroadcastOutput) => (o.role ?? "congregation") === "congregation"

/** What a screen showed before a designed moment replaced it, by output id. */
interface Before { designedId: string; scene: Scene | null; appearance: BroadcastOutput["sceneAppearanceSnapshot"]; themeId: string; themeFor: BroadcastOutput["themeFor"] }
const replaced = new Map<string, Before>()

type GetVersion = Parameters<typeof resolveDesignedMoment>[1]

/** Run on the operator's own Take of `item` (after its content is up). */
export async function showDesignedMoment(item: QueueItem, getVersion: GetVersion = designStore.getVersion): Promise<void> {
  if (!isSlideItem(item) || !item.slide.designRef) return restoreAfterDesignedMoment()
  const ref = item.slide.designRef
  const { scene: resolved, issues } = await resolveDesignedMoment(item.slide, getVersion)
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
    const earlier = replaced.get(o.id)
    if (!earlier || o.sceneId !== earlier.designedId) {
      replaced.set(o.id, { designedId: scene.id, scene: o.sceneId ? (o.sceneSnapshot ?? b.scenes.find((s) => s.id === o.sceneId) ?? null) : null, appearance: o.sceneAppearanceSnapshot, themeId: o.themeId, themeFor: o.themeFor })
    } else {
      replaced.set(o.id, { ...earlier, designedId: scene.id })
    }
    b.restoreSceneSnapshot(o.id, scene, captureSceneAppearance(scene, o, b.themes, logo), { themeId: o.themeId, themeFor: o.themeFor })
  }
}

/**
 * Give each screen back what it showed before the designed moment, unless someone has changed it
 * since (a scene Take, the end of a rehearsal): their choice stays.
 */
export function restoreAfterDesignedMoment(): void {
  const b = useBroadcastStore.getState()
  for (const [outputId, before] of replaced) {
    const o = b.outputs.find((x) => x.id === outputId)
    if (o?.sceneId === before.designedId) {
      if (before.scene) {
        const appearance = before.appearance ?? captureSceneAppearance(before.scene, o, b.themes, useSettingsStore.getState().brandKit.logoUrl)
        b.restoreSceneSnapshot(outputId, before.scene, appearance, { themeId: before.themeId, themeFor: before.themeFor })
      } else {
        b.releaseScene(outputId)
      }
    }
  }
  replaced.clear()
}
