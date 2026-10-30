// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }))

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))
vi.mock("@/studio/design/look-library-view", () => ({ LookLibraryView: () => null }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), emit: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => false) }))

import { createElement, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createBlankRhemaDesign, pinnedSceneForVersion } from "@/design-engine/design-document-utils"
import type { DesignDocument, DesignInput, DesignSummary, DesignVersion } from "@/design-engine/design-store"
import type { RhemaDesign } from "@/design-engine/rhema-scene"
import type { SaraswatiTextNode } from "@/vendor/avnac/saraswati"
import { SceneDesignPicker } from "./scene-design-picker"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import type { Scene } from "@/types/scene"
import type { SlideQueueItem } from "@/types/queue"

let root: Root | null = null
let originalScenes: Scene[] = []

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  HTMLCanvasElement.prototype.getContext = (() => null) as never
  originalScenes = useBroadcastStore.getState().scenes
  mockInvoke.mockReset()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  useBroadcastStore.setState({ scenes: originalScenes })
  useQueueStore.setState({ items: [] })
  document.body.replaceChildren()
})

async function render(node: React.ReactNode) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root!.render(node))
  return container
}

function withNativeText(design: RhemaDesign): RhemaDesign {
  const rootNode = design.scene.nodes[design.scene.root]
  if (!rootNode || rootNode.type !== "group") throw new Error("Fixture should have a root group")
  const node: SaraswatiTextNode = {
    id: "native-text",
    parentId: rootNode.id,
    name: "Welcome text",
    visible: true,
    x: 300,
    y: 240,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    originX: "left",
    originY: "top",
    type: "text",
    text: "Welcome to worship",
    width: 900,
    fontSize: 72,
    fontFamily: "Arial",
    fontWeight: "700",
    fontStyle: "normal",
    textAlign: "center",
    lineHeight: 1.2,
    underline: false,
    color: { type: "solid", color: "#ffffff" },
    stroke: null,
    strokeWidth: 0,
  }
  return {
    ...design,
    scene: {
      ...design.scene,
      nodes: {
        ...design.scene.nodes,
        [rootNode.id]: { ...rootNode, children: [...rootNode.children, node.id] },
        [node.id]: node,
      },
    },
  }
}

function setInputValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  setter.call(element, value)
  element.dispatchEvent(new Event("input", { bubbles: true }))
}

function serviceMoment(): SlideQueueItem {
  return {
    id: "moment-opening",
    kind: "slide",
    reference: "Welcome",
    confidence: 1,
    source: "manual",
    added_at: 1,
    slide: { title: "Welcome", body: "Welcome to worship" },
  }
}

describe("Prepare design version picker", () => {
  it("attaches a pinned scene to the plan without taking it to an output", async () => {
    const design = createBlankRhemaDesign("Opening")
    const version: DesignVersion = {
      designId: "design-opening",
      version: 2,
      fromRevision: 3,
      title: "Opening",
      document: design,
      note: null,
      savedBy: "Tolu",
      createdAt: new Date(0).toISOString(),
    }
    const savedScene = pinnedSceneForVersion(version, "Tolu").scene
    if (!savedScene) throw new Error("Fixture should convert to a Rhema scene")
    const summary: DesignSummary = {
      id: version.designId,
      title: version.title,
      kind: "design",
      revision: version.fromRevision,
      latestVersion: version.version,
      updatedAt: version.createdAt,
    }
    const listedVersion: DesignVersion = { ...version, document: null }
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "design_list") return [summary]
      if (command === "design_list_versions") return [listedVersion]
      if (command === "design_get_version") return version
      throw new Error(`Unexpected host command: ${command}`)
    })
    const item: SlideQueueItem = {
      id: "moment-opening",
      kind: "slide",
      reference: "Welcome",
      confidence: 1,
      source: "manual",
      added_at: 1,
      slide: { title: "Welcome", body: "Welcome to worship" },
    }
    useQueueStore.setState({ items: [item] })
    const before = useBroadcastStore.getState()
    const liveBefore = {
      outputs: before.outputs,
      outputStatus: before.outputStatus,
      isLive: before.isLive,
      liveVerse: before.liveVerse,
      liveSlide: before.liveSlide,
      sceneTakes: before.sceneTakes,
    }
    const selected: string[] = []
    const onSceneSelected = (sceneId: string) => {
      selected.push(sceneId)
      useQueueStore.getState().updateItem(item.id, (current) => ({ ...current, scene_id: sceneId }))
    }
    const container = await render(createElement(SceneDesignPicker, {
      eventId: "event-1",
      eventTitle: "Sunday worship",
      momentId: item.id,
      momentTitle: item.reference,
      onSceneSelected,
    }))

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Choose a scene design for Welcome"]')!.click())
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent === "My Designs")!.click())
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Use in Prepare")!.click())

    const after = useBroadcastStore.getState()
    const updatedItem = useQueueStore.getState().items[0]
    expect(selected).toHaveLength(1)
    expect(updatedItem).toMatchObject({
      scene_id: selected[0],
      slide: { designRef: { id: version.designId, version: version.version } },
    })
    expect(after.scenes.find((scene) => scene.id === selected[0])?.design).toEqual({ id: version.designId, version: version.version })
    expect(mockInvoke.mock.calls.map(([command]) => command)).toEqual([
      "design_list",
      "design_list_versions",
      "design_get_version",
    ])
    expect(mockInvoke.mock.calls[2]).toEqual(["design_get_version", { id: version.designId, version: version.version }])
    expect({
      outputs: after.outputs,
      outputStatus: after.outputStatus,
      isLive: after.isLive,
      liveVerse: after.liveVerse,
      liveSlide: after.liveSlide,
      sceneTakes: after.sceneTakes,
    }).toEqual(liveBefore)
  })

  it("does not save an orphaned scene when the moment disappears from the event", async () => {
    const design = createBlankRhemaDesign("Opening")
    const version: DesignVersion = {
      designId: "design-opening",
      version: 2,
      fromRevision: 3,
      title: "Opening",
      document: design,
      note: null,
      savedBy: "Tolu",
      createdAt: new Date(0).toISOString(),
    }
    const summary: DesignSummary = {
      id: version.designId,
      title: version.title,
      kind: "design",
      revision: version.fromRevision,
      latestVersion: version.version,
      updatedAt: version.createdAt,
    }
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "design_list") return [summary]
      if (command === "design_list_versions") return [{ ...version, document: null }]
      if (command === "design_get_version") return version
      throw new Error(`Unexpected host command: ${command}`)
    })
    const item = serviceMoment()
    useQueueStore.setState({ items: [item] })
    const scenesBefore = structuredClone(useBroadcastStore.getState().scenes)
    const outputsBefore = structuredClone(useBroadcastStore.getState().outputs)
    const onSceneSelected = vi.fn()
    const container = await render(createElement(SceneDesignPicker, {
      eventId: "event-1",
      eventTitle: "Sunday worship",
      momentId: item.id,
      momentTitle: item.reference,
      onSceneSelected,
    }))

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Choose a scene design for Welcome"]')!.click())
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent === "My Designs")!.click())
    await act(async () => useQueueStore.setState({ items: [] }))
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Use in Prepare")!.click())

    expect(onSceneSelected).not.toHaveBeenCalled()
    expect(useBroadcastStore.getState().scenes).toEqual(scenesBefore)
    expect(useBroadcastStore.getState().outputs).toEqual(outputsBefore)
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it("refuses a native-only version in Prepare without changing the plan or Live", async () => {
    const design = withNativeText(createBlankRhemaDesign("Opening"))
    const version: DesignVersion = {
      designId: "design-native",
      version: 1,
      fromRevision: 3,
      title: "Native welcome",
      document: design,
      note: null,
      savedBy: "Tolu",
      createdAt: new Date(0).toISOString(),
    }
    const summary: DesignSummary = {
      id: version.designId,
      title: version.title,
      kind: "design",
      revision: version.fromRevision,
      latestVersion: version.version,
      updatedAt: version.createdAt,
    }
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "design_list") return [summary]
      if (command === "design_list_versions") return [{ ...version, document: null }]
      if (command === "design_get_version") return version
      throw new Error(`Unexpected host command: ${command}`)
    })
    const item: SlideQueueItem = {
      id: "moment-opening",
      kind: "slide",
      reference: "Welcome",
      confidence: 1,
      source: "manual",
      added_at: 1,
      slide: { title: "Welcome", body: "Welcome to worship" },
    }
    useQueueStore.setState({ items: [item] })
    const before = useBroadcastStore.getState()
    const liveBefore = {
      outputs: before.outputs,
      outputStatus: before.outputStatus,
      isLive: before.isLive,
      liveVerse: before.liveVerse,
      liveSlide: before.liveSlide,
      sceneTakes: before.sceneTakes,
    }
    const onSceneSelected = vi.fn()
    const container = await render(createElement(SceneDesignPicker, {
      eventId: "event-1",
      eventTitle: "Sunday worship",
      momentId: item.id,
      momentTitle: item.reference,
      onSceneSelected,
    }))

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Choose a scene design for Welcome"]')!.click())
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent === "My Designs")!.click())
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Use in Prepare")!.click())

    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("cannot show it yet")
    expect(onSceneSelected).not.toHaveBeenCalled()
    expect(useQueueStore.getState().items[0]).toEqual(item)
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

  it("customizes a private copy, versions it, and uses it on the current moment without changing Live", async () => {
    const design = createBlankRhemaDesign("Opening")
    const sourceVersion: DesignVersion = {
      designId: "design-opening",
      version: 2,
      fromRevision: 3,
      title: "Opening",
      document: design,
      note: null,
      savedBy: "Tolu",
      createdAt: new Date(0).toISOString(),
    }
    const listedVersion: DesignVersion = { ...sourceVersion, document: null }
    const sourceSummary: DesignSummary = {
      id: sourceVersion.designId,
      title: sourceVersion.title,
      kind: "design",
      revision: sourceVersion.fromRevision,
      latestVersion: sourceVersion.version,
      updatedAt: sourceVersion.createdAt,
    }
    const copy: DesignDocument = {
      id: "design-opening-copy",
      title: "Opening copy",
      kind: "design",
      document: design,
      revision: 1,
      latestVersion: null,
      createdAt: new Date(1).toISOString(),
      updatedAt: new Date(1).toISOString(),
    }
    let savedCopy: DesignDocument | null = null
    mockInvoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === "design_list") return [sourceSummary]
      if (command === "design_list_versions" && args.id === sourceVersion.designId) return [listedVersion]
      if (command === "design_list_versions" && args.id === copy.id) return []
      if (command === "design_get_version" && args.id === sourceVersion.designId) return sourceVersion
      if (command === "design_duplicate") return copy
      if (command === "design_save_draft") {
        const input = args.input as DesignInput
        savedCopy = { ...copy, title: input.title, document: input.document, revision: 2 }
        return savedCopy
      }
      if (command === "design_create_version") {
        const createdVersion: DesignVersion = {
          designId: copy.id,
          version: 1,
          fromRevision: 2,
          title: savedCopy?.title ?? copy.title,
          document: savedCopy?.document ?? copy.document,
          note: null,
          savedBy: "Tolu",
          createdAt: new Date(2).toISOString(),
        }
        return createdVersion
      }
      throw new Error(`Unexpected host command: ${command}`)
    })
    const moment = serviceMoment()
    useQueueStore.setState({ items: [moment] })
    const before = useBroadcastStore.getState()
    const liveBefore = {
      outputs: before.outputs,
      outputStatus: before.outputStatus,
      isLive: before.isLive,
      liveVerse: before.liveVerse,
      liveSlide: before.liveSlide,
      sceneTakes: before.sceneTakes,
    }
    const onSceneSelected = vi.fn((sceneId: string) => {
      useQueueStore.getState().updateItem(moment.id, (current) => ({ ...current, scene_id: sceneId }))
    })
    const container = await render(createElement(SceneDesignPicker, {
      eventId: "event-1",
      eventTitle: "Sunday worship",
      momentId: moment.id,
      momentTitle: moment.reference,
      onSceneSelected,
    }))

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Choose a scene design for Welcome"]')!.click())
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent === "My Designs")!.click())
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Customize a copy")!.click())
    expect(mockInvoke).toHaveBeenCalledWith("design_duplicate", { id: sourceVersion.designId, version: sourceVersion.version, title: "Opening copy" })

    await act(async () => setInputValue(document.body.querySelector<HTMLInputElement>("#design-document-title")!, "Opening for Sunday"))
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent?.includes("Close"))!.click())
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
    expect([...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Back to saved versions"))?.disabled).toBe(true)

    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())
    expect(mockInvoke).toHaveBeenCalledWith("design_save_draft", expect.objectContaining({ id: copy.id, expectedRevision: 1, input: expect.objectContaining({ title: "Opening for Sunday" }) }))
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Create version"))!.click())
    expect(document.body.textContent).toContain("Use version 1 in Prepare")
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Use version 1 in Prepare")!.click())

    const selectedSceneId = onSceneSelected.mock.calls[0]?.[0]
    expect(selectedSceneId).toBeTruthy()
    expect(useQueueStore.getState().items[0]).toMatchObject({
      scene_id: selectedSceneId,
      slide: { designRef: { id: copy.id, version: 1 } },
    })
    expect(useBroadcastStore.getState().scenes.find((scene) => scene.id === selectedSceneId)?.design).toEqual({ id: copy.id, version: 1 })
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

  it("saves a customized native-only version but does not offer it for Prepare", async () => {
    const design = withNativeText(createBlankRhemaDesign("Opening"))
    const sourceVersion: DesignVersion = {
      designId: "design-native",
      version: 1,
      fromRevision: 1,
      title: "Native welcome",
      document: design,
      note: null,
      savedBy: "Tolu",
      createdAt: new Date(0).toISOString(),
    }
    const listedVersion = { ...sourceVersion, document: null }
    const sourceSummary: DesignSummary = {
      id: sourceVersion.designId,
      title: sourceVersion.title,
      kind: "design",
      revision: sourceVersion.fromRevision,
      latestVersion: sourceVersion.version,
      updatedAt: sourceVersion.createdAt,
    }
    const copy: DesignDocument = {
      id: "design-native-copy",
      title: "Native welcome copy",
      kind: "design",
      document: design,
      revision: 1,
      latestVersion: null,
      createdAt: new Date(1).toISOString(),
      updatedAt: new Date(1).toISOString(),
    }
    const nativeCopyVersion: DesignVersion = {
      ...sourceVersion,
      designId: copy.id,
      version: 1,
      fromRevision: copy.revision,
      title: copy.title,
    }
    mockInvoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === "design_list") return [sourceSummary]
      if (command === "design_list_versions" && args.id === sourceVersion.designId) return [listedVersion]
      if (command === "design_list_versions" && args.id === copy.id) return []
      if (command === "design_duplicate") return copy
      if (command === "design_create_version") return nativeCopyVersion
      throw new Error(`Unexpected host command: ${command}`)
    })
    const moment = serviceMoment()
    useQueueStore.setState({ items: [moment] })
    const onSceneSelected = vi.fn()
    const container = await render(createElement(SceneDesignPicker, {
      eventId: "event-1",
      eventTitle: "Sunday worship",
      momentId: moment.id,
      momentTitle: moment.reference,
      onSceneSelected,
    }))

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Choose a scene design for Welcome"]')!.click())
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent === "My Designs")!.click())
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Customize a copy")!.click())
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Create version"))!.click())

    expect(document.body.textContent).toContain("Version 1 is saved, but cannot be used in Prepare yet.")
    expect([...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Use version 1 in Prepare")).toBeUndefined()
    expect(onSceneSelected).not.toHaveBeenCalled()
    expect(useQueueStore.getState().items[0]).toEqual(moment)
  })
})
