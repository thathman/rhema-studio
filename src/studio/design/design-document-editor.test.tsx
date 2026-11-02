// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { store } = vi.hoisted(() => ({
  store: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    saveDraft: vi.fn(),
    createVersion: vi.fn(),
    getVersion: vi.fn(),
    listVersions: vi.fn(),
    duplicate: vi.fn(),
    usedOn: vi.fn(),
    remove: vi.fn(),
  },
}))

vi.mock("@/design-engine/design-store", () => ({ designStore: store }))
vi.mock("@/vendor/avnac/renderer/offscreen-render", () => ({ renderSceneToCanvas: vi.fn(async () => null) }))
vi.mock("@/lib/verse-renderer", () => ({ drawLowerThird: vi.fn(), onThemeFontsLoaded: vi.fn(() => () => {}), renderVerse: vi.fn() }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createBlankRhemaDesign } from "@/design-engine/design-document-utils"
import type { DesignDocument, DesignInput, DesignVersion } from "@/design-engine/design-store"
import { designToScene } from "@/design-engine/rhema-scene"
import { applyCommand, type SaraswatiImageNode } from "@/vendor/avnac/saraswati"
import { DesignDocumentEditor } from "./design-document-editor"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useMediaStore } from "@/stores/media-store"
import type { MediaAssetStatus } from "@/types"

let root: Root | null = null

const imageAsset: MediaAssetStatus = {
  id: "welcome-image",
  kind: "image",
  name: "Welcome background",
  file: "welcome.png",
  hash: "a".repeat(64),
  size: 4,
  mime: "image/png",
  width: 1600,
  height: 900,
  duration_ms: null,
  source: "manual",
  source_ref: "",
  original_path: "",
  created_at: new Date(0).toISOString(),
  path: "/local-media/welcome.png",
  present: true,
}
const imageDataUrl = "data:image/png;base64,ZmFrZQ=="
const imageAssetUrl = `asset://localhost/%2Flocal-media%2F${imageAsset.hash}-welcome.png`

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  HTMLCanvasElement.prototype.getContext = (() => null) as never
  store.listVersions.mockResolvedValue([])
  store.saveDraft.mockReset()
  store.createVersion.mockReset()
  useSettingsStore.setState({ operatorName: "Tolu" })
  useMediaStore.setState({
    assets: [imageAsset], loading: false, loaded: true, error: null, urls: {},
    dataUrl: vi.fn(async () => imageDataUrl),
    fileUrl: vi.fn(async () => imageAssetUrl),
  })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function render(documentValue: DesignDocument, onReopen = vi.fn(async () => {})) {
  const element = document.createElement("div")
  document.body.appendChild(element)
  root = createRoot(element)
  await act(async () => root!.render(
    <DesignDocumentEditor
      document={documentValue}
      onSaved={() => {}}
      onReopen={onReopen}
      onVersionCreated={() => {}}
      onDuplicate={async () => {}}
    />,
  ))
  return element
}

function setValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  setter.call(element, value)
  element.dispatchEvent(new Event("input", { bubbles: true }))
}

function setTextAreaValue(element: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
  setter.call(element, value)
  element.dispatchEvent(new Event("input", { bubbles: true }))
}

function setSelectValue(element: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!
  setter.call(element, value)
  element.dispatchEvent(new Event("change", { bubbles: true }))
}

function documentFixture(): DesignDocument {
  return {
    id: "design-1",
    title: "Welcome",
    kind: "design",
    document: createBlankRhemaDesign("Welcome"),
    revision: 4,
    latestVersion: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }
}

describe("canonical design editor", () => {
  it("edits multiple pages in one saved scene graph and scopes layers to the selected page", async () => {
    const documentValue = documentFixture()
    store.saveDraft.mockImplementation(async (_id: string, _revision: number, input: DesignInput) => ({
      ...documentValue,
      revision: 5,
      document: input.document,
    }))
    const element = await render(documentValue)

    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Add page"]')!.click())
    const pageSelect = element.querySelector<HTMLSelectElement>('[aria-label="Design page"]')!
    expect(pageSelect.options).toHaveLength(2)
    expect(pageSelect.selectedOptions[0]?.textContent).toContain("Page 2")
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Text")!.click())
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())

    const saved = store.saveDraft.mock.calls[0]![2] as DesignInput
    const savedRoot = saved.document.scene.nodes[saved.document.scene.root]
    expect(savedRoot).toMatchObject({ type: "group", children: saved.document.pages?.map((page) => page.nodeId) })
    expect(saved.document.pages).toHaveLength(2)
    const firstPage = saved.document.pages![0]!
    const secondPage = saved.document.pages![1]!
    const secondGroup = saved.document.scene.nodes[secondPage.nodeId]
    if (!secondGroup || secondGroup.type !== "group") throw new Error("Expected the second page group")
    expect(secondGroup).toMatchObject({ type: "group", name: "Page 2" })
    expect(saved.document.scene.nodes[secondGroup.children[0]!]?.parentId).toBe(secondPage.nodeId)
    expect(designToScene(saved.document, firstPage.id).issues).toEqual([])
    expect(designToScene(saved.document, firstPage.id).scene.layers).toEqual([expect.objectContaining({ id: expect.any(String), kind: "color" })])
    expect(designToScene(saved.document, secondPage.id).issues).toEqual([])
    expect(designToScene(saved.document, secondPage.id).scene.layers).toEqual([expect.objectContaining({ kind: "text", text: "Your text" })])
  })

  it("duplicates and reorders pages without reusing their layer or binding IDs", async () => {
    const documentValue = documentFixture()
    store.saveDraft.mockImplementation(async (_id: string, _revision: number, input: DesignInput) => ({
      ...documentValue,
      revision: 5,
      document: input.document,
    }))
    const element = await render(documentValue)
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Add page"]')!.click())
    const pageSelect = element.querySelector<HTMLSelectElement>('[aria-label="Design page"]')!
    const originalPageId = pageSelect.options[0]!.value
    await act(async () => setSelectValue(pageSelect, originalPageId))
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Duplicate page"]')!.click())
    expect(pageSelect.options).toHaveLength(3)
    const duplicatePageId = pageSelect.value
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Move page earlier"]')!.click())
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())

    const saved = store.saveDraft.mock.calls[0]![2] as DesignInput
    const rootNode = saved.document.scene.nodes[saved.document.scene.root]
    if (!rootNode || rootNode.type !== "group") throw new Error("Expected the design root group")
    expect(saved.document.pages?.map((page) => page.id)).toEqual([originalPageId, duplicatePageId, expect.any(String)])
    expect(rootNode.children).toEqual(saved.document.pages?.map((page) => page.nodeId))
    const original = saved.document.pages![0]!
    const duplicate = saved.document.pages![1]!
    const originalGroup = saved.document.scene.nodes[original.nodeId]
    const duplicateGroup = saved.document.scene.nodes[duplicate.nodeId]
    if (!originalGroup || originalGroup.type !== "group" || !duplicateGroup || duplicateGroup.type !== "group") throw new Error("Expected page groups")
    const originalLayerId = originalGroup.children[0]!
    const duplicateLayerId = duplicateGroup.children[0]!
    expect(duplicateLayerId).not.toBe(originalLayerId)
    expect(saved.document.bindings[duplicateLayerId]).toMatchObject({ id: duplicateLayerId, kind: "color", color: "#111827" })
    expect(designToScene(saved.document, duplicate.id).issues).toEqual([])
  })

  it("adds a Library picture by content-addressed reference without embedding its bytes", async () => {
    const documentValue = documentFixture()
    store.saveDraft.mockImplementation(async (_id: string, _revision: number, input: DesignInput) => ({
      ...documentValue,
      revision: 5,
      document: input.document,
    }))
    const before = useBroadcastStore.getState()
    const liveSnapshot = {
      scenes: before.scenes,
      outputs: before.outputs,
      outputStatus: before.outputStatus,
      outputFrames: before.outputFrames,
      sceneReturn: before.sceneReturn,
      sceneTakes: before.sceneTakes,
      isLive: before.isLive,
      liveVerse: before.liveVerse,
      liveSlide: before.liveSlide,
    }
    const element = await render(documentValue)

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Image from Library")!.click())
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Add Welcome background as image layer"]')!.click())
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())

    const saved = store.saveDraft.mock.calls[0]![2] as DesignInput
    const image = Object.values(saved.document.scene.nodes).find((node) => node.type === "image")
    expect(image).toMatchObject({ type: "image", src: imageAssetUrl, width: 960, height: 540 })
    expect(saved.document.bindings[image!.id]).toMatchObject({
      kind: "picture", mediaId: imageAsset.id, imageUrl: imageAssetUrl,
    })
    expect(JSON.stringify(saved.document).length).toBeLessThan(4096)
    expect(JSON.stringify(saved.document)).not.toContain("data:image/")
    expect(designToScene(saved.document).issues).toEqual([])
    expect(designToScene(saved.document).scene.layers).toContainEqual(expect.objectContaining({
      id: image!.id, kind: "picture", mediaId: imageAsset.id, imageUrl: imageAssetUrl,
    }))
    const after = useBroadcastStore.getState()
    expect({
      scenes: after.scenes,
      outputs: after.outputs,
      outputStatus: after.outputStatus,
      outputFrames: after.outputFrames,
      sceneReturn: after.sceneReturn,
      sceneTakes: after.sceneTakes,
      isLive: after.isLive,
      liveVerse: after.liveVerse,
      liveSlide: after.liveSlide,
    }).toEqual(liveSnapshot)
  })

  it("keeps picture bindings aligned with undo and redo after replacement", async () => {
    const documentValue = documentFixture()
    const rootNode = documentValue.document.scene.nodes[documentValue.document.scene.root]
    if (!rootNode || rootNode.type !== "group") throw new Error("Fixture should have a root group")
    const priorUrl = "data:image/png;base64,b2xk"
    const prior: SaraswatiImageNode = {
      id: "existing-picture",
      parentId: rootNode.id,
      name: "Existing picture",
      visible: true,
      x: 125,
      y: 245,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      originX: "left",
      originY: "top",
      type: "image",
      width: 640,
      height: 360,
      src: priorUrl,
      cropX: 0,
      cropY: 0,
      clipPath: null,
    }
    documentValue.document.scene = applyCommand(documentValue.document.scene, { type: "ADD_NODE", node: prior })
    documentValue.document.bindings[prior.id] = {
      id: prior.id, kind: "picture", mediaId: "previous-image", imageUrl: priorUrl,
    }
    store.saveDraft.mockImplementation(async (_id: string, _revision: number, input: DesignInput) => ({
      ...documentValue,
      revision: 5,
      document: input.document,
    }))
    const element = await render(documentValue)

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === prior.name)!.click())
    expect([...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Replace image")).toBeTruthy()
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Replace image")!.click())
    await act(async () => element.querySelector<HTMLButtonElement>(`[aria-label="Replace with ${imageAsset.name}"]`)!.click())

    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Undo design edit"]')!.click())
    const createVersion = [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Create version"))!
    expect(createVersion.disabled).toBe(false)
    store.createVersion.mockResolvedValue({
      designId: documentValue.id,
      version: 1,
      fromRevision: documentValue.revision,
      title: documentValue.title,
      document: documentValue.document,
      note: null,
      savedBy: "Tolu",
      createdAt: new Date(0).toISOString(),
    })
    await act(async () => createVersion.click())
    expect(store.createVersion).toHaveBeenCalledWith(documentValue.id, documentValue.revision, undefined, "Tolu")

    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Redo design edit"]')!.click())
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())

    const redone = store.saveDraft.mock.calls[0]![2] as DesignInput
    expect(redone.document.scene.nodes[prior.id]).toMatchObject({
      type: "image", name: prior.name, x: prior.x, y: prior.y, width: prior.width, height: prior.height, src: imageAssetUrl,
    })
    expect(redone.document.bindings[prior.id]).toMatchObject({
      kind: "picture", mediaId: imageAsset.id, imageUrl: imageAssetUrl,
    })
    expect(designToScene(redone.document).issues).toEqual([])
  })

  it("saves a private draft against the opened revision without changing Live state", async () => {
    const documentValue = documentFixture()
    const before = useBroadcastStore.getState()
    const liveSnapshot = {
      scenes: before.scenes,
      outputs: before.outputs,
      outputStatus: before.outputStatus,
      outputFrames: before.outputFrames,
      sceneReturn: before.sceneReturn,
      sceneTakes: before.sceneTakes,
      isLive: before.isLive,
      liveVerse: before.liveVerse,
      liveSlide: before.liveSlide,
    }
    const saved = { ...documentValue, title: "Sunday welcome", revision: 5, document: { ...documentValue.document, meta: { ...documentValue.document.meta, name: "Sunday welcome" } } }
    store.saveDraft.mockImplementation(async (_id: string, _revision: number, input: DesignInput) => ({ ...saved, document: input.document }))
    const element = await render(documentValue)

    await act(async () => setValue(element.querySelector<HTMLInputElement>("#design-document-title")!, "Sunday welcome"))
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())

    expect(store.saveDraft).toHaveBeenCalledTimes(1)
    expect(store.saveDraft).toHaveBeenCalledWith("design-1", 4, expect.objectContaining({
      title: "Sunday welcome",
      document: expect.objectContaining({ meta: expect.objectContaining({ name: "Sunday welcome" }) }),
    }))
    const after = useBroadcastStore.getState()
    expect({
      scenes: after.scenes,
      outputs: after.outputs,
      outputStatus: after.outputStatus,
      outputFrames: after.outputFrames,
      sceneReturn: after.sceneReturn,
      sceneTakes: after.sceneTakes,
      isLive: after.isLive,
      liveVerse: after.liveVerse,
      liveSlide: after.liveSlide,
    }).toEqual(liveSnapshot)
    expect(element.textContent).toContain("Draft saved. Screens and Program are unchanged.")
  })

  it("creates an immutable version only from a clean saved revision and records the operator", async () => {
    const documentValue = documentFixture()
    const version: DesignVersion = {
      designId: documentValue.id,
      version: 1,
      fromRevision: documentValue.revision,
      title: documentValue.title,
      document: documentValue.document,
      note: "Sunday",
      savedBy: "Tolu",
      createdAt: new Date(0).toISOString(),
    }
    store.createVersion.mockResolvedValue(version)
    const element = await render(documentValue)
    await act(async () => setValue(element.querySelector<HTMLInputElement>('[aria-label="Version note"]')!, "Sunday"))
    expect([...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Create version"))!.disabled).toBe(false)

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Create version"))!.click())

    expect(store.createVersion).toHaveBeenCalledWith("design-1", 4, "Sunday", "Tolu")
    expect(element.textContent).toContain("Version 1 saved.")
  })

  it("moves a focused layer with arrow keys from the layer list", async () => {
    const documentValue = documentFixture()
    const rootNode = documentValue.document.scene.nodes[documentValue.document.scene.root]
    if (!rootNode || rootNode.type !== "group") throw new Error("Fixture should have a root group")
    const layerId = rootNode.children[0]
    if (!layerId) throw new Error("Fixture should have a layer")
    const layer = documentValue.document.scene.nodes[layerId]
    if (!layer || layer.type === "group") throw new Error("Fixture layer should be renderable")
    const originalX = layer.x
    store.saveDraft.mockImplementation(async (_id: string, _revision: number, input: DesignInput) => ({
      ...documentValue,
      revision: 5,
      document: input.document,
    }))
    const element = await render(documentValue)
    const layerButton = [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Background")!

    await act(async () => {
      layerButton.focus()
      layerButton.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
    })
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())

    const savedInput = store.saveDraft.mock.calls[0]![2] as DesignInput
    expect(savedInput.document.scene.nodes[layerId]).toMatchObject({ x: originalX + 1 })
  })

  it("saves an editable native ellipse and its fill as a design draft", async () => {
    const documentValue = documentFixture()
    const before = useBroadcastStore.getState()
    const liveSnapshot = {
      scenes: before.scenes,
      outputs: before.outputs,
      outputStatus: before.outputStatus,
      outputFrames: before.outputFrames,
      sceneReturn: before.sceneReturn,
      sceneTakes: before.sceneTakes,
      isLive: before.isLive,
      liveVerse: before.liveVerse,
      liveSlide: before.liveSlide,
    }
    store.saveDraft.mockImplementation(async (_id: string, _revision: number, input: DesignInput) => ({
      ...documentValue,
      revision: 5,
      document: input.document,
    }))
    const element = await render(documentValue)

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Ellipse")!.click())
    expect(element.textContent).not.toContain("cannot be used in Prepare")
    await act(async () => setValue(element.querySelectorAll<HTMLInputElement>('input[type="color"]')[0]!, "#d14c62"))
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())

    const input = store.saveDraft.mock.calls[0]![2] as DesignInput
    const ellipse = Object.values(input.document.scene.nodes).find((node) => node.type === "ellipse")
    expect(ellipse).toMatchObject({ type: "ellipse", fill: { type: "solid", color: "#d14c62" } })
    const prepared = designToScene(input.document)
    expect(prepared.issues).toEqual([])
    expect(prepared.scene.layers).toContainEqual(expect.objectContaining({ id: ellipse?.id, kind: "ellipse", color: "#d14c62" }))
    const after = useBroadcastStore.getState()
    expect({
      scenes: after.scenes,
      outputs: after.outputs,
      outputStatus: after.outputStatus,
      outputFrames: after.outputFrames,
      sceneReturn: after.sceneReturn,
      sceneTakes: after.sceneTakes,
      isLive: after.isLive,
      liveVerse: after.liveVerse,
      liveSlide: after.liveSlide,
    }).toEqual(liveSnapshot)
  })

  it("adds an editable rectangle that remains usable in a prepared scene", async () => {
    const documentValue = documentFixture()
    store.saveDraft.mockImplementation(async (_id: string, _revision: number, input: DesignInput) => ({
      ...documentValue,
      revision: 5,
      document: input.document,
    }))
    const element = await render(documentValue)

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Rectangle")!.click())
    expect(element.textContent).not.toContain("cannot be used in Prepare")
    await act(async () => setValue(element.querySelectorAll<HTMLInputElement>('input[type="color"]')[0]!, "#d14c62"))
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())

    const input = store.saveDraft.mock.calls[0]![2] as DesignInput
    const rectangle = Object.values(input.document.scene.nodes).find((node) => node.type === "rect" && node.name === "Rectangle")
    expect(rectangle).toMatchObject({ type: "rect", fill: { type: "solid", color: "#d14c62" } })
    expect(input.document.bindings[rectangle!.id]).toMatchObject({ id: rectangle!.id, kind: "color" })
    const prepared = designToScene(input.document)
    expect(prepared.issues).toEqual([])
    expect(prepared.scene.layers).toContainEqual(expect.objectContaining({ id: rectangle?.id, kind: "color", color: "#d14c62" }))
  })

  it("aligns a selected layer to the active page and keeps each move undoable", async () => {
    const documentValue = documentFixture()
    store.saveDraft.mockImplementation(async (_id: string, _revision: number, input: DesignInput) => ({
      ...documentValue,
      revision: 5,
      document: input.document,
    }))
    const element = await render(documentValue)
    const click = async (label: string) => act(async () => element.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click())
    const coordinates = () => [...element.querySelectorAll<HTMLInputElement>('input[type="number"]')].slice(0, 2).map((input) => Number(input.value))

    await click("Add page")
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Rectangle")!.click())
    expect(coordinates()).toEqual([672, 378])

    await click("Align left to page")
    expect(coordinates()[0]).toBe(0)
    await click("Center horizontally on page")
    expect(coordinates()[0]).toBe(680)
    await click("Align right to page")
    expect(coordinates()[0]).toBe(1360)

    await click("Align top to page")
    expect(coordinates()[1]).toBe(0)
    await click("Center vertically on page")
    expect(coordinates()[1]).toBe(410)
    await click("Align bottom to page")
    expect(coordinates()[1]).toBe(820)
    await click("Undo design edit")
    expect(coordinates()).toEqual([1360, 410])

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())
    const saved = store.saveDraft.mock.calls[0]![2] as DesignInput
    const rectangle = Object.values(saved.document.scene.nodes).find((node) => node.type === "rect" && node.name === "Rectangle")
    expect(rectangle).toMatchObject({ x: 1360, y: 410 })
    const activePageId = saved.document.pages?.[1]?.id
    expect(activePageId).toBeDefined()
    const prepared = designToScene(saved.document, activePageId)
    expect(prepared.issues).toEqual([])
    expect(prepared.scene.layers).toContainEqual(expect.objectContaining({ id: rectangle?.id, kind: "color" }))
  })

  it("duplicates a live-feed layer with its binding in one undoable edit", async () => {
    const documentValue = documentFixture()
    const before = useBroadcastStore.getState()
    const liveSnapshot = {
      scenes: before.scenes,
      outputs: before.outputs,
      outputStatus: before.outputStatus,
      outputFrames: before.outputFrames,
      sceneTakes: before.sceneTakes,
      isLive: before.isLive,
      liveVerse: before.liveVerse,
      liveSlide: before.liveSlide,
    }
    store.saveDraft.mockImplementation(async (_id: string, _revision: number, input: DesignInput) => ({
      ...documentValue,
      revision: 5,
      document: input.document,
    }))
    const element = await render(documentValue)
    const click = async (label: string) => act(async () => element.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click())

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Live content")!.click())
    await click("Follow Bible")
    await act(async () => setSelectValue(element.querySelector<HTMLSelectElement>('[aria-label="Live content language"]')!, "second"))
    await click("Duplicate selected layer")
    expect(element.textContent).toContain("Live content copy")
    await click("Undo design edit")
    expect(element.textContent).not.toContain("Live content copy")
    await click("Redo design edit")
    expect(element.textContent).toContain("Live content copy")
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())

    const saved = store.saveDraft.mock.calls[0]![2] as DesignInput
    const feeds = Object.values(saved.document.scene.nodes).filter((node) => node.type === "rect" && (node.name === "Live content" || node.name === "Live content copy"))
    expect(feeds).toHaveLength(2)
    const source = feeds.find((node) => node.type === "rect" && node.name === "Live content")
    const duplicate = feeds.find((node) => node.type === "rect" && node.name === "Live content copy")
    if (source?.type !== "rect" || duplicate?.type !== "rect") throw new Error("Expected both live-feed rectangles")
    expect(duplicate).toMatchObject({ x: source.x + 24, y: source.y + 24 })
    expect(saved.document.bindings[duplicate.id]).toEqual({ id: duplicate.id, kind: "feed", shows: ["bible"], language: "second" })
    const prepared = designToScene(saved.document)
    expect(prepared.issues).toEqual([])
    expect(prepared.scene.layers).toContainEqual(expect.objectContaining({ id: duplicate.id, kind: "feed" }))

    const after = useBroadcastStore.getState()
    expect({
      scenes: after.scenes,
      outputs: after.outputs,
      outputStatus: after.outputStatus,
      outputFrames: after.outputFrames,
      sceneTakes: after.sceneTakes,
      isLive: after.isLive,
      liveVerse: after.liveVerse,
      liveSlide: after.liveSlide,
    }).toEqual(liveSnapshot)
  })

  it("saves and versions native Avnac text as a usable private Prepare scene", async () => {
    const documentValue = documentFixture()
    let savedDocument: DesignDocument | null = null
    store.saveDraft.mockImplementation(async (_id: string, _revision: number, input: DesignInput) => {
      savedDocument = { ...documentValue, title: input.title, revision: 5, document: input.document }
      return savedDocument
    })
    store.createVersion.mockImplementation(async () => ({
      designId: documentValue.id,
      version: 1,
      fromRevision: 5,
      title: savedDocument?.title ?? documentValue.title,
      document: savedDocument?.document ?? documentValue.document,
      note: null,
      savedBy: "Tolu",
      createdAt: new Date(0).toISOString(),
    }))
    const element = await render(documentValue)
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Text")!.click())
    const textArea = element.querySelector<HTMLTextAreaElement>('[aria-label="Text content"]')!
    await act(async () => setTextAreaValue(textArea, "Welcome to Sunday worship"))
    await act(async () => setValue(element.querySelector<HTMLInputElement>("#design-document-title")!, "Sunday welcome"))
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())
    expect(store.saveDraft).toHaveBeenCalledWith("design-1", 4, expect.objectContaining({ title: "Sunday welcome" }))
    const savedInput = store.saveDraft.mock.calls[0]![2] as DesignInput
    const textNode = Object.values(savedInput.document.scene.nodes).find((node) => node.type === "text")
    expect(textNode).toMatchObject({ text: "Welcome to Sunday worship" })
    expect(savedInput.document.bindings[textNode!.id]).toMatchObject({ kind: "text", textBoxHeight: 216 })
    expect(designToScene(savedInput.document)).toMatchObject({ issues: [] })
    expect(designToScene(savedInput.document).scene.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "text", text: "Welcome to Sunday worship", box: expect.objectContaining({ h: 20 }) }),
    ]))
    expect(element.textContent).not.toContain("cannot be used in Prepare")
    expect(element.textContent).not.toContain("Some Avnac features are not supported by Rhema scene output yet.")

    const createButton = [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Create version"))!
    expect(createButton.disabled, element.textContent).toBe(false)
    await act(async () => createButton.click())
    expect(store.createVersion).toHaveBeenCalledWith("design-1", 5, undefined, "Tolu")
  })

  it("saves explicit live-feed sources and language as a private design binding", async () => {
    const documentValue = documentFixture()
    const before = useBroadcastStore.getState()
    const liveState = {
      scenes: before.scenes,
      outputs: before.outputs,
      outputStatus: before.outputStatus,
      outputFrames: before.outputFrames,
      sceneTakes: before.sceneTakes,
      isLive: before.isLive,
      liveVerse: before.liveVerse,
      liveSlide: before.liveSlide,
    }
    store.saveDraft.mockImplementation(async (_id: string, _revision: number, input: DesignInput) => ({
      ...documentValue,
      revision: 5,
      document: input.document,
    }))
    const element = await render(documentValue)

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Live content")!.click())
    expect(element.querySelector('[aria-label="Live content binding"]')).not.toBeNull()
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Follow Bible"]')!.click())
    await act(async () => setSelectValue(element.querySelector<HTMLSelectElement>('[aria-label="Live content language"]')!, "second"))
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())

    const input = store.saveDraft.mock.calls[0]![2] as DesignInput
    const feedNode = Object.values(input.document.scene.nodes).find((node) => node.name === "Live content")!
    expect(input.document.bindings[feedNode.id]).toMatchObject({ kind: "feed", shows: ["bible"], language: "second" })
    expect(designToScene(input.document).issues).toEqual([])
    expect(designToScene(input.document).scene.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "feed", shows: ["bible"], language: "second" }),
    ]))
    const after = useBroadcastStore.getState()
    expect({
      scenes: after.scenes,
      outputs: after.outputs,
      outputStatus: after.outputStatus,
      outputFrames: after.outputFrames,
      sceneTakes: after.sceneTakes,
      isLive: after.isLive,
      liveVerse: after.liveVerse,
      liveSlide: after.liveSlide,
    }).toEqual(liveState)
  })

  it("removes a deleted text node's Rhema binding before saving the draft", async () => {
    const documentValue = documentFixture()
    store.saveDraft.mockImplementation(async (_id: string, _revision: number, input: DesignInput) => ({
      ...documentValue,
      revision: 5,
      document: input.document,
    }))
    const element = await render(documentValue)

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Text")!.click())
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Delete selected layer"]')!.click())
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())

    const input = store.saveDraft.mock.calls[0]![2] as DesignInput
    expect(Object.values(input.document.scene.nodes).some((node) => node.type === "text")).toBe(false)
    expect(Object.keys(input.document.bindings)).toEqual(Object.keys(documentValue.document.bindings))
  })

  it("undoes a text deletion with its binding intact so the design remains usable", async () => {
    const documentValue = documentFixture()
    store.saveDraft.mockImplementation(async (_id: string, _revision: number, input: DesignInput) => ({
      ...documentValue,
      revision: 5,
      document: input.document,
    }))
    const element = await render(documentValue)

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Text")!.click())
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Delete selected layer"]')!.click())
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Undo design edit"]')!.click())
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())

    const input = store.saveDraft.mock.calls[0]![2] as DesignInput
    const textNode = Object.values(input.document.scene.nodes).find((node) => node.type === "text")
    expect(textNode).toBeDefined()
    expect(input.document.bindings[textNode!.id]).toMatchObject({ kind: "text" })
    expect(designToScene(input.document).issues).toEqual([])
    expect(designToScene(input.document).scene.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: textNode!.id, kind: "text", text: "Your text" }),
    ]))
  })
})
