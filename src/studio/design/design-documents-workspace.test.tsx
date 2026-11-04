// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const store = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  saveDraft: vi.fn(),
  createVersion: vi.fn(),
  getVersion: vi.fn(),
  listVersions: vi.fn(),
  duplicate: vi.fn(),
  usedOn: vi.fn(),
}))
const mockAsk = vi.hoisted(() => vi.fn(async (...args: unknown[]) => { void args; return true }))
const mockPreviewRender = vi.hoisted(() => vi.fn())

vi.mock("@/design-engine/design-store", () => ({ designStore: {
  list: (...args: unknown[]) => store.list(...args),
  get: (...args: unknown[]) => store.get(...args),
  create: (...args: unknown[]) => store.create(...args),
  saveDraft: (...args: unknown[]) => store.saveDraft(...args),
  createVersion: (...args: unknown[]) => store.createVersion(...args),
  getVersion: (...args: unknown[]) => store.getVersion(...args),
  listVersions: (...args: unknown[]) => store.listVersions(...args),
  duplicate: (...args: unknown[]) => store.duplicate(...args),
  usedOn: (...args: unknown[]) => store.usedOn(...args),
} }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: (...args: unknown[]) => mockAsk(...args) }))
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn(async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} })) }))
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock("@/lib/verse-renderer", () => ({ drawLowerThird: vi.fn(), onThemeFontsLoaded: vi.fn(() => () => {}), renderVerse: vi.fn() }))
vi.mock("@/vendor/avnac/renderer/offscreen-render", () => ({ renderSceneToCanvas: (...args: unknown[]) => mockPreviewRender(...args) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useUnsavedStore } from "@/stores/unsaved-store"
import { mayLeaveDesignDocumentDraft } from "@/lib/design-document-draft"
import type { DesignDocument, DesignSummary, DesignVersion } from "@/design-engine/design-store"
import { createBlankRhemaDesign } from "@/design-engine/design-document-utils"
import { VIDEO_LAYER_PLACEHOLDER_COLOR } from "@/design-engine/rhema-scene"
import type { Scene } from "@/types/scene"
import { useMediaStore } from "@/stores/media-store"
import { DesignDocumentsWorkspace, DesignVersionPicker } from "./design-documents-workspace"

let root: Root | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  HTMLCanvasElement.prototype.getContext = (() => null) as never
  document.body.replaceChildren()
  store.list.mockReset().mockResolvedValue([])
  store.get.mockReset().mockResolvedValue(null)
  store.create.mockReset()
  store.saveDraft.mockReset()
  store.createVersion.mockReset()
  store.getVersion.mockReset()
  store.listVersions.mockReset().mockResolvedValue([])
  store.duplicate.mockReset()
  store.usedOn.mockReset().mockResolvedValue([])
  mockAsk.mockReset().mockResolvedValue(true)
  mockPreviewRender.mockReset().mockResolvedValue(null)
  useBroadcastStore.setState({ themes: BUILTIN_THEMES, scenes: [], designDrafts: [] })
  useUnsavedStore.setState({ songEditor: null, designEditor: null })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function openVersionPreview(host: ParentNode, version: number) {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.includes(`Preview version ${version}`))
  if (!button) throw new Error(`Preview version ${version} button was not found`)
  await act(async () => {
    button.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe("My Designs workspace", () => {
  it("asks before leaving an unsaved design document and honors Keep editing", async () => {
    useUnsavedStore.getState().setDesignEditor("First design")
    mockAsk.mockResolvedValue(false)

    await expect(mayLeaveDesignDocumentDraft()).resolves.toBe(false)
    expect(mockAsk).toHaveBeenCalledWith("Your changes to ‘First design’ are not saved. Discard them?", expect.objectContaining({
      title: "Discard design changes?",
      kind: "warning",
      okLabel: "Discard",
      cancelLabel: "Keep editing",
    }))

    mockAsk.mockResolvedValue(true)
    await expect(mayLeaveDesignDocumentDraft()).resolves.toBe(true)
  })

  it("opens the exact Design document requested by a pinned scene", async () => {
    const design: DesignDocument = {
      id: "design-pinned-scene",
      title: "Sunday welcome",
      kind: "design",
      document: createBlankRhemaDesign("Sunday welcome"),
      revision: 4,
      latestVersion: 3,
      createdAt: "2026-10-30T00:00:00Z",
      updatedAt: "2026-10-30T00:00:00Z",
    }
    store.list.mockResolvedValue([{ id: design.id, title: design.title, kind: design.kind, revision: design.revision, latestVersion: design.latestVersion, updatedAt: design.updatedAt }])
    store.get.mockResolvedValue(design)
    const handled = vi.fn()
    const host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root!.render(<DesignDocumentsWorkspace initialDesignId={design.id} onInitialDesignHandled={handled} />))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })

    expect(store.get).toHaveBeenCalledWith("design-pinned-scene")
    expect(host.querySelector<HTMLInputElement>("#design-document-title")?.value).toBe("Sunday welcome")
    expect(handled).toHaveBeenCalledTimes(1)
  })

  it("registers a dirty design with the shell guard and clears it when the editor closes", async () => {
    const design: DesignDocument = {
      id: "design-unsaved",
      title: "First design",
      kind: "design",
      document: createBlankRhemaDesign("First design"),
      revision: 1,
      latestVersion: null,
      createdAt: "2026-10-30T00:00:00Z",
      updatedAt: "2026-10-30T00:00:00Z",
    }
    store.list.mockResolvedValue([{ id: design.id, title: design.title, kind: design.kind, revision: design.revision, latestVersion: null, updatedAt: design.updatedAt }])
    store.get.mockResolvedValue(design)
    const host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root!.render(<DesignDocumentsWorkspace />))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })

    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("First design"))!.click() })
    const title = host.querySelector<HTMLInputElement>("#design-document-title")!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
      setter.call(title, "Unsaved first design")
      title.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(useUnsavedStore.getState().designEditor).toBe("First design")
    act(() => root?.unmount())
    root = null
    expect(useUnsavedStore.getState().designEditor).toBeNull()
  })

  it("saves a template as a canonical design without adding an unpinned scene or changing Live", async () => {
    const created: DesignDocument = {
      id: "design-copy-1",
      title: "Clean · Camera and scripture",
      kind: "design",
      document: createBlankRhemaDesign("Clean · Camera and scripture"),
      revision: 1,
      latestVersion: null,
      createdAt: "2026-10-30T00:00:00Z",
      updatedAt: "2026-10-30T00:00:00Z",
    }
    store.create.mockResolvedValue(created)
    store.get.mockResolvedValue(created)
    const host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root!.render(<DesignDocumentsWorkspace />))
    await act(async () => { await Promise.resolve() })
    expect(host.textContent).toContain("Choose a starting point")
    expect(host.textContent).toContain("3 · Use in Prepare")

    const before = useBroadcastStore.getState()
    const liveBefore = {
      outputs: before.outputs,
      outputStatus: before.outputStatus,
      isLive: before.isLive,
      liveVerse: before.liveVerse,
      liveSlide: before.liveSlide,
      sceneTakes: before.sceneTakes,
    }
    const browse = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Browse scene templates"))!
    await act(async () => browse.click())
    const card = [...host.querySelectorAll("li")].find((item) => item.querySelector("h4")?.textContent === "Clean · Camera and scripture")!
    const choose = [...card.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Choose template")!

    await act(async () => { choose.click(); await Promise.resolve() })

    expect(store.create).toHaveBeenCalledWith(expect.objectContaining({ kind: "design", title: "Clean · Camera and scripture" }))
    expect(host.textContent).toContain("Added to My Designs")
    expect(useBroadcastStore.getState().scenes).toEqual([])
    const customize = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Customize this design")!
    await vi.waitFor(() => expect(customize.disabled).toBe(false))
    await act(async () => { customize.click(); await Promise.resolve() })
    expect(store.get).toHaveBeenCalledWith("design-copy-1")
    expect(host.querySelector('[aria-label="Design canvas"]')).not.toBeNull()
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

  it("passes an explicitly chosen immutable version to Prepare as a pinned scene without changing Live", async () => {
    const designId = "design-opening"
    const design = createBlankRhemaDesign("Opening")
    const summary: DesignSummary = {
      id: designId,
      title: "Opening",
      kind: "design",
      revision: 3,
      latestVersion: 1,
      updatedAt: "2026-10-30T00:00:00Z",
    }
    const version: DesignVersion = {
      designId,
      version: 1,
      fromRevision: 3,
      title: "Opening",
      document: design,
      note: "Sunday",
      savedBy: "Tolu",
      createdAt: "2026-10-30T00:00:00Z",
    }
    store.list.mockResolvedValue([summary])
    store.listVersions.mockResolvedValue([{ ...version, document: null }])
    store.getVersion.mockResolvedValue(version)
    const onUse = vi.fn()
    const host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root!.render(<DesignVersionPicker onUse={onUse} />))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    expect(host.textContent).toContain("Preview version 1")
    const before = useBroadcastStore.getState()
    const liveBefore = {
      outputs: before.outputs,
      outputStatus: before.outputStatus,
      isLive: before.isLive,
      liveVerse: before.liveVerse,
      liveSlide: before.liveSlide,
      sceneTakes: before.sceneTakes,
    }

    await openVersionPreview(host, 1)
    expect(onUse).not.toHaveBeenCalled()
    expect(host.textContent).toContain("Use in Prepare")
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Use in Prepare"))!.click())

    expect(store.getVersion).toHaveBeenCalledWith(designId, 1)
    expect(onUse).toHaveBeenCalledTimes(1)
    const [scene, usedVersion] = onUse.mock.calls[0]! as unknown as [Scene, DesignVersion]
    expect(scene).toMatchObject({ name: "Opening v1", design: { id: designId, version: 1 } })
    expect(scene.id).not.toBe(design.meta.id)
    expect(usedVersion).toEqual(version)
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

  it("previews the exact immutable version privately before the operator uses it", async () => {
    const designId = "design-preview"
    const design = createBlankRhemaDesign("Prayer lower third")
    const summary: DesignSummary = { id: designId, title: "Prayer lower third", kind: "design", revision: 2, latestVersion: 3, updatedAt: new Date(0).toISOString() }
    const version: DesignVersion = { designId, version: 2, fromRevision: 2, title: summary.title, document: design, note: "Approved wording", savedBy: "Tolu", createdAt: new Date(0).toISOString() }
    store.list.mockResolvedValue([summary])
    store.listVersions.mockResolvedValue([{ ...version, document: null }])
    store.getVersion.mockResolvedValue(version)
    const renderedCanvas = document.createElement("canvas")
    renderedCanvas.width = 960
    renderedCanvas.height = 540
    mockPreviewRender.mockResolvedValue(renderedCanvas)
    const drawImage = vi.fn()
    const clearRect = vi.fn()
    HTMLCanvasElement.prototype.getContext = (() => ({ drawImage, clearRect })) as never
    const onUse = vi.fn()
    const host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root!.render(<DesignVersionPicker onUse={onUse} />))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })

    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Preview version 2"))!.click())
    await vi.waitFor(() => expect(mockPreviewRender).toHaveBeenCalledTimes(1))

    expect(store.getVersion).toHaveBeenCalledWith(designId, 2)
    expect(mockPreviewRender).toHaveBeenCalledWith(expect.objectContaining({ root: design.scene.root }), expect.objectContaining({ maxCssPx: expect.any(Number), awaitFonts: false }))
    expect(host.textContent).toContain("Private artwork preview")
    expect(host.textContent).toContain("live sources are shown as static placeholders")
    expect(onUse).not.toHaveBeenCalled()
    expect(drawImage).toHaveBeenCalledWith(renderedCanvas, 0, 0, expect.any(Number), expect.any(Number))

    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Use in Prepare"))!.click())
    expect(onUse).toHaveBeenCalledTimes(1)
    expect(onUse.mock.calls[0]?.[1]).toEqual(version)
  })

  it("does not show a stale version when the operator changes the search while it loads", async () => {
    const firstDesign = createBlankRhemaDesign("First saved design")
    const firstSummary: DesignSummary = { id: "design-first", title: "First saved design", kind: "design", revision: 1, latestVersion: 1, updatedAt: new Date(0).toISOString() }
    const firstVersion: DesignVersion = { designId: firstSummary.id, version: 1, fromRevision: 1, title: firstSummary.title, document: firstDesign, note: null, savedBy: "Tolu", createdAt: new Date(0).toISOString() }
    const secondSummary: DesignSummary = { id: "design-second", title: "Second saved design", kind: "design", revision: 1, latestVersion: 2, updatedAt: new Date(0).toISOString() }
    store.list.mockResolvedValue([firstSummary, secondSummary])
    store.listVersions.mockImplementation(async (id: string) => [{
      ...firstVersion,
      designId: id,
      title: id === firstSummary.id ? firstSummary.title : secondSummary.title,
    }])
    let finish!: (version: DesignVersion) => void
    store.getVersion.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root!.render(<DesignVersionPicker onUse={vi.fn()} />))
    await vi.waitFor(() => expect(host.textContent).toContain("Preview version 1"))

    const previewButton = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Preview version 1")
    if (!previewButton) throw new Error("The first design preview button was not found")
    await act(async () => previewButton.click())
    const search = host.querySelector<HTMLInputElement>('[aria-label="Search saved designs"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
      setter.call(search, "Second")
      search.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await vi.waitFor(() => expect(host.querySelector<HTMLSelectElement>('[aria-label="Saved design"]')?.value).toBe("design-second"))

    await act(async () => finish(firstVersion))
    expect(host.querySelector('[aria-label="Saved design version preview"]')).toBeNull()
    expect(host.textContent).not.toContain("First saved design · version 1")
  })

  it("requires an explicit page choice when attaching a multi-page version", async () => {
    const designId = "design-pages"
    const design = createBlankRhemaDesign("Bilingual welcome")
    const rootNode = design.scene.nodes[design.scene.root]
    const background = Object.values(design.scene.nodes).find((node) => node.type === "rect")
    if (!rootNode || rootNode.type !== "group" || !background || background.type !== "rect") throw new Error("Expected a design root and background")
    const secondBackground = { ...background, id: "page-two-background", parentId: "page-two-group", name: "Yoruba background", fill: { type: "solid" as const, color: "#264060" } }
    const multiPage = {
      ...design,
      pages: [
        { id: "page-one", nodeId: "page-one-group", title: "English" },
        { id: "page-two", nodeId: "page-two-group", title: "Yoruba" },
      ],
      scene: {
        ...design.scene,
        nodes: {
          ...design.scene.nodes,
          [rootNode.id]: { ...rootNode, children: ["page-one-group", "page-two-group"] },
          "page-one-group": { id: "page-one-group", type: "group" as const, parentId: rootNode.id, name: "English", visible: true, opacity: 1, children: [background.id] },
          "page-two-group": { id: "page-two-group", type: "group" as const, parentId: rootNode.id, name: "Yoruba", visible: true, opacity: 1, children: [secondBackground.id] },
          [background.id]: { ...background, parentId: "page-one-group" },
          [secondBackground.id]: secondBackground,
        },
      },
      bindings: {
        ...design.bindings,
        [secondBackground.id]: { ...design.bindings[background.id], id: secondBackground.id, color: "#264060" },
      },
    }
    const summary: DesignSummary = { id: designId, title: "Bilingual welcome", kind: "design", revision: 1, latestVersion: 1, updatedAt: new Date(0).toISOString() }
    const version: DesignVersion = { designId, version: 1, fromRevision: 1, title: summary.title, document: multiPage, note: null, savedBy: "Tolu", createdAt: new Date(0).toISOString() }
    store.list.mockResolvedValue([summary])
    store.listVersions.mockResolvedValue([{ ...version, document: null }])
    store.getVersion.mockResolvedValue(version)
    const renderedCanvas = document.createElement("canvas")
    renderedCanvas.width = 960
    renderedCanvas.height = 540
    mockPreviewRender.mockResolvedValue(renderedCanvas)
    HTMLCanvasElement.prototype.getContext = (() => ({ drawImage: vi.fn(), clearRect: vi.fn() })) as never
    const onUse = vi.fn()
    const host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root!.render(<DesignVersionPicker onUse={onUse} />))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })

    await openVersionPreview(host, 1)
    expect(onUse).not.toHaveBeenCalled()
    const pageSelect = host.querySelector<HTMLSelectElement>('[aria-label="Preview page"]')!
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!
    await act(async () => {
      setter.call(pageSelect, "page-two")
      pageSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(mockPreviewRender.mock.calls.at(-1)?.[0]).toMatchObject({ root: "page-two-group" })
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Use selected page in Prepare"))!.click())

    expect(onUse).toHaveBeenCalledTimes(1)
    expect(onUse.mock.calls[0]?.[0]).toMatchObject({ design: { id: designId, version: 1, pageId: "page-two" }, layers: [expect.objectContaining({ id: "page-two-background", color: "#264060" })] })
    expect(onUse.mock.calls[0]?.[2]).toBe("page-two")
  })

  it("refreshes a saved Library video URL before pinning its version in Prepare", async () => {
    const designId = "design-video"
    const design = createBlankRhemaDesign("Sermon clip")
    const background = Object.values(design.scene.nodes).find((node) => node.type === "rect")
    if (!background || background.type !== "rect") throw new Error("Expected a design background rectangle")
    design.scene.nodes[background.id] = { ...background, fill: { type: "solid", color: VIDEO_LAYER_PLACEHOLDER_COLOR } }
    design.bindings[background.id] = {
      id: background.id,
      kind: "video",
      mediaId: "sermon-media",
      videoUrl: "asset://stale/video.mp4",
      mediaFile: "sermon.mp4",
    }
    const summary: DesignSummary = { id: designId, title: "Sermon clip", kind: "design", revision: 2, latestVersion: 1, updatedAt: new Date(0).toISOString() }
    const version: DesignVersion = { designId, version: 1, fromRevision: 2, title: summary.title, document: design, note: null, savedBy: "Tolu", createdAt: new Date(0).toISOString() }
    store.list.mockResolvedValue([summary])
    store.listVersions.mockResolvedValue([{ ...version, document: null }])
    store.getVersion.mockResolvedValue(version)
    const currentVideoUrl = "asset://localhost/%2Flocal-media%2Fsermon.mp4"
    const fileUrl = vi.fn(async () => currentVideoUrl)
    useMediaStore.setState({ fileUrl })
    const before = useBroadcastStore.getState()
    const liveSnapshot = { outputs: before.outputs, outputStatus: before.outputStatus, isLive: before.isLive, sceneTakes: before.sceneTakes }
    const onUse = vi.fn()
    const host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root!.render(<DesignVersionPicker onUse={onUse} />))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })

    await openVersionPreview(host, 1)
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Use in Prepare"))!.click())

    expect(fileUrl).toHaveBeenCalledWith("sermon-media")
    expect(onUse).toHaveBeenCalledTimes(1)
    expect(onUse.mock.calls[0]?.[0]).toMatchObject({
      design: { id: designId, version: 1 },
      layers: [expect.objectContaining({ kind: "video", mediaId: "sermon-media", mediaFile: "sermon.mp4", videoUrl: currentVideoUrl })],
    })
    const after = useBroadcastStore.getState()
    expect({ outputs: after.outputs, outputStatus: after.outputStatus, isLive: after.isLive, sceneTakes: after.sceneTakes }).toEqual(liveSnapshot)
  })

  it("fails closed when a saved version's Library video is unavailable", async () => {
    const design = createBlankRhemaDesign("Missing video")
    const background = Object.values(design.scene.nodes).find((node) => node.type === "rect")
    if (!background || background.type !== "rect") throw new Error("Expected a design background rectangle")
    design.scene.nodes[background.id] = { ...background, fill: { type: "solid", color: VIDEO_LAYER_PLACEHOLDER_COLOR } }
    design.bindings[background.id] = { id: background.id, kind: "video", mediaId: "missing-video", videoUrl: "asset://stale/missing.mp4", mediaFile: "missing.mp4" }
    const summary: DesignSummary = { id: "design-missing-video", title: "Missing video", kind: "design", revision: 1, latestVersion: 1, updatedAt: new Date(0).toISOString() }
    const version: DesignVersion = { designId: summary.id, version: 1, fromRevision: 1, title: summary.title, document: design, note: null, savedBy: "Tolu", createdAt: new Date(0).toISOString() }
    store.list.mockResolvedValue([summary])
    store.listVersions.mockResolvedValue([{ ...version, document: null }])
    store.getVersion.mockResolvedValue(version)
    useMediaStore.setState({ fileUrl: vi.fn(async () => null) })
    const onUse = vi.fn()
    const host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root!.render(<DesignVersionPicker onUse={onUse} />))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })

    await openVersionPreview(host, 1)
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Use in Prepare"))!.click())

    expect(onUse).not.toHaveBeenCalled()
    expect(host.textContent).toContain("This version cannot be used")
    expect(host.textContent).toContain("Missing video")
  })

  it("keeps an unsaved draft open when the operator cancels switching designs", async () => {
    const first: DesignDocument = {
      id: "design-first",
      title: "First design",
      kind: "design",
      document: createBlankRhemaDesign("First design"),
      revision: 1,
      latestVersion: null,
      createdAt: "2026-10-30T00:00:00Z",
      updatedAt: "2026-10-30T00:00:00Z",
    }
    const second: DesignDocument = {
      ...first,
      id: "design-second",
      title: "Second design",
      document: createBlankRhemaDesign("Second design"),
    }
    const summaries: DesignSummary[] = [first, second].map((item) => ({
      id: item.id,
      title: item.title,
      kind: item.kind,
      revision: item.revision,
      latestVersion: item.latestVersion,
      updatedAt: item.updatedAt,
    }))
    store.list.mockResolvedValue(summaries)
    store.get.mockImplementation(async (id: string) => id === first.id ? first : second)
    mockAsk.mockResolvedValue(false)
    const host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root!.render(<DesignDocumentsWorkspace />))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })

    const firstButton = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("First design"))!
    await act(async () => firstButton.click())
    const title = host.querySelector<HTMLInputElement>("#design-document-title")!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
      setter.call(title, "Unsaved first design")
      title.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const secondButton = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Second design"))!
    await act(async () => secondButton.click())

    expect(mockAsk).toHaveBeenCalledWith("Your design changes are not saved. Discard them?", expect.objectContaining({ kind: "warning", cancelLabel: "Keep editing" }))
    expect(host.querySelector<HTMLInputElement>("#design-document-title")?.value).toBe("Unsaved first design")
    expect(store.get).toHaveBeenCalledTimes(1)
  })
})
