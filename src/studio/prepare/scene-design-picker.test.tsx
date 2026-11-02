// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockInvoke, mockSceneChoose } = vi.hoisted(() => ({ mockInvoke: vi.fn(), mockSceneChoose: vi.fn() }))

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))
vi.mock("@/studio/design/look-library-view", () => ({
  LookLibraryView: ({ scenePicker }: { scenePicker?: { onChoose: (look: unknown, customize: boolean) => void } }) => {
    if (scenePicker) mockSceneChoose.mockImplementation(scenePicker.onChoose)
    return null
  },
}))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), emit: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => false) }))
vi.mock("@/lib/verse-renderer", () => ({ drawLowerThird: vi.fn(), onThemeFontsLoaded: vi.fn(() => () => {}), renderVerse: vi.fn() }))

import { createElement, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createBlankRhemaDesign, pinnedSceneForVersion } from "@/design-engine/design-document-utils"
import { LIBRARY_LOOKS } from "@/lib/look-library-data"
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
let originalOutputs = useBroadcastStore.getState().outputs

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  HTMLCanvasElement.prototype.getContext = (() => null) as never
  originalScenes = useBroadcastStore.getState().scenes
  originalOutputs = useBroadcastStore.getState().outputs
  mockInvoke.mockReset()
  mockSceneChoose.mockReset()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  useBroadcastStore.setState({ scenes: originalScenes, outputs: originalOutputs })
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

async function previewSavedVersion(version: number) {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === `Preview version ${version}`)
  if (!button) throw new Error(`Preview version ${version} button was not found`)
  await act(async () => {
    button.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
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
    bindings: { ...design.bindings, [node.id]: { id: node.id, kind: "text" } },
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
    const baseOutput = before.outputs[0]!
    useBroadcastStore.setState({ outputs: [
      { ...baseOutput, id: "sanctuary", name: "Sanctuary", role: "congregation" },
      { ...baseOutput, id: "overflow", name: "Overflow", role: "congregation" },
      { ...baseOutput, id: "stage", name: "Stage monitor", role: "stage" },
    ] })
    const liveBefore = {
      outputs: useBroadcastStore.getState().outputs,
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
    await act(async () => [...document.body.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((radio) => radio.parentElement?.textContent?.includes("Choose specific screens"))!.click())
    expect(document.body.querySelector('[aria-label="Include Stage monitor"]')).toBeNull()
    await act(async () => document.body.querySelector<HTMLInputElement>('[aria-label="Include Overflow"]')!.click())
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent === "My Designs")!.click())
    await previewSavedVersion(version.version)
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Use in Prepare")!.click())

    const after = useBroadcastStore.getState()
    const updatedItem = useQueueStore.getState().items[0]
    expect(selected).toHaveLength(1)
    expect(updatedItem).toMatchObject({
      scene_id: selected[0],
      slide: { designRef: { id: version.designId, version: version.version, outputs: ["sanctuary"] } },
    })
    expect(after.scenes.find((scene) => scene.id === selected[0])?.design).toEqual({ id: version.designId, version: version.version, pageId: "root" })
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
    await previewSavedVersion(version.version)
    await act(async () => useQueueStore.setState({ items: [] }))
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Use in Prepare")!.click())

    expect(onSceneSelected).not.toHaveBeenCalled()
    expect(useBroadcastStore.getState().scenes).toEqual(scenesBefore)
    expect(useBroadcastStore.getState().outputs).toEqual(outputsBefore)
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it("uses a native static-text version in Prepare without changing Live", async () => {
    const design = withNativeText(createBlankRhemaDesign("Opening"))
    const designRoot = design.scene.nodes[design.scene.root]
    const englishText = design.scene.nodes["native-text"]
    if (!designRoot || designRoot.type !== "group" || !englishText || englishText.type !== "text") throw new Error("Expected the design root and text layer")
    const yorubaText = { ...englishText, id: "native-text-page-two", parentId: "page-two-group", text: "Ẹ káàbọ̀" }
    design.pages = [
      { id: "english-page", nodeId: "page-one-group", title: "English" },
      { id: "yoruba-page", nodeId: "page-two-group", title: "Yoruba" },
    ]
    design.scene = {
      ...design.scene,
      nodes: {
        ...design.scene.nodes,
        [designRoot.id]: { ...designRoot, children: ["page-one-group", "page-two-group"] },
        "page-one-group": { id: "page-one-group", type: "group", parentId: designRoot.id, name: "English", visible: true, opacity: 1, children: [englishText.id] },
        "page-two-group": { id: "page-two-group", type: "group", parentId: designRoot.id, name: "Yoruba", visible: true, opacity: 1, children: [yorubaText.id] },
        [englishText.id]: { ...englishText, parentId: "page-one-group" },
        [yorubaText.id]: yorubaText,
      },
    }
    design.bindings[yorubaText.id] = { ...design.bindings[englishText.id], id: yorubaText.id }
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
    await previewSavedVersion(version.version)
    const pageSelect = document.body.querySelector<HTMLSelectElement>('[aria-label="Preview page"]')!
    const setPageValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!
    await act(async () => {
      setPageValue.call(pageSelect, "yoruba-page")
      pageSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Use selected page in Prepare")!.click())

    expect(document.body.querySelector('[role="alert"]')).toBeNull()
    expect(onSceneSelected).toHaveBeenCalledTimes(1)
    const selectedSceneId = onSceneSelected.mock.calls[0]?.[0]
    expect(useQueueStore.getState().items[0]).toMatchObject({ slide: { designRef: { id: version.designId, version: version.version, pageId: "yoruba-page" } } })
    expect(useBroadcastStore.getState().scenes.find((scene) => scene.id === selectedSceneId)?.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "text", text: "Ẹ káàbọ̀" }),
    ]))
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

  it("saves a customized static-text version and offers it for Prepare", async () => {
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

    const useVersion = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Use version 1 in Prepare")
    expect(useVersion).toBeDefined()
    expect(document.body.textContent).not.toContain("cannot be used in Prepare yet")
    await act(async () => useVersion!.click())
    expect(onSceneSelected).toHaveBeenCalledTimes(1)
    expect(useQueueStore.getState().items[0]).toMatchObject({ slide: { designRef: { id: copy.id, version: 1 } } })
  })

  it("creates a canonical template draft, versions it, and uses it only on the selected moment", async () => {
    const template = LIBRARY_LOOKS.find((look) => look.id === "look-classic-scene-bible")
    if (template?.kind !== "scene") throw new Error("Expected the built-in scene template")
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
    const onSceneSelected = vi.fn()
    let created: DesignDocument | null = null
    let version: DesignVersion | null = null
    mockInvoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === "design_create") {
        const input = args.input as DesignInput
        created = {
          id: "design-template-copy",
          title: input.title,
          kind: "design",
          document: input.document,
          revision: 1,
          latestVersion: null,
          createdAt: new Date(1).toISOString(),
          updatedAt: new Date(1).toISOString(),
        }
        return created
      }
      if (command === "design_list") return created ? [{ id: created.id, title: created.title, kind: "design", revision: created.revision, latestVersion: created.latestVersion, updatedAt: created.updatedAt }] : []
      if (command === "design_get" && created && args.id === created.id) return created
      if (command === "design_list_versions") return []
      if (command === "design_save_draft" && created) {
        const input = args.input as DesignInput
        created = { ...created, title: input.title, document: input.document, revision: 2, updatedAt: new Date(2).toISOString() }
        return created
      }
      if (command === "design_create_version" && created) {
        version = {
          designId: created.id,
          version: 1,
          fromRevision: created.revision,
          title: created.title,
          document: created.document,
          note: null,
          savedBy: "Tolu",
          createdAt: new Date(3).toISOString(),
        }
        return version
      }
      throw new Error(`Unexpected host command: ${command}`)
    })
    const container = await render(createElement(SceneDesignPicker, {
      eventId: "event-1",
      eventTitle: "Sunday worship",
      momentId: moment.id,
      momentTitle: moment.reference,
      onSceneSelected,
    }))

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Choose a scene design for Welcome"]')!.click())
    await act(async () => mockSceneChoose(template, true))
    expect(mockInvoke).toHaveBeenCalledWith("design_create", expect.objectContaining({ input: expect.objectContaining({ kind: "design" }) }))
    expect(document.body.querySelector<HTMLInputElement>("#design-document-title")).not.toBeNull()
    const itemBeforeUse = useQueueStore.getState().items[0]
    if (itemBeforeUse?.kind !== "slide") throw new Error("Expected the selected service moment to remain a slide")
    expect(itemBeforeUse.slide).not.toHaveProperty("designRef")
    expect(onSceneSelected).not.toHaveBeenCalled()

    await act(async () => setInputValue(document.body.querySelector<HTMLInputElement>("#design-document-title")!, "Sunday welcome"))
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())
    expect(mockInvoke).toHaveBeenCalledWith("design_save_draft", expect.objectContaining({ id: "design-template-copy", expectedRevision: 1, input: expect.objectContaining({ title: "Sunday welcome" }) }))
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Create version"))!.click())
    expect(document.body.textContent).toContain("Use version 1 in Prepare")
    const itemBeforeVersionUse = useQueueStore.getState().items[0]
    if (itemBeforeVersionUse?.kind !== "slide") throw new Error("Expected the selected service moment to remain a slide")
    expect(itemBeforeVersionUse.slide).not.toHaveProperty("designRef")
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Use version 1 in Prepare")!.click())

    expect(onSceneSelected).toHaveBeenCalledTimes(1)
    expect(useQueueStore.getState().items[0]).toMatchObject({ slide: { designRef: { id: "design-template-copy", version: 1 } } })
    const after = useBroadcastStore.getState()
    expect({ outputs: after.outputs, outputStatus: after.outputStatus, isLive: after.isLive, liveVerse: after.liveVerse, liveSlide: after.liveSlide, sceneTakes: after.sceneTakes }).toEqual(liveBefore)
  })

  it("uses a template only after creating an immutable version", async () => {
    const template = LIBRARY_LOOKS.find((look) => look.id === "look-classic-scene-bible")
    if (template?.kind !== "scene") throw new Error("Expected the built-in scene template")
    const moment = serviceMoment()
    useQueueStore.setState({ items: [moment] })
    const created = {
      id: "design-template-ready",
      title: "Classic · Camera and scripture",
      kind: "design" as const,
      document: createBlankRhemaDesign("Template copy"),
      revision: 1,
      latestVersion: null,
      createdAt: new Date(1).toISOString(),
      updatedAt: new Date(1).toISOString(),
    }
    const createdVersion: DesignVersion = {
      designId: created.id,
      version: 1,
      fromRevision: 1,
      title: created.title,
      document: created.document,
      note: "Started from template",
      savedBy: "Tolu",
      createdAt: new Date(2).toISOString(),
    }
    let createdDocument = created
    mockInvoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === "design_create") {
        const input = args.input as DesignInput
        createdDocument = { ...created, title: input.title, document: input.document }
        return createdDocument
      }
      if (command === "design_create_version") return { ...createdVersion, title: createdDocument.title, document: createdDocument.document }
      throw new Error(`Unexpected host command: ${command}`)
    })
    const onSceneSelected = vi.fn()
    const container = await render(createElement(SceneDesignPicker, {
      eventId: "event-1",
      eventTitle: "Sunday worship",
      momentId: moment.id,
      momentTitle: moment.reference,
      onSceneSelected,
    }))

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Choose a scene design for Welcome"]')!.click())
    await act(async () => mockSceneChoose(template, false))

    expect(mockInvoke).toHaveBeenCalledWith("design_create_version", expect.objectContaining({ id: created.id, expectedRevision: 1, note: "Started from template" }))
    expect(onSceneSelected).toHaveBeenCalledTimes(1)
    expect(useQueueStore.getState().items[0]).toMatchObject({ slide: { designRef: { id: created.id, version: 1 } } })
  })
})
