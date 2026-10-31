// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockUsedOn, mockListVersions, mockGetVersion } = vi.hoisted(() => ({
  mockUsedOn: vi.fn(),
  mockListVersions: vi.fn(),
  mockGetVersion: vi.fn(),
}))
vi.mock("@/design-engine/design-store", () => ({ designStore: {
  usedOn: (...args: unknown[]) => mockUsedOn(...args),
  listVersions: (...args: unknown[]) => mockListVersions(...args),
  getVersion: (...args: unknown[]) => mockGetVersion(...args),
} }))

import { createElement, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { Scene } from "@/types/scene"
import { sceneToDesign } from "@/design-engine/rhema-scene"
import type { DesignVersion } from "@/design-engine/design-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { DesignUsagePanel } from "./design-usage-panel"

let root: Root | null = null
let originalScenes: Scene[] = []

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  originalScenes = useBroadcastStore.getState().scenes
  mockUsedOn.mockReset()
  mockUsedOn.mockResolvedValue([])
  mockListVersions.mockReset()
  mockListVersions.mockResolvedValue([])
  mockGetVersion.mockReset()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  useBroadcastStore.setState({ scenes: originalScenes })
  document.body.replaceChildren()
})

describe("Design usage details", () => {
  it("shows plan pins, approved revision separately, and local scene pins without changing Live", async () => {
    const localScene = {
      id: "scene-opening",
      name: "Opening graphic",
      design: { id: "design-opening", version: 1 },
    } as Scene
    useBroadcastStore.setState({ scenes: [localScene] })
    const before = useBroadcastStore.getState()
    const liveBefore = {
      outputs: before.outputs,
      outputStatus: before.outputStatus,
      isLive: before.isLive,
      liveVerse: before.liveVerse,
      liveSlide: before.liveSlide,
      sceneTakes: before.sceneTakes,
    }
    mockUsedOn.mockResolvedValue([{
      programId: "program-sunday",
      title: "Sunday service",
      serviceDate: "2026-11-01",
      revision: 8,
      approvedRevision: 7,
      itemId: "moment-opening",
      reference: "Opening",
      version: 2,
    }])

    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root!.render(createElement(DesignUsagePanel, { designId: "design-opening" })))

    const panel = document.body.querySelector('[aria-label="Used On"]')!
    expect(mockUsedOn).toHaveBeenCalledWith("design-opening")
    expect(panel.textContent).toContain("Sunday service")
    expect(panel.textContent).toContain("Opening · version 2")
    expect(panel.textContent).toContain("Plan revision 8 · Live approved revision 7")
    expect(panel.textContent).toContain("Opening graphic")
    expect(panel.textContent).toContain("Saved scene · version 1")
    const after = useBroadcastStore.getState()
    expect({
      outputs: after.outputs,
      outputStatus: after.outputStatus,
      isLive: after.isLive,
      liveVerse: after.liveVerse,
      liveSlide: after.liveSlide,
      sceneTakes: after.sceneTakes,
    }).toEqual(liveBefore)
  })

  it("offers an explicit update for stale local scene pins without changing Live", async () => {
    const localScene = {
      id: "scene-opening",
      name: "Opening graphic",
      background: "#111111",
      layers: [{ id: "old-layer", name: "Old background", kind: "color", color: "#111111", box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, visible: true }],
      design: { id: "design-opening", version: 1 },
      createdAt: 1,
      updatedAt: 2,
    } as Scene
    const alreadyCurrent = { ...localScene, id: "scene-current", name: "Current graphic", design: { id: "design-opening", version: 2 } }
    useBroadcastStore.setState({ scenes: [localScene, alreadyCurrent] })
    const before = useBroadcastStore.getState()
    const liveBefore = {
      outputs: before.outputs,
      outputStatus: before.outputStatus,
      isLive: before.isLive,
      liveVerse: before.liveVerse,
      liveSlide: before.liveSlide,
      sceneTakes: before.sceneTakes,
    }
    const sourceScene = {
      id: "design-source",
      name: "Opening design",
      background: "#222222",
      layers: [{ id: "new-layer", name: "New background", kind: "color", color: "#222222", box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, visible: true }],
      createdAt: 1,
      updatedAt: 1,
    } as Scene
    const version: DesignVersion = {
      designId: "design-opening",
      version: 2,
      fromRevision: 4,
      title: "Opening design v2",
      document: sceneToDesign(sourceScene),
      note: "New background",
      savedBy: "Hendrix",
      createdAt: "2026-10-30T00:00:00Z",
    }
    mockListVersions.mockResolvedValue([
      { designId: version.designId, version: 1 },
      { designId: version.designId, version: 2 },
    ])
    mockGetVersion.mockResolvedValue(version)

    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root!.render(createElement(DesignUsagePanel, { designId: "design-opening" })))

    const staleCard = [...document.querySelectorAll("section[aria-label='Used On'] > div")]
      .find((card) => card.textContent?.includes("Opening graphic"))!
    const update = [...staleCard.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Update to v 2")!
    expect(update).toBeTruthy()
    const currentCard = [...document.querySelectorAll("section[aria-label='Used On'] > div")]
      .find((card) => card.textContent?.includes("Current graphic"))!
    expect(currentCard.querySelector("button")).toBeNull()

    await act(async () => { update.click(); await Promise.resolve() })
    const updated = useBroadcastStore.getState().scenes.find((scene) => scene.id === localScene.id)!
    expect(mockGetVersion).toHaveBeenCalledWith("design-opening", 2)
    expect(updated).toMatchObject({
      id: "scene-opening",
      name: "Opening graphic",
      design: { id: "design-opening", version: 2 },
      background: "#222222",
    })
    expect(updated.layers[0]).toMatchObject({ id: "new-layer", color: "#222222" })
    const after = useBroadcastStore.getState()
    expect({
      outputs: after.outputs,
      outputStatus: after.outputStatus,
      isLive: after.isLive,
      liveVerse: after.liveVerse,
      liveSlide: after.liveSlide,
      sceneTakes: after.sceneTakes,
    }).toEqual(liveBefore)
  })

  it("refuses a newer design version that cannot be converted to a scene", async () => {
    const localScene = {
      id: "scene-opening",
      name: "Opening graphic",
      background: "#111111",
      layers: [],
      design: { id: "design-opening", version: 1 },
      createdAt: 1,
      updatedAt: 2,
    } as Scene
    useBroadcastStore.setState({ scenes: [localScene] })
    const version: DesignVersion = {
      designId: "design-opening",
      version: 2,
      fromRevision: 4,
      title: "Unsupported design",
      document: sceneToDesign({
        id: "design-source",
        name: "Unsupported design",
        background: "#222222",
        layers: [],
        createdAt: 1,
        updatedAt: 1,
      } as Scene),
      note: null,
      savedBy: "Hendrix",
      createdAt: "2026-10-30T00:00:00Z",
    }
    const documentWithUnboundLayer = structuredClone(version.document!)
    const rootNode = documentWithUnboundLayer.scene.nodes[documentWithUnboundLayer.scene.root]
    if (rootNode?.type === "group") rootNode.children.push("unbound-layer")
    documentWithUnboundLayer.scene.nodes["unbound-layer"] = {
      id: "unbound-layer",
      parentId: documentWithUnboundLayer.scene.root,
      name: "Unbound layer",
      visible: true,
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      originX: "left",
      originY: "top",
      type: "rect",
      width: 1920,
      height: 1080,
      fill: { type: "solid", color: "#222222" },
      stroke: null,
      strokeWidth: 0,
      radiusX: 0,
      radiusY: 0,
    } as (typeof documentWithUnboundLayer.scene.nodes)[string]
    mockListVersions.mockResolvedValue([{ designId: version.designId, version: 2 }])
    mockGetVersion.mockResolvedValue({ ...version, document: documentWithUnboundLayer })

    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root!.render(createElement(DesignUsagePanel, { designId: "design-opening" })))
    const update = [...document.querySelectorAll<HTMLButtonElement>("section[aria-label='Used On'] button")]
      .find((button) => button.textContent?.trim() === "Update to v 2")!

    await act(async () => { update.click(); await Promise.resolve() })

    expect(useBroadcastStore.getState().scenes[0]).toEqual(localScene)
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("Rhema scenes cannot show it yet")
  })
})
