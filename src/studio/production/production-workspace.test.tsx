// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// jsdom has no ResizeObserver (the Screens cards' look previews size themselves with one).
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }))
vi.mock("sonner", () => ({ toast: toastMock }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { toast } from "sonner"
import { ProductionWorkspace } from "./production-workspace"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import { openProductionTab, useProductionTab } from "./production-tab"
import { useShellStore } from "@/studio/shell-store"
import { newLayer, newScene } from "@/lib/scenes"
import { useAuxTimers } from "@/stores/aux-timers-store"

// Each test's page is taken down after it, so a composer left open does not answer the next test's request.
const roots: Root[] = []
const originalOperatorName = useSettingsStore.getState().operatorName
const originalTakeScene = useBroadcastStore.getState().takeScene
const mount = (el: HTMLElement, embedded = false) => {
  const root = createRoot(el)
  roots.push(root)
  root.render(<ProductionWorkspace embedded={embedded} />)
}
beforeEach(() => {
  vi.clearAllMocks()
  useProductionTab.setState({ requested: null, selected: "timekeeper", scene: null, open: false })
})
afterEach(() => {
  act(() => { for (const r of roots.splice(0)) r.unmount() })
  useSettingsStore.setState({ operatorName: originalOperatorName })
  useBroadcastStore.setState({ takeScene: originalTakeScene })
  useAuxTimers.setState({ timers: [] })
  useShellStore.setState({ workspace: "home", goRequest: null, prepareDesignReturn: null, designRequest: null, designDocumentRequest: null })
})

describe("Production control", () => {
  it("explains which actions can change each public program", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const el = document.createElement("div")
    document.body.appendChild(el)
    await act(async () => mount(el))
    const header = el.querySelector("header")!
    expect(header.textContent).toContain("Monitoring only reads device status.")
    expect(header.textContent).toContain("Scene edits and OBS preview stay private until the relevant Take.")
    expect(header.textContent).toContain("Taking a scene changes the selected room display; switching in OBS changes the online stream.")
    expect(header.textContent).toContain("In rehearsal, scene Takes do not reach room displays and OBS program switches are blocked.")
    expect(header.textContent).not.toContain("Nothing here takes anything live.")
  })

  it("opens on the real timekeeper; Cameras is the camera router panel", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const el = document.createElement("div")
    document.body.appendChild(el)
    await act(async () => mount(el))
    expect(el.textContent).toContain("The service timer")
    expect([...el.querySelectorAll("button")].some((b) => b.textContent?.includes("Start"))).toBe(true)
    const tab = [...el.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "Cameras") as HTMLButtonElement
    await act(async () => tab.click())
    const panel = el.querySelector('[role="tabpanel"]')!
    expect(panel.textContent).toContain("Camera router")
    expect(panel.textContent).toContain("Add a camera")
    expect(panel.textContent).not.toContain("Not built yet")
  })

  it("keeps one service-clock control surface when Timekeeper is docked inside Live", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useAuxTimers.setState({ timers: [{ id: "communion-prep", label: "Communion prep", timer: { durationMs: 300_000, startedAt: null, accumulatedMs: 0 }, onStage: false, owner: "" }] })
    const el = document.createElement("div")
    document.body.appendChild(el)
    await act(async () => mount(el, true))
    expect(el.querySelector('[role="tablist"][aria-label="Live operation tools"]')).not.toBeNull()
    // The docked Timer tool is the one place to set the service clock (UX audit slice 4); the top-bar chip only opens it.
    expect(el.querySelector("#timer-minutes")).not.toBeNull()
    expect(el.textContent).toContain("Manage them here; the main service timer is above.")
    expect(el.textContent).toContain("Communion prep")
    const startAuxTimer = el.querySelector<HTMLButtonElement>('[aria-label="Start Communion prep"]')!
    await act(async () => startAuxTimer.click())
    expect(useAuxTimers.getState().timers[0]?.timer.startedAt).not.toBeNull()
    const pauseAuxTimer = el.querySelector<HTMLButtonElement>('[aria-label="Pause Communion prep"]')!
    await act(async () => pauseAuxTimer.click())
    expect(useAuxTimers.getState().timers[0]?.timer.startedAt).toBeNull()
    expect([...el.querySelectorAll("button")].filter((button) => button.textContent?.trim() === "Start")).toHaveLength(1)
    // #808 R9: Live's top bar shows the service clock, so the docked Timekeeper has no second readout.
    expect(el.querySelector('[aria-label="Service timing"]')).not.toBeNull()
    expect(el.querySelector('[aria-label="Service timing"] [role="timer"]')).toBeNull()
    expect(el.textContent).toContain("Planned finish")
  })

  it("Live tools gives Production tools a tall panel off air, the strip on air or from a link, and Esc shrinks first (#812 F1)", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const { LiveToolsDrawer } = await import("@/studio/present/live-tools-drawer")
    const originalLive = useBroadcastStore.getState().isLive
    useBroadcastStore.setState({ isLive: false })
    useProductionTab.setState({ expanded: {}, linked: false })
    const onClose = vi.fn()
    const el = document.createElement("div")
    document.body.appendChild(el)
    const root = createRoot(el)
    roots.push(root)
    await act(async () => root.render(<LiveToolsDrawer tab="production" onTabChange={() => {}} onClose={onClose} stripClassName="strip-row" />))
    const frame = () => el.querySelector<HTMLElement>('[data-slot="live-tools-frame"]')!
    // Off air: Production tools start tall, as a grown grid row (nothing is overlaid or made inert).
    expect(frame().dataset.expanded).toBe("true")
    expect(frame().className).toContain("strip-row")
    expect(frame().className).not.toContain("absolute")
    expect(el.querySelector("[inert]")).toBeNull()
    expect(el.querySelector('[data-slot="live-tools-panel"] [data-expanded="true"]')).not.toBeNull()
    // Esc shrinks to the strip first, then closes.
    const esc = () => el.querySelector('[data-slot="live-tools-panel"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
    await act(async () => esc())
    expect(frame().dataset.expanded).toBe("false")
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => esc())
    expect(onClose).toHaveBeenCalledTimes(1)
    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Expand Live tools"]')!.click())
    expect(frame().dataset.expanded).toBe("true")
    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Shrink Live tools to the strip"]')!.click())
    expect(useProductionTab.getState().expanded).toEqual({ production: false })
    // On air, or opened from a link, the strip is the default.
    useProductionTab.setState({ expanded: {} })
    await act(async () => useBroadcastStore.setState({ isLive: true }))
    expect(frame().dataset.expanded).toBe("false")
    await act(async () => useBroadcastStore.setState({ isLive: false }))
    expect(frame().dataset.expanded).toBe("true")
    await act(async () => openProductionTab("obs"))
    expect(frame().dataset.expanded).toBe("false")
    await act(async () => useProductionTab.setState({ open: false }))
    expect(useProductionTab.getState().linked).toBe(false)
    useProductionTab.setState({ expanded: {}, linked: false })
    useBroadcastStore.setState({ isLive: originalLive })
  })

  it("Scenes (once Programs) is a private editor; saved scenes go through the named Program Take", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useBroadcastStore.setState({ scenes: [], sceneReturn: {} })
    useSettingsStore.setState({ operatorName: "Tolu" })
    const el = document.createElement("div")
    document.body.appendChild(el)
    await act(async () => mount(el))
    const tab = [...el.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "Scenes") as HTMLButtonElement
    await act(async () => tab.click())
    const button = (text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement
    await act(async () => button("Bible and lyrics").click())
    const targetName = useBroadcastStore.getState().outputs.find((o) => (o.role ?? "congregation") === "congregation")?.name
    expect(el.textContent).toContain(`Preview output`)
    expect(el.textContent).toContain(targetName)
    expect(el.textContent).toContain("This editor is private. Save the scene, choose it in Live → Scenes, then use the named Take on Program.")
    expect(button("Save scene")).toBeTruthy()
    expect([...el.querySelectorAll("button")].some((b) => b.textContent?.trim().startsWith("Take "))).toBe(false)
    expect(useBroadcastStore.getState().outputs.find((o) => o.name === targetName)?.sceneId).toBeUndefined()
    expect(el.querySelector('[aria-label="Layers, bottom first"]')?.textContent).toContain("Bible")
    await act(async () => button("Save scene").click())
    const s = useBroadcastStore.getState()
    expect(s.scenes.map((x) => x.name)).toEqual(["Bible and lyrics"])
    const main = s.outputs.find((o) => (o.role ?? "congregation") === "congregation")!
    expect(main.sceneId).toBeUndefined()
    expect([...el.querySelectorAll("button")].some((b) => b.textContent?.trim().startsWith("Take "))).toBe(false)
    expect(el.querySelector('button[aria-label^="Back to "]')).toBeNull()
    await act(async () => useBroadcastStore.setState({ rehearsal: true }))
    await act(async () => useBroadcastStore.setState({ rehearsal: false }))
    expect(useBroadcastStore.getState().outputs.find((o) => o.id === main.id)?.sceneId).toBeUndefined()
    expect(button("Preview restore Bible and lyrics for " + main.name)).toBeFalsy()
  })

  it("opens Scenes at the scene another page asked for (Design → Templates' Customize a copy)", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const scene = (id: string, name: string) => ({ id, name, background: "#000000", layers: [], createdAt: 0, updatedAt: 0 })
    useBroadcastStore.setState({ scenes: [scene("a", "First scene"), scene("b", "Clean · Camera and scripture")], sceneReturn: {} })
    openProductionTab("programs", { sceneId: "b" })
    const el = document.createElement("div")
    document.body.appendChild(el)
    await act(async () => mount(el))
    expect((el.querySelector('[aria-label="Scene name"]') as HTMLInputElement).value).toBe("Clean · Camera and scripture")
    expect(useProductionTab.getState().scene).toBeNull()
    useProductionTab.setState({ requested: null })
  })

  it("customizes a Prepare scene copy in private and saves back without Take or Restore", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const scene = newScene("Opening scene")
    const before = useBroadcastStore.getState()
    const takeScene = vi.fn()
    useBroadcastStore.setState({ scenes: [scene], sceneReturn: {}, takeScene, isLive: true, liveItemId: "live-item" })
    useShellStore.setState({
      workspace: "present",
      prepareDesignReturn: {
        serviceId: "service-1",
        eventId: "event-1",
        momentId: "moment-1",
        eventTitle: "Sunday service",
        momentTitle: "Opening Scripture",
        sceneId: scene.id,
      },
    })
    openProductionTab("programs", { sceneId: scene.id })
    const el = document.createElement("div")
    document.body.appendChild(el)
    await act(async () => mount(el))

    expect(el.querySelector('[aria-label="Private scene preview"]')?.textContent).toContain("Sunday service · Opening Scripture")
    expect(el.querySelector('[aria-label="Scene name"]')).not.toBeNull()
    expect([...el.querySelectorAll("button")].some((button) => button.textContent?.trim().startsWith("Take "))).toBe(false)
    expect([...el.querySelectorAll("button")].some((button) => /^(Restore|Back to its own feed)/.test(button.textContent?.trim() ?? ""))).toBe(false)

    const name = el.querySelector<HTMLInputElement>('[aria-label="Scene name"]')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    await act(async () => { setValue.call(name, "Opening scene · adjusted"); name.dispatchEvent(new Event("input", { bubbles: true })) })
    const saveAndReturn = el.querySelector<HTMLButtonElement>('[aria-label="Save scene and return to Prepare"]')!
    await act(async () => saveAndReturn.click())

    const after = useBroadcastStore.getState()
    expect(after.scenes.find((item) => item.id === scene.id)?.name).toBe("Opening scene · adjusted")
    expect(after.outputs).toBe(before.outputs)
    expect(after.sceneReturn).toEqual({})
    expect(after.isLive).toBe(true)
    expect(after.liveItemId).toBe("live-item")
    expect(takeScene).not.toHaveBeenCalled()
    expect(useShellStore.getState().goRequest).toBe("prepare")
  })

  it("warns before replacing pinned Design paint, preserves Live outputs, and offers guarded Undo", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const before = useBroadcastStore.getState()
    const scene = {
      ...newScene("Welcome design"),
      design: { id: "design-welcome", version: 3 },
      background: "#101820",
      backgroundGradient: { angle: 90, stops: [{ color: "#101820", offset: 0 }, { color: "#3157a4", offset: 1 }] },
      layers: [
        newLayer("color", { id: "gradient-layer", name: "Gradient panel", color: "#101820", gradient: { angle: 45, stops: [{ color: "#101820", offset: 0 }, { color: "#3157a4", offset: 1 }] } }),
        newLayer("picture", { id: "design-picture", name: "Design picture", mediaId: "media-welcome", imageUrl: "data:image/png;base64,AAAA", imageDraw: { width: 1600, height: 900, cropX: 200, cropY: 80, cropWidth: 900, cropHeight: 600, radius: 18, clips: [{ type: "ellipse", x: 0, y: 0, width: 900, height: 600 }] } }),
      ],
    }
    useBroadcastStore.setState({ scenes: [scene], outputs: before.outputs, sceneReturn: {}, isLive: true, liveItemId: "live-item" })
    const el = document.createElement("div")
    document.body.appendChild(el)
    await act(async () => mount(el))
    await act(async () => ([...el.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === "Scenes") as HTMLButtonElement).click())

    expect(el.querySelector('[aria-label="Scene appearance details"]')?.textContent).toContain("precise gradient")
    expect(el.querySelector('[aria-label="Scene background gradient preview"]')?.getAttribute("style")).toContain("linear-gradient")
    await act(async () => ([...el.querySelectorAll('[aria-label="Layers, bottom first"] button')].find((button) => button.textContent?.includes("Gradient panel")) as HTMLButtonElement).click())
    expect(el.querySelector('[aria-label="Pinned Design gradient fill"]')?.textContent).toContain("45°")
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    const colour = el.querySelector<HTMLInputElement>('[aria-label="Layer colour"]')!
    await act(async () => { setValue.call(colour, "#d12233"); colour.dispatchEvent(new Event("input", { bubbles: true })) })
    const backgroundColour = el.querySelector<HTMLInputElement>('[aria-label="Background colour"]')!
    await act(async () => { setValue.call(backgroundColour, "#243648"); backgroundColour.dispatchEvent(new Event("input", { bubbles: true })) })
    await act(async () => ([...el.querySelectorAll('[aria-label="Layers, bottom first"] button')].find((button) => button.textContent?.includes("Design picture")) as HTMLButtonElement).click())
    const crop = el.querySelector<HTMLInputElement>('[aria-label="Crop left"]')!
    await act(async () => { setValue.call(crop, "10"); crop.dispatchEvent(new Event("input", { bubbles: true })) })
    expect([...el.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Duplicate"))?.disabled).toBe(true)
    expect([...el.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save as preset"))?.disabled).toBe(true)

    await act(async () => ([...el.querySelectorAll("button")].find((button) => button.textContent?.includes("Save scene")) as HTMLButtonElement).click())
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("Scene background gradient")
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("Gradient fill on “Gradient panel”")
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("Precise Design crop, corners, or clips on “Design picture”")
    expect(useBroadcastStore.getState().scenes[0]?.backgroundGradient).toEqual(scene.backgroundGradient)
    expect(useBroadcastStore.getState().scenes[0]?.layers[0]?.gradient).toEqual(scene.layers[0]?.gradient)
    expect(useBroadcastStore.getState().scenes[0]?.layers[1]?.imageDraw).toEqual(scene.layers[1]?.imageDraw)
    expect(useBroadcastStore.getState().outputs).toBe(before.outputs)
    expect(useBroadcastStore.getState().isLive).toBe(true)

    await act(async () => ([...document.body.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent?.includes("Replace details and save")) as HTMLButtonElement).click())
    const saved = useBroadcastStore.getState().scenes.find((item) => item.id === scene.id)!
    expect(saved.backgroundGradient).toBeUndefined()
    expect(saved.layers[0]?.gradient).toBeUndefined()
    expect(saved.layers[1]?.imageDraw).toBeUndefined()
    expect([...el.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Duplicate"))?.disabled).toBe(false)
    expect(useBroadcastStore.getState().outputs).toBe(before.outputs)
    expect(useBroadcastStore.getState().isLive).toBe(true)

    const confirmation = vi.mocked(toast.success).mock.calls.find(([message]) => message === "Scene saved with the listed Design changes")
    expect(confirmation).toBeTruthy()
    const undo = (confirmation?.[1] as unknown as { action: { onClick: () => void } }).action.onClick
    await act(async () => undo())
    const restored = useBroadcastStore.getState().scenes.find((item) => item.id === scene.id)!
    expect(restored.backgroundGradient).toEqual(scene.backgroundGradient)
    expect(restored.layers[0]?.gradient).toEqual(scene.layers[0]?.gradient)
    expect(restored.layers[1]?.imageDraw).toEqual(scene.layers[1]?.imageDraw)
    expect(useBroadcastStore.getState().outputs).toBe(before.outputs)
    expect(useBroadcastStore.getState().isLive).toBe(true)

    useBroadcastStore.getState().saveScene({ ...restored, name: "A newer saved edit" })
    const newer = useBroadcastStore.getState().scenes.find((item) => item.id === scene.id)!
    await act(async () => undo())
    const preserved = useBroadcastStore.getState().scenes.find((item) => item.id === scene.id)!
    expect(preserved.name).toBe("A newer saved edit")
    expect(preserved.updatedAt).toBe(newer.updatedAt)
    expect(toast.error).toHaveBeenCalledWith("This scene changed again", expect.objectContaining({ description: expect.stringContaining("Reopen the saved Design version") }))
  })

  it("opens the exact pinned Design document from the Scene Composer", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const scene = { ...newScene("Pinned scene"), design: { id: "design-pinned", version: 2 }, backgroundGradient: { angle: 0, stops: [{ color: "#101820", offset: 0 }, { color: "#3157a4", offset: 1 }] } }
    useBroadcastStore.setState({ scenes: [scene], sceneReturn: {} })
    const el = document.createElement("div")
    document.body.appendChild(el)
    await act(async () => mount(el))
    await act(async () => ([...el.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === "Scenes") as HTMLButtonElement).click())
    await act(async () => ([...el.querySelectorAll("button")].find((button) => button.textContent?.includes("Open source Design")) as HTMLButtonElement).click())
    expect(useShellStore.getState().designRequest).toBe("my-designs")
    expect(useShellStore.getState().designDocumentRequest).toBe("design-pinned")
  })

  it("requires the same appearance confirmation when returning an edited scene to Prepare", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const before = useBroadcastStore.getState()
    const scene = {
      ...newScene("Opening design"),
      design: { id: "design-opening", version: 2 },
      background: "#101820",
      backgroundGradient: { angle: 135, stops: [{ color: "#101820", offset: 0 }, { color: "#3157a4", offset: 1 }] },
    }
    useBroadcastStore.setState({ scenes: [scene], outputs: before.outputs, sceneReturn: {}, isLive: true, liveItemId: "live-item" })
    useShellStore.setState({
      workspace: "present",
      prepareDesignReturn: { serviceId: "service-1", eventId: "event-1", momentId: "moment-1", eventTitle: "Sunday service", momentTitle: "Opening", sceneId: scene.id },
    })
    openProductionTab("programs", { sceneId: scene.id })
    const el = document.createElement("div")
    document.body.appendChild(el)
    await act(async () => mount(el))

    const background = el.querySelector<HTMLInputElement>('[aria-label="Background colour"]')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    await act(async () => { setValue.call(background, "#253647"); background.dispatchEvent(new Event("input", { bubbles: true })) })
    const saveAndReturn = () => el.querySelector<HTMLButtonElement>('[aria-label="Save scene and return to Prepare"]')!
    await act(async () => saveAndReturn().click())
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("Replace precise Design details")
    expect(useBroadcastStore.getState().scenes[0]?.backgroundGradient).toEqual(scene.backgroundGradient)
    const routeBeforeCancel = useShellStore.getState().goRequest

    await act(async () => ([...document.body.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent === "Keep editing") as HTMLButtonElement).click())
    expect(useShellStore.getState().goRequest).toBe(routeBeforeCancel)
    expect(useBroadcastStore.getState().scenes[0]?.backgroundGradient).toEqual(scene.backgroundGradient)
    await act(async () => saveAndReturn().click())
    await act(async () => ([...document.body.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent?.includes("Replace details and return")) as HTMLButtonElement).click())

    expect(useShellStore.getState().goRequest).toBe("prepare")
    expect(useBroadcastStore.getState().scenes[0]?.backgroundGradient).toBeUndefined()
    expect(useBroadcastStore.getState().outputs).toBe(before.outputs)
    expect(useBroadcastStore.getState().isLive).toBe(true)
    expect(useBroadcastStore.getState().liveItemId).toBe("live-item")
  })

  it("names the two programs (#215 G5.1): the congregation's from its NDI senders, the online one's usual format while OBS is off", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const before = useBroadcastStore.getState().outputs
    const main = before[0]
    useBroadcastStore.setState({ outputs: [{ ...main, role: "congregation" }, { ...main, id: "ndi-1", name: "Hall NDI", type: "ndi", role: "congregation", ndi: { ...main.ndi, resolution: "r1080p", frameRate: "fps30" } }] })
    const el = document.createElement("div")
    document.body.appendChild(el)
    await act(async () => mount(el))
    const open = async (name: string) => act(async () => ([...el.querySelectorAll('[role="tab"]')].find((t) => t.textContent === name) as HTMLButtonElement).click())
    await open("Scenes")
    expect(el.textContent).not.toContain("Congregation program (screens, 1080p30)")
    await open("OBS")
    expect(el.querySelector('[aria-label="OBS program"] h3')?.textContent).toBe("Online program (OBS, 720p30)")
    await open("Screens")
    expect(el.querySelector('[role="group"][aria-label="News ticker controls"]')).not.toBeNull()
    expect(el.querySelector('[aria-label="Hall NDI"]')?.textContent).toContain("Congregation program (screens, 1080p30)")
    // A screen sets no format of its own: the usual one.
    expect(el.querySelector(`[aria-label="${main.name}"]`)?.textContent).toContain("Congregation program (screens, 1080p)")
    useBroadcastStore.setState({ outputs: before })
  })

  it("shows a missing second-language fallback to operators in the output inspector", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const before = useBroadcastStore.getState()
    const output = before.outputs[0]
    useBroadcastStore.setState({
      outputs: [{ ...output, language: "second", role: "congregation" }],
      outputFrames: {
        [output.id]: { theme: before.themes[0], verse: null, overlay: null, languageFallback: true },
      },
    })
    const el = document.createElement("div")
    document.body.appendChild(el)
    await act(async () => mount(el))
    const screens = [...el.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === "Screens") as HTMLButtonElement
    await act(async () => screens.click())

    expect(el.querySelector(`[aria-label="${output.name}"]`)?.textContent).toContain("Second language unavailable; showing available text.")

    useBroadcastStore.setState({ outputs: before.outputs, outputFrames: before.outputFrames })
  })

  it("OBS sits beside Scenes and says it is OBS's program, separate from Rhema Studio's congregation scenes", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const el = document.createElement("div")
    document.body.appendChild(el)
    await act(async () => mount(el))
    const tabs = [...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent)
    expect(tabs).not.toContain("Programs")
    expect(tabs.indexOf("OBS")).toBe(tabs.indexOf("Scenes") + 1)
    const tab = [...el.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "OBS") as HTMLButtonElement
    await act(async () => tab.click())
    const panel = el.querySelector('[role="tabpanel"]')!
    expect(panel.textContent).toContain("OBS program")
    expect(panel.textContent).toContain("separate from Rhema Studio's congregation scenes")
    // OBS off: the connection form is right here (UX audit S2), not a trip to Settings.
    expect(panel.textContent).not.toContain("Open Remote Control")
    expect(panel.querySelector('[aria-label="OBS address"]')).not.toBeNull()
    // Following its own words: type an address, then tick Connect. The same form stays, with what was typed.
    const address = panel.querySelector('[aria-label="OBS address"]') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(address, "10.0.0.9")
      address.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const connect = [...panel.querySelectorAll('input[type="checkbox"]')].find((c) => c.closest("label")?.textContent?.includes("Connect to OBS")) as HTMLInputElement
    await act(async () => connect.click())
    const after = el.querySelector('[role="tabpanel"] [aria-label="OBS address"]') as HTMLInputElement
    expect(after).toBe(address)
    expect(after.value).toBe("10.0.0.9")
    await act(async () => useSettingsStore.getState().setObs({ enabled: false }))
  })

  it("a computer joined to a main computer is told OBS is run there, not offered the form", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const { useJoin } = await import("@/stores/join-store")
    useJoin.setState({ status: "joined" } as never)
    const el = document.createElement("div")
    document.body.appendChild(el)
    await act(async () => mount(el))
    const tab = [...el.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "OBS") as HTMLButtonElement
    await act(async () => tab.click())
    const panel = el.querySelector('[role="tabpanel"]')!
    expect(panel.querySelector('[aria-label="OBS address"]')).toBeNull()
    expect(panel.textContent).toContain("joined a main computer")
    useJoin.setState({ status: "off" } as never)
  })
})
