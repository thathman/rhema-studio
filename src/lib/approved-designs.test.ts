import { describe, expect, it } from "vitest"
import { approvedDesignBlockers, captureApprovedDesigns } from "@/lib/approved-designs"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { newScene } from "@/lib/scenes"
import { sceneStep } from "@/lib/item-intent"
import { defaultNdiSettings, type BroadcastOutput, type QueueItem, type Scene } from "@/types"

const output = (patch: Partial<BroadcastOutput> = {}): BroadcastOutput => ({
  id: "main",
  name: "Sanctuary",
  type: "display",
  themeId: BUILTIN_THEMES[0].id,
  monitorIndex: 0,
  ndi: defaultNdiSettings(),
  ...patch,
})

describe("approved design blockers", () => {
  it("does not require output looks when the service has no scene references", () => {
    expect(approvedDesignBlockers(
      [],
      [],
      [],
      [output({ themeId: "removed-theme", themeFor: { bible: "also-removed" } })],
      [],
    )).toEqual([])
  })

  it("requires the output variants a referenced feed scene can show", () => {
    const scene: Scene = {
      id: "verse-scene",
      name: "Verse",
      background: "#000",
      layers: [{ id: "feed", name: "Bible", kind: "feed", box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, visible: true }],
      createdAt: 0,
      updatedAt: 1,
    }
    const item = { scene_id: scene.id } as QueueItem

    expect(approvedDesignBlockers(
      [item],
      [scene],
      [BUILTIN_THEMES[0]],
      [output({ themeFor: { bible: "removed-bible-look" } })],
      [],
    )).toContain("Look removed-bible-look is not on this computer.")
  })

  it("pins every shared and per-output scene revision named by a service item", () => {
    const shared = newScene("Shared scene")
    const mainOverride = newScene("Sanctuary scene")
    const overflowOverride = newScene("Overflow scene")
    const planned = {
      on_take: [
        sceneStep(shared.id),
        sceneStep(mainOverride.id, "main"),
        sceneStep(overflowOverride.id, "overflow"),
      ],
    } as QueueItem

    const snapshot = captureApprovedDesigns(
      [planned],
      [shared, mainOverride, overflowOverride],
      [BUILTIN_THEMES[0]],
      [output(), output({ id: "overflow", name: "Overflow" })],
      null,
    )

    expect(Object.keys(snapshot.scenes).sort()).toEqual([shared.id, mainOverride.id, overflowOverride.id].sort())
    expect(snapshot.scenes[shared.id].scene.updatedAt).toBe(shared.updatedAt)
    expect(snapshot.scenes[mainOverride.id].scene.updatedAt).toBe(mainOverride.updatedAt)
    expect(snapshot.scenes[overflowOverride.id].scene.updatedAt).toBe(overflowOverride.updatedAt)
  })

  it("blocks approval when any per-output override scene is missing", () => {
    const planned = {
      on_take: [sceneStep("missing-shared"), sceneStep("missing-screen-scene", "overflow")],
    } as QueueItem

    expect(approvedDesignBlockers([planned], [], [], [output()], [])).toEqual([
      "Scene missing-shared is not on this computer.",
      "Scene missing-screen-scene is not on this computer.",
    ])
  })
})
