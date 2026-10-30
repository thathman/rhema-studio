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

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { useBroadcastStore } from "@/stores/broadcast-store"
import type { DesignDocument, DesignSummary, DesignVersion } from "@/design-engine/design-store"
import { createBlankRhemaDesign } from "@/design-engine/design-document-utils"
import type { Scene } from "@/types/scene"
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
  useBroadcastStore.setState({ themes: BUILTIN_THEMES, scenes: [], designDrafts: [] })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

describe("My Designs workspace", () => {
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
    const host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root!.render(<DesignDocumentsWorkspace />))
    await act(async () => { await Promise.resolve() })

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
    const add = [...card.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Add a design copy")!

    await act(async () => { add.click(); await Promise.resolve() })

    expect(store.create).toHaveBeenCalledWith(expect.objectContaining({ kind: "design", title: "Clean · Camera and scripture" }))
    expect(useBroadcastStore.getState().scenes).toEqual([])
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
    expect(host.textContent).toContain("Use in Prepare")
    const before = useBroadcastStore.getState()
    const liveBefore = {
      outputs: before.outputs,
      outputStatus: before.outputStatus,
      isLive: before.isLive,
      liveVerse: before.liveVerse,
      liveSlide: before.liveSlide,
      sceneTakes: before.sceneTakes,
    }

    await act(async () => {
      ;[...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Use in Prepare"))?.click()
      await Promise.resolve()
    })

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
