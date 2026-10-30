// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/scene-renderer", () => ({ drawScene: vi.fn() }))
const { getVersionMock } = vi.hoisted(() => ({ getVersionMock: vi.fn() }))
vi.mock("@/design-engine/design-store", () => ({ designStore: { getVersion: (...args: unknown[]) => getVersionMock(...args) } }))

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { drawScene } from "@/lib/scene-renderer"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { newScene } from "@/lib/scenes"
import { sceneToDesign } from "@/design-engine/rhema-scene"
import type { DesignVersion } from "@/design-engine/design-store"
import { parseItemIntent, sceneStep } from "@/lib/item-intent"
import type { BroadcastOutput, QueueItem } from "@/types"
import { RunOfShowEventEditor } from "./run-of-show-event-editor"

const prayerIntent = parseItemIntent(JSON.stringify({ on_take: [sceneStep("prayer-scene", "sanctuary")] }))
const moment: QueueItem = {
  id: "prayer-scripture",
  kind: "verse",
  verse: { book_number: 43, book_name: "John", chapter: 3, verse: 16, text: "For God so loved the world" },
  reference: "John 3:16",
  confidence: 1,
  source: "manual",
  added_at: 0,
  ...prayerIntent,
} as unknown as QueueItem

const sermonIntent = parseItemIntent(JSON.stringify({ on_take: [sceneStep("overflow-scene", "overflow")] }))
const sermonMoment: QueueItem = {
  id: "sermon-scripture",
  kind: "verse",
  verse: { book_number: 45, book_name: "Romans", chapter: 8, verse: 1, text: "There is therefore now no condemnation" },
  reference: "Romans 8:1",
  confidence: 1,
  source: "manual",
  added_at: 1,
  ...sermonIntent,
} as unknown as QueueItem

const output: BroadcastOutput = {
  id: "sanctuary",
  name: "Sanctuary",
  type: "display",
  role: "congregation",
  sceneId: "sanctuary-current",
  themeId: "default",
  monitorIndex: 0,
  ndi: { sourceName: "Sanctuary", resolution: "r1080p", frameRate: "fps30", alphaMode: "noneOpaque" },
}

const overflowOutput: BroadcastOutput = {
  ...output,
  id: "overflow",
  name: "Overflow",
  sceneId: "overflow-current",
  ndi: { ...output.ndi, sourceName: "Overflow" },
}

const stageOutput: BroadcastOutput = { ...output, id: "stage", name: "Stage", role: "stage" }
const legacyOutput: BroadcastOutput = { ...output, id: "legacy", name: "Legacy screen", role: undefined, sceneId: "sanctuary-current" }

let root: Root | null = null

function render(header: Parameters<typeof RunOfShowEventEditor>[0]["header"]) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const el = document.createElement("div")
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => root!.render(<RunOfShowEventEditor header={header} onOpenMoment={() => {}} />))
  return el
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.restoreAllMocks()
  vi.mocked(drawScene).mockClear()
  getVersionMock.mockReset()
  document.body.replaceChildren()
})

describe("Run of Show event preview", () => {
  it("previews the event's selected moment and planned scene without taking it live", async () => {
    const scene = newScene("Prayer camera and Scripture")
    scene.id = "prayer-scene"
    const overflowScene = newScene("Overflow planned scene")
    overflowScene.id = "overflow-scene"
    const overflowCurrentScene = newScene("Overflow current scene")
    overflowCurrentScene.id = "overflow-current"
    const sanctuaryCurrentScene = newScene("Sanctuary current scene")
    sanctuaryCurrentScene.id = "sanctuary-current"
    useQueueStore.setState({
      items: [moment, sermonMoment],
      headers: [{ id: "prayer", type: "group", name: "Opening Prayer", at: 0, event: { schema_version: 1 } }],
      activeIndex: null,
    })
    useBroadcastStore.setState({
      scenes: [scene, overflowScene, overflowCurrentScene, sanctuaryCurrentScene],
      outputs: [overflowOutput, legacyOutput, stageOutput, output],
      isLive: true,
      liveItemId: "currently-on-air",
      liveVerse: { reference: "Psalm 23:1", segments: [{ text: "The Lord is my shepherd" }] },
    })
    const before = {
      isLive: useBroadcastStore.getState().isLive,
      liveItemId: useBroadcastStore.getState().liveItemId,
      liveVerse: useBroadcastStore.getState().liveVerse,
      outputs: structuredClone(useBroadcastStore.getState().outputs),
    }
    const takeScene = vi.spyOn(useBroadcastStore.getState(), "takeScene")
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D)

    const el = render(useQueueStore.getState().headers[0])
    const tab = el.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Event preview"]')
    expect(tab).not.toBeNull()
    await act(async () => { tab!.focus(); tab!.click() })

    expect(el.querySelector('[aria-label="Preview of Prayer camera and Scripture"]')).not.toBeNull()
    expect(el.querySelector('[aria-label="Selected moment content preview"]')).not.toBeNull()
    expect(el.querySelector<HTMLSelectElement>('[aria-label="Preview audience screen"]')?.value).toBe("sanctuary")
    expect(el.textContent).toContain("Opening Prayer")
    expect(el.textContent).toContain("Sanctuary")
    expect(vi.mocked(drawScene).mock.calls.at(-1)?.[3]).toMatchObject({ sceneId: "prayer-scene" })

    const outputSelect = el.querySelector<HTMLSelectElement>('[aria-label="Preview audience screen"]')!
    expect([...outputSelect.options].map((option) => option.value)).toEqual(["overflow", "legacy", "sanctuary"])
    await act(async () => {
      outputSelect.value = "overflow"
      outputSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(vi.mocked(drawScene).mock.calls.at(-1)?.[3]).toMatchObject({ sceneId: "overflow-current" })

    const momentSelect = el.querySelector<HTMLSelectElement>('[aria-label="Preview event moment"]')!
    await act(async () => {
      momentSelect.value = "sermon-scripture"
      momentSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(outputSelect.value).toBe("overflow")
    expect(vi.mocked(drawScene).mock.calls.at(-1)?.[3]).toMatchObject({ sceneId: "overflow-scene" })
    expect(useBibleStore.getState().selectedVerse).toMatchObject({ book_number: 45, chapter: 8, verse: 1 })
    expect(el.querySelector('[aria-label="Selected moment content preview"]')?.textContent).toContain("Romans 8:1")
    expect([...el.querySelectorAll<HTMLCanvasElement>('canvas[role="img"]')].at(-1)?.getAttribute("aria-label")).toContain("Romans 8:1")

    await act(async () => {
      outputSelect.value = "sanctuary"
      outputSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(vi.mocked(drawScene).mock.calls.at(-1)?.[3]).toMatchObject({ sceneId: "sanctuary-current" })
    expect(el.textContent).toContain("Sanctuary")
    expect(el.textContent).toContain("OBS stays independent")
    expect(useBroadcastStore.getState()).toMatchObject({
      isLive: before.isLive,
      liveItemId: before.liveItemId,
      liveVerse: before.liveVerse,
      outputs: before.outputs,
    })
    expect(takeScene).not.toHaveBeenCalled()
    takeScene.mockRestore()
  })

  it("renders the exact pinned design version instead of a newer local scene copy", async () => {
    const pinnedVersionScene = newScene("Welcome look v1")
    pinnedVersionScene.id = "welcome-v1"
    const localLatestScene = newScene("Mutable local copy v2")
    localLatestScene.id = "welcome-local"
    localLatestScene.design = { id: "design-1", version: 2 }
    const designedMoment: QueueItem = {
      id: "designed-welcome",
      kind: "slide",
      slide: { title: "Welcome", body: "The service begins soon", designRef: { id: "design-1", version: 1 } },
      scene_id: localLatestScene.id,
      reference: "Welcome",
      confidence: 1,
      source: "manual",
      added_at: 0,
    } as unknown as QueueItem
    const version: DesignVersion = {
      designId: "design-1",
      version: 1,
      fromRevision: 1,
      title: "Sunday welcome",
      document: sceneToDesign(pinnedVersionScene),
      note: null,
      savedBy: "host",
      createdAt: "2026-10-30T10:00:00Z",
    }
    getVersionMock.mockResolvedValue(version)
    useQueueStore.setState({
      items: [designedMoment],
      headers: [{ id: "welcome", type: "group", name: "Welcome", at: 0, event: { schema_version: 1 } }],
      activeIndex: null,
    })
    useBroadcastStore.setState({
      scenes: [localLatestScene],
      outputs: [output],
      isLive: true,
      liveItemId: "currently-on-air",
      liveVerse: { reference: "Psalm 23:1", segments: [{ text: "The Lord is my shepherd" }] },
    })
    const before = {
      isLive: useBroadcastStore.getState().isLive,
      liveItemId: useBroadcastStore.getState().liveItemId,
      liveVerse: useBroadcastStore.getState().liveVerse,
      outputs: structuredClone(useBroadcastStore.getState().outputs),
    }
    const takeScene = vi.spyOn(useBroadcastStore.getState(), "takeScene")
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D)

    const el = render(useQueueStore.getState().headers[0])
    const tab = el.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Event preview"]')!
    await act(async () => { tab.focus(); tab.click() })

    expect(getVersionMock).toHaveBeenCalledWith("design-1", 1)
    expect(getVersionMock).not.toHaveBeenCalledWith("design-1", 2)
    expect(el.textContent).toContain("Welcome look v1 · Sanctuary")
    expect(el.textContent).not.toContain("Mutable local copy v2")
    expect(el.querySelector('[aria-label="Preview of Welcome look v1"]')).not.toBeNull()
    expect(useBroadcastStore.getState()).toMatchObject({
      isLive: before.isLive,
      liveItemId: before.liveItemId,
      liveVerse: before.liveVerse,
      outputs: before.outputs,
    })
    expect(takeScene).not.toHaveBeenCalled()
  })

  it("falls back to the moment's own slide when its pinned version is missing, never the local scene", async () => {
    const localLatestScene = newScene("Mutable local copy v2")
    localLatestScene.id = "welcome-local"
    const designedMoment: QueueItem = {
      id: "designed-welcome",
      kind: "slide",
      slide: { title: "Welcome", body: "The service begins soon", designRef: { id: "design-1", version: 1 } },
      scene_id: localLatestScene.id,
      reference: "Welcome",
      confidence: 1,
      source: "manual",
      added_at: 0,
    } as unknown as QueueItem
    getVersionMock.mockResolvedValue(null)
    useQueueStore.setState({
      items: [designedMoment],
      headers: [{ id: "welcome", type: "group", name: "Welcome", at: 0, event: { schema_version: 1 } }],
      activeIndex: null,
    })
    useBroadcastStore.setState({ scenes: [localLatestScene], outputs: [output], isLive: true, liveItemId: "currently-on-air" })
    const takeScene = vi.spyOn(useBroadcastStore.getState(), "takeScene")
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D)

    const el = render(useQueueStore.getState().headers[0])
    const tab = el.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Event preview"]')!
    await act(async () => { tab.focus(); tab.click() })

    expect(el.textContent).toContain("design-1 version 1 is not in this computer's designs")
    expect(el.textContent).toContain("The moment's own slide is shown below")
    expect(el.textContent).not.toContain("Mutable local copy v2")
    expect(el.querySelector('[aria-label="Preview of Mutable local copy v2"]')).toBeNull()
    expect(useBroadcastStore.getState()).toMatchObject({ isLive: true, liveItemId: "currently-on-air", outputs: [output] })
    expect(takeScene).not.toHaveBeenCalled()
  })

  it("keeps explicit per-screen Take scenes ahead of a moment's general design pin", async () => {
    const sanctuaryPlannedScene = newScene("Sanctuary's planned scene")
    sanctuaryPlannedScene.id = "sanctuary-planned"
    const overflowPlannedScene = newScene("Overflow's planned scene")
    overflowPlannedScene.id = "overflow-planned"
    const designedMoment: QueueItem = {
      id: "designed-welcome",
      kind: "slide",
      slide: { title: "Welcome", body: "The service begins soon", designRef: { id: "design-1", version: 1 } },
      on_take: [sceneStep(sanctuaryPlannedScene.id, "sanctuary"), sceneStep(overflowPlannedScene.id, "overflow")],
      reference: "Welcome",
      confidence: 1,
      source: "manual",
      added_at: 0,
    } as unknown as QueueItem
    useQueueStore.setState({
      items: [designedMoment],
      headers: [{ id: "welcome", type: "group", name: "Welcome", at: 0, event: { schema_version: 1 } }],
      activeIndex: null,
    })
    useBroadcastStore.setState({
      scenes: [sanctuaryPlannedScene, overflowPlannedScene],
      outputs: [output, overflowOutput],
      isLive: true,
      liveItemId: "currently-on-air",
    })
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D)

    const el = render(useQueueStore.getState().headers[0])
    const tab = el.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Event preview"]')!
    await act(async () => { tab.focus(); tab.click() })
    expect(getVersionMock).not.toHaveBeenCalled()
    expect(el.textContent).toContain("The explicit Take scene for this screen takes precedence over pinned design v1")
    expect(el.textContent).toContain("Sanctuary's planned scene · Sanctuary")

    const outputSelect = el.querySelector<HTMLSelectElement>('[aria-label="Preview audience screen"]')!
    await act(async () => {
      outputSelect.value = "overflow"
      outputSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(el.textContent).toContain("Overflow's planned scene · Overflow")
    expect(vi.mocked(drawScene).mock.calls.at(-1)?.[3]).toMatchObject({ sceneId: "overflow-planned" })
    expect(getVersionMock).not.toHaveBeenCalled()
  })
})
