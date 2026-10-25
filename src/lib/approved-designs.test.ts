import { describe, expect, it } from "vitest"
import { approvedDesignBlockers } from "@/lib/approved-designs"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
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
})
