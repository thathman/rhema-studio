// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { OutputEditorDialog } from "@/components/broadcast/output-editor-dialog"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { outputDestination, outputEditPatch, outputFollows, outputPresentation, outputTransport } from "@/lib/output-summary"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { UsedOn } from "@/studio/design/design-workspace"
import { useShellStore } from "@/studio/shell-store"
import { defaultNdiSettings, type BroadcastOutput } from "@/types"

/** #299 UX15-4: Design shows where each look is used; each output keeps its per-content looks. */
const [dark, light, l3] = BUILTIN_THEMES
const main: BroadcastOutput = { id: "main", name: "Main Display", type: "display", themeId: dark.id, monitorIndex: 0, ndi: defaultNdiSettings("Main") }
const stream: BroadcastOutput = {
  id: "stream", name: "OBS Bible", type: "ndi", role: "congregation", themeId: l3.id, themeFor: { hymn: light.id, bible: l3.id }, shows: ["bible"],
  sceneId: "scene-1", monitorIndex: 0, ndi: { ...defaultNdiSettings("Rhema Bible"), alphaMode: "straightAlpha" },
}

async function render(node: React.ReactNode): Promise<HTMLElement> {
  const el = document.createElement("div")
  document.body.appendChild(el)
  const root = createRoot(el)
  mountedRoots.push(root)
  await act(async () => root.render(node))
  return el
}

const mountedRoots: Root[] = []

async function selectTab(label: string): Promise<void> {
  const tab = document.body.querySelector(`[role="tab"][aria-label="${label}"]`) as HTMLButtonElement
  await act(async () => {
    tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    tab.click()
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  for (const root of mountedRoots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
  useBroadcastStore.setState({ themes: BUILTIN_THEMES, outputs: [main, stream], outputStatus: {} })
  useShellStore.setState({ outputsDialogOpen: false, editOutputRequest: null })
})

describe("Design → Used on…", () => {
  it("lists the outputs using each look, and Open output opens that output's editor", async () => {
    const el = await render(<UsedOn />)
    const row = (name: string) => el.querySelector(`li[aria-label="${name}"]`)!.textContent
    expect(row(dark.name)).toContain("Main Display")
    expect(row(dark.name)).toContain("main look")
    expect(row(light.name)).toContain("OBS Bible")
    expect(row(light.name)).toContain("Hymns only")
    expect(row(l3.name)).toContain("main look · Bible only")
    expect(row(BUILTIN_THEMES[3].name)).toContain("Not on any output")
    await act(async () => (el.querySelector('button[aria-label="Open output OBS Bible"]') as HTMLButtonElement).click())
    expect(useShellStore.getState().editOutputRequest).toEqual({ id: "stream" })
    expect(useShellStore.getState().outputsDialogOpen).toBe(true)
  })
})

describe("the output editor's Appearance: content-specific looks", () => {
  it("shows what is set, and saving keeps themeFor, the NDI name, the feed link and the scene unchanged", async () => {
    const onSubmit = vi.fn()
    await render(<OutputEditorDialog open onOpenChange={() => {}} output={stream} draft={main} monitors={[]} monitorsRefreshing={false} onRefreshMonitors={() => {}} onSubmit={onSubmit} />)
    await selectTab("Appearance")
    const summary = document.body.querySelector("details summary")!
    expect(summary.textContent).toContain("Different looks by content")
    expect(summary.textContent).toContain("2 set")
    expect(document.body.querySelector('[aria-label="Look for Hymns"]')!.textContent).toBe(light.name)
    expect(document.body.querySelector('[aria-label="Look for Bible"]')!.textContent).toBe(l3.name)
    const save = [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Save changes")!
    await act(async () => save.click())
    const saved = onSubmit.mock.calls[0][0] as BroadcastOutput
    expect(saved.themeFor).toEqual({ hymn: light.id, bible: l3.id })
    const patch = outputEditPatch(saved)
    expect(patch.themeFor).toEqual(stream.themeFor)
    expect(patch.themeId).toBe(l3.id)
    expect(patch.shows).toEqual(["bible"])
    expect(patch.ndi?.sourceName).toBe("Rhema Bible")
    expect("sceneId" in patch).toBe(false)
    expect("id" in patch).toBe(false)
    expect(outputEditPatch({ ...saved, type: "browser", feedToken: "k1" }).feedToken).toBe("k1")
    expect("feedToken" in outputEditPatch({ ...saved, feedToken: undefined })).toBe(false)
  }, 60_000) // the whole dialog renders in jsdom: slow on a busy machine

  it("says none are set for an output with only a main look", async () => {
    await render(<OutputEditorDialog open onOpenChange={() => {}} output={main} draft={main} monitors={[]} monitorsRefreshing={false} onRefreshMonitors={() => {}} onSubmit={() => {}} />)
    await selectTab("Appearance")
    expect(document.body.querySelector("details summary")!.textContent).toContain("none, the main look for everything")
  }, 60_000)
})

describe("guided output setup and edit safety", () => {
  it("guides new outputs through audience, destination, and connection setup before adding", async () => {
    const onSubmit = vi.fn()
    const onOpenChange = vi.fn()
    await render(<OutputEditorDialog open onOpenChange={onOpenChange} draft={main} monitors={[]} monitorsRefreshing={false} onRefreshMonitors={() => {}} onSubmit={onSubmit} />)

    expect(document.body.textContent).toContain("Step 1 of 3")
    expect(document.body.textContent).toContain("Who is this output for?")
    await act(async () => (document.body.querySelector('input[type="radio"][value="stage"]') as HTMLInputElement).click())
    await act(async () => [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Next: choose destination")!.click())
    expect(document.body.textContent).toContain("Step 2 of 3")

    await act(async () => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("Browser Feed"))!.click())
    await act(async () => [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Next: connect and test")!.click())
    expect(document.body.textContent).toContain("Step 3 of 3")
    expect(document.body.textContent).toContain("Connect and test")

    await act(async () => [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Add & continue to connection setup")!.click())
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const saved = onSubmit.mock.calls[0][0] as BroadcastOutput
    expect(saved.role).toBe("stage")
    expect(saved.type).toBe("browser")
    expect(saved.feedToken).toMatch(/^[0-9a-f]{32}$/)
    expect(onSubmit.mock.calls[0][1]).toEqual({ continueSetup: true })
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(document.body.querySelector('[role="tab"][aria-label="Device"]')).not.toBeNull()
  }, 60_000)

  it("separates audience, sources, appearance, device, and advanced settings while editing", async () => {
    await render(<OutputEditorDialog open onOpenChange={() => {}} output={stream} draft={main} monitors={[]} monitorsRefreshing={false} onRefreshMonitors={() => {}} onSubmit={() => {}} />)

    for (const label of ["Audience", "Sources & layers", "Appearance", "Device", "Advanced"]) {
      expect(document.body.querySelector(`[role="tab"][aria-label="${label}"]`)).not.toBeNull()
    }
    await selectTab("Sources & layers")
    expect(document.body.textContent).toContain("What this output follows")
    await selectTab("Device")
    expect(document.body.textContent).toContain("Name OBS will see")
    await selectTab("Advanced")
    expect(document.body.textContent).toContain("Resolution")
  }, 60_000)

  it("identifies the exact on-air destination and says edits apply only when saved", async () => {
    useBroadcastStore.setState({ outputStatus: { main: { previewOpen: true, ndiActive: false } } })
    await render(<OutputEditorDialog open onOpenChange={() => {}} output={main} draft={main} monitors={[]} monitorsRefreshing={false} onRefreshMonitors={() => {}} onSubmit={() => {}} />)

    expect(document.body.textContent).toContain("Your edits are private until saved")
    expect(document.body.textContent).toContain("Main Display")
    expect(document.body.textContent).toContain("Display 1")
    expect([...document.body.querySelectorAll("button")].some((b) => b.textContent === "Apply changes to Main Display now")).toBe(true)
  }, 60_000)

  it("starts a saved output only from the explicit connection test control", async () => {
    const onToggleOutput = vi.fn()
    await render(<OutputEditorDialog open onOpenChange={() => {}} output={main} draft={main} monitors={[]} monitorsRefreshing={false} onRefreshMonitors={() => {}} onSubmit={() => {}} onToggleOutput={onToggleOutput} />)
    await selectTab("Device")

    expect(document.body.textContent).toContain("Starting it opens Main Display — Display 1")
    expect(document.body.textContent).toContain("may show the service's current live sources")
    await act(async () => [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Start Main Display to test")!.click())
    expect(onToggleOutput).toHaveBeenCalledWith(main, true)
  }, 60_000)

  it("explains a missing display and lets the volunteer retry discovery", async () => {
    const onRefreshMonitors = vi.fn()
    await render(<OutputEditorDialog open onOpenChange={() => {}} draft={main} monitors={[]} monitorsRefreshing={false} onRefreshMonitors={onRefreshMonitors} onSubmit={() => {}} />)
    await act(async () => [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Next: choose destination")!.click())
    await act(async () => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("External Display"))!.click())
    await act(async () => [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Next: connect and test")!.click())

    expect(document.body.textContent).toContain("No screen found yet")
    await act(async () => [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Refresh screens")!.click())
    expect(onRefreshMonitors).toHaveBeenCalledTimes(1)
  }, 60_000)

  it("supports arrow-key navigation between detail tabs", async () => {
    await render(<OutputEditorDialog open onOpenChange={() => {}} output={stream} draft={main} monitors={[]} monitorsRefreshing={false} onRefreshMonitors={() => {}} onSubmit={() => {}} />)
    const audience = document.body.querySelector('[role="tab"][aria-label="Audience"]') as HTMLButtonElement
    await act(async () => {
      audience.focus()
      audience.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(document.body.querySelector('[role="tab"][aria-label="Sources & layers"]')?.getAttribute("aria-selected")).toBe("true")
    expect(document.body.textContent).toContain("What this output follows")
  }, 60_000)
})

describe("an output's card in Live → Production tools → Screens", () => {
  it("says where it goes, what it follows and how it presents it, from what the output really does", () => {
    const scenes = [{ id: "scene-1", name: "Camera + Bible" }] as never
    expect(outputTransport(stream)).toBe("NDI")
    expect(outputDestination(stream)).toBe("“Rhema Bible” · 1080p24 · alpha")
    expect(outputFollows(stream)).toBe("Bible")
    expect(outputFollows(main)).toBe("Everything put on air")
    expect(outputPresentation(stream, scenes, l3)).toBe("Scene: Camera + Bible")
    expect(outputPresentation({ ...stream, sceneId: "scene-1", sceneSnapshot: { id: "scene-1", name: "Taken layout", layers: [] } as never }, [{ id: "scene-1", name: "Saved edit" } as never], l3)).toBe("Scene: Taken layout")
    expect(outputPresentation({ ...stream, sceneId: undefined, lowerThirds: true }, scenes, { ...l3, background: { ...l3.background, type: "transparent" } })).toBe("Full screen · lower thirds · transparent, for keying")
    expect(outputPresentation({ ...main, role: "stage" }, scenes)).toMatch(/^Stage display/)
    expect(outputPresentation({ ...main, role: "signage", ticker: true }, scenes)).toBe("Signage loop · ticker")
    expect(outputDestination({ ...main, windowed: true, monitorName: "DELL U2419H" })).toBe("A window on DELL U2419H")
  })
})
