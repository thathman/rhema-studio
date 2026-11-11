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
import { createBlankRhemaDesign, createLiveFeedLayer } from "@/design-engine/design-document-utils"
import type { DesignDocument, DesignInput, DesignVersion } from "@/design-engine/design-store"
import { designToScene, VIDEO_LAYER_PLACEHOLDER_COLOR } from "@/design-engine/rhema-scene"
import { applyCommand, type SaraswatiImageNode } from "@/vendor/avnac/saraswati"
import { DesignDocumentEditor } from "./design-document-editor"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useTimerStore } from "@/stores/timer-store"
import { useSettingsStore } from "@/stores/settings-store"
import { renderSceneToCanvas } from "@/vendor/avnac/renderer/offscreen-render"
import { useRouterHealth } from "@/lib/cameras"
import { defaultBrandKit } from "@/lib/brand-kit"
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
const videoAsset: MediaAssetStatus = {
  id: "sermon-video",
  kind: "video",
  name: "Sermon clip",
  file: "sermon-clip.mp4",
  hash: "b".repeat(64),
  size: 1024,
  mime: "video/mp4",
  width: 1280,
  height: 720,
  duration_ms: 18_000,
  source: "manual",
  source_ref: "",
  original_path: "",
  created_at: new Date(0).toISOString(),
  path: "/local-media/sermon-clip.mp4",
  present: true,
}
const imageDataUrl = "data:image/png;base64,ZmFrZQ=="
const imageAssetUrl = `asset://localhost/%2Flocal-media%2F${imageAsset.hash}-welcome.png`
const videoAssetUrl = `asset://localhost/%2Flocal-media%2F${videoAsset.hash}-sermon-clip.mp4`

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  HTMLCanvasElement.prototype.getContext = (() => null) as never
  vi.mocked(renderSceneToCanvas).mockClear()
  store.listVersions.mockResolvedValue([])
  store.saveDraft.mockReset()
  store.createVersion.mockReset()
  useSettingsStore.setState({ operatorName: "Tolu", brandKit: defaultBrandKit() })
  useBroadcastStore.setState({
    isLive: false, liveVerse: null, liveSourceVerse: null, liveItem: null, liveSlide: null, liveItemId: null,
    sources: {}, stateSources: {}, ticker: null, lowerThird: null, countdowns: null,
  })
  useTimerStore.setState({ timer: { durationMs: 0, startedAt: null, accumulatedMs: 0 }, tick: 0 })
  useSettingsStore.setState({ cameras: [] })
  useRouterHealth.setState({ status: null, checked: false })
  useMediaStore.setState({
    assets: [imageAsset, videoAsset], loading: false, loaded: true, error: null, urls: {},
    dataUrl: vi.fn(async () => imageDataUrl),
    fileUrl: vi.fn(async (id: string) => id === videoAsset.id ? videoAssetUrl : imageAssetUrl),
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

async function addLiveLayer(element: HTMLElement, name: string) {
  await act(async () => {
    const trigger = element.querySelector<HTMLButtonElement>('[aria-label="Add live design layer"]')!
    const pointerDown = new Event("pointerdown", { bubbles: true })
    Object.defineProperties(pointerDown, { button: { value: 0 }, ctrlKey: { value: false } })
    trigger.dispatchEvent(pointerDown)
  })
  const item = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((candidate) => candidate.textContent?.trim() === name)
  if (!item) throw new Error(`Live layer menu item "${name}" was not rendered`)
  await act(async () => item.click())
}

function setValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  setter.call(element, value)
  element.dispatchEvent(new Event("input", { bubbles: true }))
}

function inputForLabel(element: HTMLElement, labelText: string): HTMLInputElement {
  const label = [...element.querySelectorAll("label")].find((candidate) => candidate.textContent?.trim().startsWith(labelText))
  const input = label?.querySelector("input")
  if (!(input instanceof HTMLInputElement)) throw new Error(`Input "${labelText}" was not rendered`)
  return input
}

async function commitNumberInput(element: HTMLElement, labelText: string, value: string) {
  const input = inputForLabel(element, labelText)
  await act(async () => {
    setValue(input, value)
    input.focus()
    input.blur()
  })
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
  it("copies Brand Kit text tokens into the editable draft and versions it without changing Live", async () => {
    const documentValue = documentFixture()
    const kit = {
      ...defaultBrandKit(),
      colors: { primary: "#224466", accent: "#dda355", text: "#f4f4f4", background: "#101820" },
      fonts: { heading: "Inter Variable", body: "Geist Mono" },
    }
    useSettingsStore.setState({ brandKit: kit })
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
    store.createVersion.mockResolvedValue({
      designId: documentValue.id,
      version: 1,
      fromRevision: 5,
      title: documentValue.title,
      document: documentValue.document,
      note: null,
      savedBy: "Tolu",
      createdAt: new Date(0).toISOString(),
    })
    const element = await render(documentValue)

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Text")!.click())
    const fontInput = [...element.querySelectorAll<HTMLInputElement>("input")].find((input) => input.value === "Arial")!
    const textColourInput = element.querySelector<HTMLInputElement>('input[type="color"]')!
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Apply Brand Kit heading font"]')!.click())
    expect(fontInput.value).toBe(kit.fonts.heading)
    await act(async () => useSettingsStore.setState({ brandKit: { ...kit, fonts: { ...kit.fonts, heading: "Geist Variable" } } }))
    expect(fontInput.value).toBe(kit.fonts.heading)
    await act(async () => useSettingsStore.setState({ brandKit: kit }))
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Apply Brand Kit body font"]')!.click())
    expect(fontInput.value).toBe(kit.fonts.body)
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Apply Brand Kit heading font"]')!.click())
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Apply Brand Kit text colour"]')!.click())
    expect(textColourInput.value).toBe(kit.colors.text)
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Apply Brand Kit accent colour"]')!.click())
    expect(textColourInput.value).toBe(kit.colors.accent)
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())

    const saved = store.saveDraft.mock.calls[0]![2] as DesignInput
    const text = Object.values(saved.document.scene.nodes).find((node) => node.type === "text")
    expect(text).toMatchObject({ fontFamily: kit.fonts.heading, color: { type: "solid", color: kit.colors.accent } })
    expect(element.textContent).toContain("Draft saved. Screens and Program are unchanged.")
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Create version"))!.click())
    expect(store.createVersion).toHaveBeenCalledWith(documentValue.id, 5, undefined, "Tolu")
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

  it("copies each Brand Kit colour token into a selected shape fill as a draft edit", async () => {
    const documentValue = documentFixture()
    const kit = {
      ...defaultBrandKit(),
      colors: { primary: "#224466", accent: "#dda355", text: "#f4f4f4", background: "#101820" },
    }
    useSettingsStore.setState({ brandKit: kit })
    const before = useBroadcastStore.getState()
    store.saveDraft.mockImplementation(async (_id: string, _revision: number, input: DesignInput) => ({
      ...documentValue,
      revision: 5,
      document: input.document,
    }))
    const element = await render(documentValue)

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Rectangle")!.click())
    const fillInput = element.querySelector<HTMLInputElement>('input[type="color"]')!
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Apply Brand Kit primary fill"]')!.click())
    expect(fillInput.value).toBe(kit.colors.primary)
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Undo design edit"]')!.click())
    expect(fillInput.value).toBe("#3157a4")
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Redo design edit"]')!.click())
    expect(fillInput.value).toBe(kit.colors.primary)
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Apply Brand Kit accent fill"]')!.click())
    expect(fillInput.value).toBe(kit.colors.accent)
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Apply Brand Kit text fill"]')!.click())
    expect(fillInput.value).toBe(kit.colors.text)
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Apply Brand Kit background fill"]')!.click())
    expect(fillInput.value).toBe(kit.colors.background)
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())

    const saved = store.saveDraft.mock.calls[0]![2] as DesignInput
    const shape = Object.values(saved.document.scene.nodes).find((node) => node.type === "rect" && node.name === "Rectangle")
    expect(shape).toMatchObject({ fill: { type: "solid", color: kit.colors.background } })
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
    }).toEqual({
      scenes: before.scenes,
      outputs: before.outputs,
      outputStatus: before.outputStatus,
      outputFrames: before.outputFrames,
      sceneReturn: before.sceneReturn,
      sceneTakes: before.sceneTakes,
      isLive: before.isLive,
      liveVerse: before.liveVerse,
      liveSlide: before.liveSlide,
    })
  })

  it("replaces a gradient fill with a solid Brand Kit color in the draft only", async () => {
    const documentValue = documentFixture()
    const originalBackground = Object.values(documentValue.document.scene.nodes).find((node) => node.type === "rect" && node.name === "Background")
    if (originalBackground?.type !== "rect") throw new Error("Expected the fixture background rectangle")
    documentValue.document.scene = applyCommand(documentValue.document.scene, {
      type: "SET_NODE_FILL",
      id: originalBackground.id,
      fill: {
        type: "gradient",
        css: "linear-gradient(90deg, #101820, #224466)",
        stops: [{ color: "#101820", offset: 0 }, { color: "#224466", offset: 1 }],
        angle: 90,
      },
    })
    const gradientBackground = documentValue.document.scene.nodes[originalBackground.id]
    if (gradientBackground?.type !== "rect" || gradientBackground.fill.type !== "gradient") {
      throw new Error("Expected the fixture background to have a gradient fill")
    }
    const kit = {
      ...defaultBrandKit(),
      colors: { primary: "#335577", accent: "#dda355", text: "#f4f4f4", background: "#101820" },
    }
    useSettingsStore.setState({ brandKit: kit })
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

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Background")!.click())
    expect(element.querySelector<HTMLSelectElement>('[aria-label="Fill paint style"]')?.value).toBe("gradient")
    expect(element.textContent).toContain("including a gradient fill, with a solid color copied into this draft")
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Apply Brand Kit primary fill"]')!.click())
    expect(element.querySelector<HTMLSelectElement>('[aria-label="Fill paint style"]')?.value).toBe("solid")
    expect(element.querySelector<HTMLInputElement>('[aria-label="Fill solid colour"]')?.value).toBe(kit.colors.primary)
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())

    const saved = store.saveDraft.mock.calls[0]![2] as DesignInput
    expect(saved.document.scene.nodes[gradientBackground.id]).toEqual({
      ...gradientBackground,
      fill: { type: "solid", color: kit.colors.primary },
    })
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

  it("edits Rhema-supported linear gradients on the artboard and a colour layer", async () => {
    const documentValue = documentFixture()
    store.saveDraft.mockImplementation(async (_id: string, _revision: number, input: DesignInput) => ({
      ...documentValue,
      revision: 5,
      document: input.document,
    }))
    const before = useBroadcastStore.getState()
    const liveSnapshot = { scenes: before.scenes, outputs: before.outputs, outputStatus: before.outputStatus, outputFrames: before.outputFrames, sceneReturn: before.sceneReturn, sceneTakes: before.sceneTakes, isLive: before.isLive, liveVerse: before.liveVerse, liveSlide: before.liveSlide }
    const element = await render(documentValue)

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Background")!.click())
    await act(async () => setSelectValue(element.querySelector<HTMLSelectElement>('[aria-label="Fill paint style"]')!, "gradient"))
    await commitNumberInput(element, "Fill gradient angle (deg)", "135")
    await act(async () => {
      const input = element.querySelector<HTMLInputElement>('[aria-label="Fill gradient start colour"]')!
      setValue(input, "#0b1a3a")
      input.focus()
      input.blur()
    })
    await act(async () => {
      const input = element.querySelector<HTMLInputElement>('[aria-label="Fill gradient end colour"]')!
      setValue(input, "#ffffff")
      input.focus()
      input.blur()
    })

    await act(async () => setSelectValue(element.querySelector<HTMLSelectElement>('[aria-label="Artboard background paint style"]')!, "gradient"))
    await commitNumberInput(element, "Artboard background gradient angle (deg)", "45")
    await act(async () => {
      const input = element.querySelector<HTMLInputElement>('[aria-label="Artboard background gradient start colour"]')!
      setValue(input, "#112233")
      input.focus()
      input.blur()
    })
    await act(async () => {
      const input = element.querySelector<HTMLInputElement>('[aria-label="Artboard background gradient end colour"]')!
      setValue(input, "#ddeeff")
      input.focus()
      input.blur()
    })
    expect(element.textContent).not.toContain("Gradient is not supported for Rhema output")
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())

    const saved = store.saveDraft.mock.calls[0]![2] as DesignInput
    const fill = Object.values(saved.document.scene.nodes).find((node) => node.type === "rect" && node.name === "Background")
    expect(fill?.type === "rect" && fill.fill).toMatchObject({ type: "gradient", angle: 135, stops: [{ color: "#0b1a3a", offset: 0 }, { color: "#ffffff", offset: 1 }] })
    const prepared = designToScene(saved.document)
    expect(prepared.issues).toEqual([])
    expect(prepared.scene.backgroundGradient).toEqual({ angle: 45, stops: [{ color: "#112233", offset: 0 }, { color: "#ddeeff", offset: 1 }] })
    expect(prepared.scene.layers.find((layer) => layer.id === fill?.id)?.gradient).toEqual({ angle: 135, stops: [{ color: "#0b1a3a", offset: 0 }, { color: "#ffffff", offset: 1 }] })
    const after = useBroadcastStore.getState()
    expect({ scenes: after.scenes, outputs: after.outputs, outputStatus: after.outputStatus, outputFrames: after.outputFrames, sceneReturn: after.sceneReturn, sceneTakes: after.sceneTakes, isLive: after.isLive, liveVerse: after.liveVerse, liveSlide: after.liveSlide }).toEqual(liveSnapshot)
  })

  it("keeps intermediate gradient stops when editing the endpoint colours", async () => {
    const documentValue = documentFixture()
    const background = Object.values(documentValue.document.scene.nodes).find((node) => node.type === "rect" && node.name === "Background")
    if (background?.type !== "rect") throw new Error("Expected the fixture background rectangle")
    documentValue.document.scene = applyCommand(documentValue.document.scene, {
      type: "SET_NODE_FILL",
      id: background.id,
      fill: {
        type: "gradient",
        css: "linear-gradient(90deg, #111111 0%, #777777 50%, #eeeeee 100%)",
        stops: [{ color: "#111111", offset: 0 }, { color: "#777777", offset: 0.5 }, { color: "#eeeeee", offset: 1 }],
        angle: 90,
      },
    })
    store.saveDraft.mockImplementation(async (_id: string, _revision: number, input: DesignInput) => ({
      ...documentValue,
      revision: 5,
      document: input.document,
    }))
    const element = await render(documentValue)

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Background")!.click())
    await commitNumberInput(element, "Fill gradient angle (deg)", "225")
    await act(async () => {
      const input = element.querySelector<HTMLInputElement>('[aria-label="Fill gradient start colour"]')!
      setValue(input, "#123456")
      input.focus()
      input.blur()
    })
    await act(async () => {
      const input = element.querySelector<HTMLInputElement>('[aria-label="Fill gradient end colour"]')!
      setValue(input, "#abcdef")
      input.focus()
      input.blur()
    })
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())

    const saved = store.saveDraft.mock.calls[0]![2] as DesignInput
    const edited = saved.document.scene.nodes[background.id]
    expect(edited?.type === "rect" && edited.fill).toEqual({
      type: "gradient",
      css: "linear-gradient(225deg, #123456 0%, #777777 50%, #abcdef 100%)",
      angle: 225,
      stops: [{ color: "#123456", offset: 0 }, { color: "#777777", offset: 0.5 }, { color: "#abcdef", offset: 1 }],
    })
  })

  it("exposes ellipse gradient editing only for an output-compatible ellipse", async () => {
    const documentValue = documentFixture()
    store.saveDraft.mockImplementation(async (_id: string, _revision: number, input: DesignInput) => ({
      ...documentValue,
      revision: 5,
      document: input.document,
    }))
    const element = await render(documentValue)

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Ellipse")!.click())
    await act(async () => setSelectValue(element.querySelector<HTMLSelectElement>('[aria-label="Fill paint style"]')!, "gradient"))
    await commitNumberInput(element, "Fill gradient angle (deg)", "270")
    await act(async () => {
      const input = element.querySelector<HTMLInputElement>('[aria-label="Fill gradient start colour"]')!
      setValue(input, "#d14c62")
      input.focus()
      input.blur()
    })
    await act(async () => {
      const input = element.querySelector<HTMLInputElement>('[aria-label="Fill gradient end colour"]')!
      setValue(input, "#3157a4")
      input.focus()
      input.blur()
    })
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())

    const saved = store.saveDraft.mock.calls[0]![2] as DesignInput
    const ellipse = Object.values(saved.document.scene.nodes).find((node) => node.type === "ellipse")
    expect(ellipse?.type === "ellipse" && ellipse.fill).toMatchObject({ type: "gradient", angle: 270, stops: [{ color: "#d14c62", offset: 0 }, { color: "#3157a4", offset: 1 }] })
    const prepared = designToScene(saved.document)
    expect(prepared.issues).toEqual([])
    expect(prepared.scene.layers.find((layer) => layer.id === ellipse?.id)?.gradient).toEqual({ angle: 270, stops: [{ color: "#d14c62", offset: 0 }, { color: "#3157a4", offset: 1 }] })
  })

  it("edits a Library picture crop, rounded corners and oval mask in the draft and saved output", async () => {
    const documentValue = documentFixture()
    store.saveDraft.mockImplementation(async (_id: string, _revision: number, input: DesignInput) => ({
      ...documentValue,
      revision: 5,
      document: input.document,
    }))
    const liveScenes = useBroadcastStore.getState().scenes
    const element = await render(documentValue)

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Image from Library")!.click())
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Add Welcome background as image layer"]')!.click())
    expect(element.querySelector('[aria-label="Picture appearance"]')).toBeTruthy()

    await commitNumberInput(element, "Crop left (px)", "100")
    await commitNumberInput(element, "Crop top (px)", "50")
    await commitNumberInput(element, "Visible width (px)", "800")
    await commitNumberInput(element, "Visible height (px)", "400")
    await commitNumberInput(element, "Corner radius (px)", "32")
    await act(async () => setSelectValue(element.querySelector<HTMLSelectElement>('[aria-label="Picture shape mask"]')!, "ellipse"))
    await commitNumberInput(element, "Width", "720")
    await commitNumberInput(element, "Height", "400")
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())

    const saved = store.saveDraft.mock.calls[0]![2] as DesignInput
    const image = Object.values(saved.document.scene.nodes).find((node) => node.type === "image")
    expect(image).toMatchObject({ type: "image", width: 720, height: 400, cropX: 100, cropY: 50, cropWidth: 800, cropHeight: 400, borderRadius: 32 })
    expect(image?.type === "image" && image.clipPath).toMatchObject({ type: "ellipse", x: 360, y: 200, width: 720, height: 400 })
    const prepared = designToScene(saved.document)
    expect(prepared.issues).toEqual([])
    expect(prepared.scene.layers.find((layer) => layer.id === image?.id)?.imageDraw).toMatchObject({
      width: 720,
      height: 400,
      cropX: 100,
      cropY: 50,
      cropWidth: 800,
      cropHeight: 400,
      radius: 32,
      clips: [{ type: "ellipse", x: 360, y: 200, width: 720, height: 400 }],
    })
    expect(useBroadcastStore.getState().scenes).toEqual(liveScenes)
  })

  it("adds a Library video as a private editable layer with a scene-compatible media binding", async () => {
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

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Video from Library")!.click())
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Add Sermon clip as video layer"]')!.click())
    const preview = element.querySelector<HTMLVideoElement>('video[aria-label="Local preview, starts muted: Sermon clip"]')!
    expect(preview).toBeDefined()
    expect(preview.muted).toBe(true)
    expect(preview.loop).toBe(true)
    expect(preview.playsInline).toBe(true)
    expect(preview.getAttribute("src")).toBe(videoAssetUrl)

    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Undo design edit"]')!.click())
    expect(element.querySelector('section[aria-label="Video layer media preview"]')).toBeNull()
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Redo design edit"]')!.click())
    expect(element.querySelector('video[aria-label="Local preview, starts muted: Sermon clip"]')).toBeDefined()

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())
    const saved = store.saveDraft.mock.calls[0]![2] as DesignInput
    const videoNode = Object.values(saved.document.scene.nodes).find((node) => node.type === "rect" && node.name === "Sermon clip")
    expect(videoNode).toBeDefined()
    expect(saved.document.bindings[videoNode!.id]).toMatchObject({
      kind: "video",
      mediaId: videoAsset.id,
      videoUrl: videoAssetUrl,
      mediaFile: videoAsset.file,
    })
    const prepared = designToScene(saved.document)
    expect(prepared.issues).toEqual([])
    expect(prepared.scene.layers).toContainEqual(expect.objectContaining({
      id: videoNode!.id,
      kind: "video",
      mediaId: videoAsset.id,
      videoUrl: videoAssetUrl,
      mediaFile: videoAsset.file,
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

  it("preserves existing bound layers when undoing and redoing another bound layer", async () => {
    const documentValue = documentFixture()
    store.saveDraft.mockImplementation(async (_id: string, _revision: number, input: DesignInput) => ({
      ...documentValue,
      revision: 5,
      document: input.document,
    }))
    const element = await render(documentValue)

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Video from Library")!.click())
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Add Sermon clip as video layer"]')!.click())
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Text")!.click())
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Undo design edit"]')!.click())
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Redo design edit"]')!.click())
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())

    const saved = store.saveDraft.mock.calls[0]![2] as DesignInput
    const videoNode = Object.values(saved.document.scene.nodes).find((node) => node.name === "Sermon clip")
    const textNode = Object.values(saved.document.scene.nodes).find((node) => node.type === "text")
    expect(videoNode).toBeDefined()
    expect(textNode).toBeDefined()
    expect(saved.document.bindings[videoNode!.id]).toMatchObject({
      kind: "video",
      mediaId: videoAsset.id,
      videoUrl: videoAssetUrl,
    })
    expect(saved.document.bindings[textNode!.id]).toMatchObject({ kind: "text" })
    expect(designToScene(saved.document).issues).toEqual([])
  })

  it("shows a missing Library video as a blocking editor issue instead of a stale preview", async () => {
    const documentValue = documentFixture()
    const videoNode = Object.values(documentValue.document.scene.nodes).find((node) => node.type === "rect")
    if (!videoNode || videoNode.type !== "rect") throw new Error("Expected a design rectangle for the video layer")
    documentValue.document.scene.nodes[videoNode.id] = {
      ...videoNode,
      name: "Missing sermon clip",
      fill: { type: "solid", color: VIDEO_LAYER_PLACEHOLDER_COLOR },
    }
    documentValue.document.bindings[videoNode.id] = {
      id: videoNode.id,
      kind: "video",
      mediaId: videoAsset.id,
      videoUrl: videoAssetUrl,
      mediaFile: videoAsset.file,
    }
    useMediaStore.setState({ assets: [{ ...videoAsset, present: false }], loaded: true, error: null })
    const element = await render(documentValue)

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Missing sermon clip")!.click())

    expect(element.querySelector('[role="alert"]')?.textContent).toContain("missing on this computer")
    expect(element.querySelector('video[aria-label="Local preview, starts muted: Missing sermon clip"]')).toBeNull()
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

  it("adds clock, ticker, lower-third and Brand Kit logo layers from one compact menu without changing Live", async () => {
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

    await addLiveLayer(element, "Service clock")
    expect(element.querySelector('[aria-label="Clock layer settings"]')?.textContent).toContain("host supplies the clock")
    await addLiveLayer(element, "Ticker")
    expect(element.querySelector('[aria-label="Ticker layer settings"]')?.textContent).toContain("ticker currently running in Production")
    await addLiveLayer(element, "Lower third")
    expect(element.querySelector('[aria-label="Lower third layer settings"]')?.textContent).toContain("presenter name and title currently on air")
    await addLiveLayer(element, "Brand Kit logo")
    expect(element.querySelector('[aria-label="Brand Kit logo layer settings"]')?.textContent).toContain("logo saved in Settings → Brand Kit")
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())

    const input = store.saveDraft.mock.calls[0]![2] as DesignInput
    const liveLayers = Object.values(input.document.bindings).filter((binding) => ["clock", "ticker", "lowerThird", "logo"].includes(binding.kind))
    expect(liveLayers.map((binding) => binding.kind).sort()).toEqual(["clock", "logo", "lowerThird", "ticker"])
    expect(designToScene(input.document).issues).toEqual([])
    expect(designToScene(input.document).scene.layers.map((layer) => layer.kind)).toEqual(expect.arrayContaining(["clock", "ticker", "lowerThird", "logo"]))
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

  it("previews current host values and Brand Kit image privately without changing the design or Program", async () => {
    const documentValue = documentFixture()
    const feed = createLiveFeedLayer({ x: 100, y: 100 })
    documentValue.document.scene = applyCommand(documentValue.document.scene, { type: "ADD_NODE", node: feed.node })
    documentValue.document.bindings[feed.node.id] = { ...feed.binding, shows: ["bible", "song"] }
    const style = { ...useBroadcastStore.getState().tickerStyle, motion: "pages" as const, pageSeconds: 60, separator: " | " }
    useBroadcastStore.setState({
      isLive: true,
      liveVerse: { reference: "John 3:16", lines: ["For God so loved the world"], segments: [], content: "bible" } as never,
      sources: {
        bible: { value: { reference: "Romans 8:28", lines: ["All things work"], segments: [], content: "bible" }, itemId: null, revision: 4, activatedAt: 1, on: true },
        song: { value: { reference: "Amazing Grace · Verse 1", lines: ["Amazing grace"], segments: [], content: "song" }, itemId: null, revision: 9, activatedAt: 2, on: true },
      } as never,
      ticker: { items: ["Earlier announcement", "Welcome to service"], style, startedAt: Date.now() - 75_000 },
      lowerThird: { line1: "Pastor Tolu", line2: "Senior Pastor" },
    })
    useTimerStore.setState({ timer: { durationMs: 120_000, startedAt: null, accumulatedMs: 60_000 }, tick: 1 })
    useSettingsStore.setState({ brandKit: { ...defaultBrandKit(), logoUrl: imageDataUrl } })
    const programBefore = useBroadcastStore.getState().liveVerse
    const broadcastBefore = useBroadcastStore.getState()
    const outputStateBefore = {
      scenes: broadcastBefore.scenes,
      outputs: broadcastBefore.outputs,
      outputStatus: broadcastBefore.outputStatus,
      outputFrames: broadcastBefore.outputFrames,
      sceneTakes: broadcastBefore.sceneTakes,
      isLive: broadcastBefore.isLive,
      liveVerse: broadcastBefore.liveVerse,
    }
    const documentBefore = JSON.stringify(documentValue.document)
    const element = await render(documentValue)

    await addLiveLayer(element, "Service clock")
    await addLiveLayer(element, "Ticker")
    await addLiveLayer(element, "Lower third")
    await addLiveLayer(element, "Brand Kit logo")
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Live content")!.click())
    HTMLCanvasElement.prototype.getContext = (() => ({})) as never
    vi.mocked(renderSceneToCanvas).mockClear()
    const previewToggle = element.querySelector<HTMLButtonElement>('[aria-label="Preview current Live values"]')!
    await act(async () => previewToggle.click())

    const previewScene = vi.mocked(renderSceneToCanvas).mock.calls.at(-1)?.[0]
    expect(previewToggle.getAttribute("aria-pressed")).toBe("true")
    expect(element.textContent).toContain("Private preview of current host values")
    expect(previewScene).toBeDefined()
    const previewText = Object.values(previewScene!.nodes).filter((node) => node.id.startsWith("preview:") && node.type === "text").map((node) => (node as { text: string }).text).join("\n")
    expect(previewText).toContain("1:00")
    expect(previewText).toContain("Welcome to service")
    expect(previewText).not.toContain("Earlier announcement")
    expect(previewText).toContain("Pastor Tolu\nSenior Pastor")
    expect(previewText).toContain("Amazing Grace · Verse 1")
    expect(Object.values(previewScene!.nodes)).toContainEqual(expect.objectContaining({ type: "image", src: imageDataUrl, name: expect.stringContaining("Brand Kit preview") }))
    expect(JSON.stringify(documentValue.document)).toBe(documentBefore)
    expect(useBroadcastStore.getState().liveVerse).toBe(programBefore)
    const broadcastAfter = useBroadcastStore.getState()
    expect({
      scenes: broadcastAfter.scenes,
      outputs: broadcastAfter.outputs,
      outputStatus: broadcastAfter.outputStatus,
      outputFrames: broadcastAfter.outputFrames,
      sceneTakes: broadcastAfter.sceneTakes,
      isLive: broadcastAfter.isLive,
      liveVerse: broadcastAfter.liveVerse,
    }).toEqual(outputStateBefore)
    expect(store.saveDraft).not.toHaveBeenCalled()

    await act(async () => useBroadcastStore.setState({ ticker: {
      ...useBroadcastStore.getState().ticker!,
      items: ["Service starts soon", "Prayer begins now"],
      style: { ...useBroadcastStore.getState().ticker!.style, motion: "crawl", separator: " | " },
    } }))
    const updatedScene = vi.mocked(renderSceneToCanvas).mock.calls.at(-1)?.[0]
    const updatedText = Object.values(updatedScene!.nodes).filter((node) => node.id.startsWith("preview:") && node.type === "text").map((node) => (node as { text: string }).text).join("\n")
    expect(updatedText).toContain("Service starts soon   |   Prayer begins now")
    expect(useBroadcastStore.getState().liveVerse).toBe(programBefore)
  })

  it("edits the clock mode and fixed time, and blocks Prepare compatibility until the time is valid", async () => {
    const documentValue = documentFixture()
    store.saveDraft.mockImplementation(async (_id: string, _revision: number, input: DesignInput) => ({
      ...documentValue,
      revision: 5,
      document: input.document,
    }))
    const element = await render(documentValue)

    await addLiveLayer(element, "Service clock")
    const clockMode = element.querySelector<HTMLSelectElement>('[aria-label="What clock shows"]')!
    await act(async () => setSelectValue(clockMode, "milestone"))
    expect(element.querySelector('[aria-label="Clock run-of-show target"]')).not.toBeNull()

    await act(async () => setSelectValue(clockMode, "until"))
    const timeInput = element.querySelector<HTMLInputElement>('[aria-label="Count down to"]')!
    expect(timeInput).not.toBeNull()
    expect(element.textContent).toContain("A clock counting down to a fixed time needs a valid 24-hour time")
    await act(async () => setValue(timeInput, "10:30"))
    expect(element.textContent).not.toContain("A clock counting down to a fixed time needs a valid 24-hour time")
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Undo design edit"]')!.click())
    expect(element.querySelector<HTMLInputElement>('[aria-label="Count down to"]')?.value).toBe("")
    expect(element.textContent).toContain("A clock counting down to a fixed time needs a valid 24-hour time")
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Redo design edit"]')!.click())
    expect(element.querySelector<HTMLInputElement>('[aria-label="Count down to"]')?.value).toBe("10:30")
    expect(element.textContent).not.toContain("A clock counting down to a fixed time needs a valid 24-hour time")

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())
    const input = store.saveDraft.mock.calls[0]![2] as DesignInput
    const clockNode = Object.values(input.document.scene.nodes).find((node) => node.name === "Service timer")!
    expect(input.document.bindings[clockNode.id]).toMatchObject({ kind: "clock", clockShows: "until", until: "10:30" })
    expect(designToScene(input.document).issues).toEqual([])
  })

  it("adds a configured camera as a private design layer without storing its secret or changing Live", async () => {
    const documentValue = documentFixture()
    const cameras = [
      { name: "pulpit", label: "Pulpit", token: "p".repeat(32) },
      { name: "choir", label: "Choir", token: "c".repeat(32) },
    ]
    useSettingsStore.setState({ cameras })
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

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Camera")!.click())
    expect(element.querySelector('[aria-label="Camera sources"]')?.textContent).toContain("Camera selection needs a running Rhema camera router with a LAN address")
    expect(element.querySelector('[aria-label="Camera source"]')).toBeNull()

    act(() => useRouterHealth.setState({
      checked: true,
      status: {
        installed: true,
        running: true,
        wanted: true,
        lanAddress: "192.168.1.20",
        ports: { webrtc: 8889, webrtcUdp: 8189, rtsp: 8554, rtmp: 1935, srt: 8890, api: 9997 },
        restarts: 0,
        error: null,
        paths: [],
      },
    }))
    expect(element.textContent).toContain("Pulpit")
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Add Pulpit camera")!.click())
    expect(element.querySelector('[aria-label="Camera source"]')).not.toBeNull()
    expect(element.querySelector('[aria-label="Camera source binding"]')?.textContent).toContain("canvas shows a placeholder and does not display live camera video")
    await act(async () => setSelectValue(element.querySelector<HTMLSelectElement>('[aria-label="Camera source"]')!, "choir"))
    expect(element.querySelector<HTMLSelectElement>('[aria-label="Camera source"]')?.value).toBe("choir")
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Undo design edit"]')!.click())
    expect(element.querySelector<HTMLSelectElement>('[aria-label="Camera source"]')?.value).toBe("pulpit")
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Redo design edit"]')!.click())
    expect(element.querySelector<HTMLSelectElement>('[aria-label="Camera source"]')?.value).toBe("choir")
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())

    const saved = store.saveDraft.mock.calls[0]![2] as DesignInput
    const cameraNode = Object.values(saved.document.scene.nodes).find((node) => node.name === "Choir camera")!
    const binding = saved.document.bindings[cameraNode.id]!
    expect(binding).toMatchObject({ kind: "camera", cameraUrl: "http://192.168.1.20:8889/choir/whep" })
    expect(binding).not.toHaveProperty("token")
    expect(JSON.stringify(saved.document)).not.toContain(cameras[0]!.token)
    expect(JSON.stringify(saved.document)).not.toContain(cameras[1]!.token)
    const converted = designToScene(saved.document)
    expect(converted.issues).toEqual([])
    expect(converted.scene.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "camera", cameraUrl: "http://192.168.1.20:8889/choir/whep" }),
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
    }).toEqual(liveSnapshot)
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

describe("QR code and rotation layers (#851 G7)", () => {
  it("adds a QR code for a safe link as an editable picture layer that saves into a scene", async () => {
    const documentValue = documentFixture()
    store.saveDraft.mockImplementation(async (_id: string, _revision: number, input: DesignInput) => ({ ...documentValue, revision: 5, document: input.document }))
    const element = await render(documentValue)
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "QR code")!.click())

    const link = element.querySelector<HTMLInputElement>('input[aria-label="QR code link"]')!
    await act(async () => setValue(link, "javascript:alert(1)"))
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Add QR code")!.click())
    expect(element.querySelector('[role="alert"]')?.textContent).toContain("https://")

    await act(async () => setValue(link, "https://example.org/give"))
    await act(async () => {
      [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Add QR code")!.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())

    const input = store.saveDraft.mock.calls[0]![2] as DesignInput
    const qr = Object.values(input.document.scene.nodes).find((node) => node.type === "image") as SaraswatiImageNode
    expect(qr.name).toBe("QR code · https://example.org/give")
    expect(qr.src.startsWith("data:image/png")).toBe(true)
    expect(qr.width).toBe(qr.height)
    expect(input.document.bindings[qr.id]).toEqual({ id: qr.id, kind: "picture", imageUrl: qr.src })
    const prepared = designToScene(input.document)
    expect(prepared.issues).toEqual([])
    expect(prepared.scene.layers).toContainEqual(expect.objectContaining({ id: qr.id, kind: "picture", imageUrl: qr.src }))
  })

  it("rotates a selected layer in the native design and says Prepare cannot show it yet", async () => {
    const documentValue = documentFixture()
    store.saveDraft.mockImplementation(async (_id: string, _revision: number, input: DesignInput) => ({ ...documentValue, revision: 5, document: input.document }))
    const element = await render(documentValue)
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Rectangle")!.click())
    await commitNumberInput(element, "Rotation °", "15")
    expect(element.textContent).toContain("Prepare and outputs cannot show a rotated layer yet")
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save draft"))!.click())
    const input = store.saveDraft.mock.calls[0]![2] as DesignInput
    const rect = Object.values(input.document.scene.nodes).find((node) => node.name === "Rectangle")!
    expect(rect.rotation).toBe(15)
  })
})
