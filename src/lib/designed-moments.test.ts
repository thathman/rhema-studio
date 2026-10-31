import { beforeEach, describe, expect, it, vi } from "vitest"
import type { QueueItem } from "@/types"

/**
 * A designed moment on Live (C2): the pinned version is shown on the congregation screens while it
 * is up, the screens get back what they showed after, and a missing or plain design falls back to
 * the slide's own text. Never another version.
 */
const toast = { error: vi.fn(), info: vi.fn(), warning: vi.fn(), success: vi.fn() }
vi.mock("sonner", () => ({ toast }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn().mockResolvedValue(undefined), listen: vi.fn(async () => () => {}) }))

const { showDesignedMoment, restoreAfterDesignedMoment } = await import("./designed-moments")
const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { newScene, normalizeScene } = await import("@/lib/scenes")
const { sceneToDesign } = await import("@/design-engine/rhema-scene")
const { MAIN_OUTPUT_ID, defaultNdiSettings } = await import("@/types")

const welcome = newScene("Welcome card")
const usual = newScene("Camera and Bible")
const versions = { "d1:2": { designId: "d1", version: 2, document: sceneToDesign(welcome) } } as Record<string, { designId: string; version: number; document: ReturnType<typeof sceneToDesign> }>
const getVersion = vi.fn(async (id: string, version: number) => versions[`${id}:${version}`] ?? null)
const moment = (designRef?: { id: string; version: number }): QueueItem =>
  ({ id: "m", kind: "slide", slide: { title: "Welcome", body: "Glad you came", ...(designRef ? { designRef } : {}) }, reference: "Welcome", confidence: 1, source: "manual", added_at: 0 }) as QueueItem
const plain: QueueItem = { id: "p", kind: "slide", slide: { title: "Notices", body: "" }, reference: "Notices", confidence: 1, source: "manual", added_at: 0 } as QueueItem
const out = (id: string) => useBroadcastStore.getState().outputs.find((o) => o.id === id)

beforeEach(() => {
  restoreAfterDesignedMoment()
  for (const f of Object.values(toast)) f.mockClear()
  const theme = useBroadcastStore.getState().themes[0].id
  useBroadcastStore.setState({
    rehearsal: false, rehearsalReturn: null, sceneReturn: {}, sceneTakes: {}, scenes: [usual],
    outputs: [
      { id: MAIN_OUTPUT_ID, name: "Sanctuary", type: "display", themeId: theme, monitorIndex: 0, ndi: defaultNdiSettings() },
      { id: "stage", name: "Stage", type: "display", role: "stage", themeId: theme, monitorIndex: 1, ndi: defaultNdiSettings() },
    ],
  })
  useBroadcastStore.getState().takeScene(MAIN_OUTPUT_ID, usual.id)
})

describe("a designed moment on Live", () => {
  it("shows the pinned version on congregation screens and gives them back after", async () => {
    await showDesignedMoment(moment({ id: "d1", version: 2 }), getVersion)
    expect(getVersion).toHaveBeenCalledWith("d1", 2)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v2")
    expect(out(MAIN_OUTPUT_ID)?.sceneSnapshot?.design).toEqual({ id: "d1", version: 2 })
    expect(out(MAIN_OUTPUT_ID)?.sceneSnapshot?.name).toBe("Welcome card")
    expect(out("stage")?.sceneId).toBeUndefined()
    expect(useBroadcastStore.getState().scenes.map((s) => s.id)).toEqual([usual.id])

    await showDesignedMoment(plain, getVersion)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
  })

  it("a screen that had no scene is released again", async () => {
    useBroadcastStore.getState().releaseScene(MAIN_OUTPUT_ID)
    await showDesignedMoment(moment({ id: "d1", version: 2 }), getVersion)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v2")
    restoreAfterDesignedMoment()
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBeUndefined()
  })

  it("a missing version shows the slide's own text, never another version, and says why", async () => {
    await showDesignedMoment(moment({ id: "d1", version: 3 }), getVersion)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
    expect(toast.warning).toHaveBeenCalledWith("Design not shown", { description: expect.stringContaining("version 3") })
  })

  it("a plain slide changes nothing", async () => {
    await showDesignedMoment(plain, getVersion)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it("an operator's own scene change during the moment is kept", async () => {
    await showDesignedMoment(moment({ id: "d1", version: 2 }), getVersion)
    const other = newScene("Announcements")
    useBroadcastStore.setState({ scenes: [usual, other] })
    useBroadcastStore.getState().takeScene(MAIN_OUTPUT_ID, other.id)
    await showDesignedMoment(plain, getVersion)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(other.id)
  })

  it("two designed moments in a row restore to what was up before the first", async () => {
    versions["d1:3"] = { designId: "d1", version: 3, document: sceneToDesign(welcome) }
    await showDesignedMoment(moment({ id: "d1", version: 2 }), getVersion)
    await showDesignedMoment(moment({ id: "d1", version: 3 }), getVersion)
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe("design-d1-v3")
    restoreAfterDesignedMoment()
    expect(out(MAIN_OUTPUT_ID)?.sceneId).toBe(usual.id)
    delete versions["d1:3"]
  })
})

describe("a scene's design pin", () => {
  it("survives normalising; a malformed pin is dropped", () => {
    expect(normalizeScene({ ...usual, design: { id: "d1", version: 2 } })?.design).toEqual({ id: "d1", version: 2 })
    for (const bad of [{ id: "d1", version: 0 }, { id: "d1", version: 1.5 }, { id: "../x", version: 1 }, "d1"]) {
      expect(normalizeScene({ ...usual, design: bad })?.design).toBeUndefined()
    }
  })
})
