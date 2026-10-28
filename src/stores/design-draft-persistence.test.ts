import { beforeEach, describe, expect, it, vi } from "vitest"

const localFile = vi.hoisted(() => ({ values: {} as Record<string, unknown>, saveCount: 0 }))

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: async (key: string) => localFile.values[key],
    set: async (key: string, value: unknown) => { localFile.values[key] = value },
    save: async () => { localFile.saveCount += 1 },
  })),
}))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), emit: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))

beforeEach(() => {
  vi.resetModules()
  localFile.values = {}
  localFile.saveCount = 0
})

describe("design draft persistence", () => {
  it("hydrates saved drafts from the local design store", async () => {
    const { DEFAULT_STAGE_STYLE } = await import("@/lib/stage-style")
    const draft = {
      id: "stage:default",
      kind: "stage" as const,
      sourceId: "default",
      value: { ...DEFAULT_STAGE_STYLE, background: "#123456" },
      updatedAt: 42,
    }
    localFile.values.designDrafts = [draft]
    const { hydrateBroadcastThemes, useBroadcastStore } = await import("./broadcast-store")

    await hydrateBroadcastThemes()

    expect(useBroadcastStore.getState().designDrafts).toEqual([draft])
  })

  it("writes a saved draft to the local design store without applying it", async () => {
    const { DEFAULT_STAGE_STYLE } = await import("@/lib/stage-style")
    const { flushThemeSave, hydrateBroadcastThemes, useBroadcastStore } = await import("./broadcast-store")
    await hydrateBroadcastThemes()
    const published = useBroadcastStore.getState().stageStyle
    const draft = {
      id: "stage:default",
      kind: "stage" as const,
      sourceId: "default",
      value: { ...DEFAULT_STAGE_STYLE, background: "#123456" },
      updatedAt: 43,
    }

    useBroadcastStore.getState().saveDesignDraft(draft)
    await flushThemeSave()

    expect(localFile.values.designDrafts).toEqual([draft])
    expect(useBroadcastStore.getState().stageStyle).toEqual(published)
    expect(localFile.saveCount).toBe(1)
  })
})
