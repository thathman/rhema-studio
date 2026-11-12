import { beforeEach, describe, expect, it, vi } from "vitest"

const ask = vi.hoisted(() => vi.fn<(message: string, options?: { title?: string }) => Promise<boolean>>(async () => false))
const disableOutput = vi.hoisted(() => vi.fn(async () => true))
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}), emitTo: vi.fn(async () => {}) }))
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn(async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} })) }))
vi.mock("@/lib/broadcast-output-control", () => ({ disableOutput }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { newScene, SCENE_PRESETS } from "@/lib/scenes"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { designPathOf } from "@/studio/design/design-groups"
import { toast } from "sonner"
import type { BroadcastTheme } from "@/types"
import { deleteThemeAsked, removeOutputAsked } from "./delete-asks"

const custom: BroadcastTheme = { ...BUILTIN_THEMES[0], id: "church-look", name: "Church look", builtin: false }
const spare: BroadcastTheme = { ...BUILTIN_THEMES[0], id: "spare-look", name: "Spare look", builtin: false }

beforeEach(() => {
  ask.mockReset()
  ask.mockResolvedValue(false)
  disableOutput.mockClear()
  const main = useBroadcastStore.getState().outputs[0]!
  useBroadcastStore.setState({
    themes: [...BUILTIN_THEMES, custom, spare],
    scenes: [],
    designDrafts: [],
    editingThemeId: null,
    outputStatus: {},
    outputs: [
      { ...main, id: "main", name: "Sanctuary", themeId: custom.id, sceneId: undefined },
      { ...main, id: "overflow", name: "Overflow hall", themeId: BUILTIN_THEMES[0].id, sceneId: undefined },
    ],
  })
})

const themeIds = () => useBroadcastStore.getState().themes.map((t) => t.id)
const outputIds = () => useBroadcastStore.getState().outputs.map((o) => o.id)

describe("Deleting a theme is asked first (#831 S7)", () => {
  it("keeps the theme when the question is answered Keep", async () => {
    expect(await deleteThemeAsked(spare)).toBe("kept")
    expect(ask).toHaveBeenCalledTimes(1)
    expect(String(ask.mock.calls[0]![0])).toContain("“Spare look”")
    expect(themeIds()).toContain(spare.id)
  })

  it("keeps the theme when the question cannot be shown", async () => {
    ask.mockRejectedValueOnce(new Error("no dialog"))
    expect(await deleteThemeAsked(spare)).toBe("kept")
    expect(themeIds()).toContain(spare.id)
  })

  it("deletes it only after Delete, and names the scenes that use it", async () => {
    const scene = newScene("Welcome", SCENE_PRESETS[0])
    useBroadcastStore.setState({ scenes: [{ ...scene, layers: scene.layers.map((layer, i) => (i === 0 ? { ...layer, themeId: spare.id } : layer)) }] })
    ask.mockResolvedValueOnce(true)
    expect(await deleteThemeAsked(spare)).toBe("deleted")
    expect(String(ask.mock.calls[0]![0])).toContain("Scenes that use it (Welcome) will show in each output's own look.")
    expect(themeIds()).not.toContain(spare.id)
  })

  it("says the draft goes only when there is one", async () => {
    await deleteThemeAsked(spare)
    expect(String(ask.mock.calls[0]![0])).not.toContain("draft")
    useBroadcastStore.setState({ editingThemeId: spare.id })
    await deleteThemeAsked(spare)
    expect(String(ask.mock.calls[1]![0])).toContain("Its unsaved draft goes too.")
  })

  it("refuses one a shown scene uses without asking, so nothing on air changes look", async () => {
    const scene = newScene("Welcome", SCENE_PRESETS[0])
    const shown = { ...scene, layers: scene.layers.map((layer, i) => (i === 0 ? { ...layer, themeId: spare.id } : layer)) }
    const s = useBroadcastStore.getState()
    useBroadcastStore.setState({ scenes: [shown], outputs: s.outputs.map((o) => (o.id === "overflow" ? { ...o, sceneId: shown.id } : o)) })
    expect(await deleteThemeAsked(spare)).toBe("in-use")
    expect(ask).not.toHaveBeenCalled()
    expect(themeIds()).toContain(spare.id)
  })

  it("checks again after the answer: an output that took it meanwhile keeps it", async () => {
    ask.mockImplementationOnce(async () => {
      const s = useBroadcastStore.getState()
      const scene = newScene("Late", SCENE_PRESETS[0])
      const shown = { ...scene, layers: scene.layers.map((layer, i) => (i === 0 ? { ...layer, themeId: spare.id } : layer)) }
      useBroadcastStore.setState({ scenes: [shown], outputs: s.outputs.map((o) => (o.id === "overflow" ? { ...o, sceneId: shown.id } : o)) })
      return true
    })
    expect(await deleteThemeAsked(spare)).toBe("in-use")
    expect(themeIds()).toContain(spare.id)
  })

  it("refuses one an output uses without asking", async () => {
    expect(await deleteThemeAsked(custom)).toBe("in-use")
    expect(ask).not.toHaveBeenCalled()
    expect(themeIds()).toContain(custom.id)
  })

  it("points the refusal at Design → Where used, where each output opens (#818)", async () => {
    vi.mocked(toast.error).mockClear()
    expect(await deleteThemeAsked(custom)).toBe("in-use")
    const description = (vi.mocked(toast.error).mock.calls[0]?.[1] as { description?: string } | undefined)?.description ?? ""
    expect(designPathOf("used-on")).toBe("Design → Where used")
    expect(description).toContain("Design → Where used opens each one.")
    expect(description).not.toContain("Used on…")
  })
})

describe("Removing an output is asked first (#831 S7)", () => {
  it("keeps the output, and never stops it, when the question is answered Keep", async () => {
    const overflow = useBroadcastStore.getState().outputs[1]!
    expect(await removeOutputAsked(overflow)).toBe("kept")
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask.mock.calls[0]![1]?.title).toContain("“Overflow hall”")
    expect(disableOutput).not.toHaveBeenCalled()
    expect(outputIds()).toEqual(["main", "overflow"])
  })

  it("does nothing when the output was removed or edited while asked", async () => {
    const overflow = useBroadcastStore.getState().outputs[1]!
    ask.mockImplementationOnce(async () => {
      useBroadcastStore.getState().renameOutput("overflow", "Annexe")
      return true
    })
    expect(await removeOutputAsked(overflow)).toBe("kept")
    expect(disableOutput).not.toHaveBeenCalled()
    expect(outputIds()).toEqual(["main", "overflow"])
  })

  it("stops and removes it only after Remove", async () => {
    const overflow = useBroadcastStore.getState().outputs[1]!
    ask.mockResolvedValueOnce(true)
    expect(await removeOutputAsked(overflow)).toBe("removed")
    expect(disableOutput).toHaveBeenCalledTimes(1)
    expect(outputIds()).toEqual(["main"])
  })
})
