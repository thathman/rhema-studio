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

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createBlankRhemaDesign } from "@/design-engine/design-document-utils"
import type { DesignDocument, DesignInput, DesignVersion } from "@/design-engine/design-store"
import { designToScene } from "@/design-engine/rhema-scene"
import { DesignDocumentEditor } from "./design-document-editor"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"

let root: Root | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  HTMLCanvasElement.prototype.getContext = (() => null) as never
  store.listVersions.mockResolvedValue([])
  store.saveDraft.mockReset()
  store.createVersion.mockReset()
  useSettingsStore.setState({ operatorName: "Tolu" })
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
