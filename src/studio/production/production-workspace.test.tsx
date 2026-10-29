// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// jsdom has no ResizeObserver (the Screens cards' look previews size themselves with one).
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ProductionWorkspace } from "./production-workspace"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import { openProductionTab, useProductionTab } from "./production-tab"
import { useShellStore } from "@/studio/shell-store"
import { newScene } from "@/lib/scenes"

// Each test's page is taken down after it, so a composer left open does not answer the next test's request.
const roots: Root[] = []
const originalOperatorName = useSettingsStore.getState().operatorName
const originalTakeScene = useBroadcastStore.getState().takeScene
const mount = (el: HTMLElement, embedded = false) => {
  const root = createRoot(el)
  roots.push(root)
  root.render(<ProductionWorkspace embedded={embedded} />)
}
beforeEach(() => useProductionTab.setState({ requested: null, selected: "timekeeper", scene: null, open: false }))
afterEach(() => {
  act(() => { for (const r of roots.splice(0)) r.unmount() })
  useSettingsStore.setState({ operatorName: originalOperatorName })
  useBroadcastStore.setState({ takeScene: originalTakeScene })
  useShellStore.setState({ workspace: "home", goRequest: null, prepareDesignReturn: null })
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
    const el = document.createElement("div")
    document.body.appendChild(el)
    await act(async () => mount(el, true))
    expect(el.querySelector('[role="tablist"][aria-label="Live operation tools"]')).not.toBeNull()
    expect(el.textContent).toContain("Use the service timer in Live’s top bar")
    expect(el.textContent).toContain("Manage these from the Timers control in Live’s toolbar.")
    expect([...el.querySelectorAll("button")].some((button) => /^(Start|Pause|Resume|Reset)$/.test(button.textContent?.trim() ?? ""))).toBe(false)
  })

  it("Scenes (once Programs) is the Scene Composer: a ready-made arrangement, Take, and back to the output's own feed", async () => {
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
    const takeButton = button("Take Bible and lyrics")
    const takeDetails = el.querySelector('[aria-label="Take details"]')
    const targetName = useBroadcastStore.getState().outputs.find((o) => (o.role ?? "congregation") === "congregation")?.name
    expect(takeDetails?.textContent).toContain(`Affected output: ${targetName} only`)
    expect(takeDetails?.textContent).toContain("Revision: New scene draft; Take saves its first revision first")
    expect(takeDetails?.textContent).toContain("Actor: Tolu")
    expect(takeButton.getAttribute("aria-describedby")).toBe(takeDetails?.id)
    expect(useBroadcastStore.getState().outputs.find((o) => o.name === targetName)?.sceneId).toBeUndefined()
    expect(el.querySelector('[aria-label="Layers, bottom first"]')?.textContent).toContain("Bible")
    await act(async () => takeButton.click())
    const s = useBroadcastStore.getState()
    expect(s.scenes.map((x) => x.name)).toEqual(["Bible and lyrics"])
    const main = s.outputs.find((o) => (o.role ?? "congregation") === "congregation")!
    expect(button("Take Bible and lyrics").getAttribute("aria-label")).toBe(`Take Bible and lyrics to ${main.name}`)
    expect(main.sceneId).toBe(s.scenes[0].id)
    expect(button("Back to its own feed").getAttribute("aria-label")).toBe(`Back to ${main.name}'s own feed`)
    await act(async () => useBroadcastStore.setState({ rehearsal: true }))
    expect(button("Take Bible and lyrics").getAttribute("aria-label")).toBe(`Rehearse Bible and lyrics on ${main.name}`)
    await act(async () => useBroadcastStore.setState({ rehearsal: false }))
    await act(async () => button("Back to its own feed").click())
    expect(useBroadcastStore.getState().outputs.find((o) => o.id === main.id)?.sceneId).toBeUndefined()
    expect(button("Restore Bible and lyrics")).toBeTruthy()
    expect(button("Restore Bible and lyrics").getAttribute("aria-label")).toBe(`Restore Bible and lyrics to ${main.name}`)
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
    const header = el.querySelector('[aria-label="Congregation program"]')!
    expect(header.querySelector("h2")?.textContent).toBe("Congregation program (screens, 1080p30)")
    expect(header.textContent).toContain("Online program (OBS, 720p30)")
    await open("OBS")
    expect(el.querySelector('[aria-label="OBS program"] h3')?.textContent).toBe("Online program (OBS, 720p30)")
    await open("Screens")
    expect(el.querySelector('[aria-label="Hall NDI"]')?.textContent).toContain("Congregation program (screens, 1080p30)")
    // A screen sets no format of its own: the usual one.
    expect(el.querySelector(`[aria-label="${main.name}"]`)?.textContent).toContain("Congregation program (screens, 1080p)")
    useBroadcastStore.setState({ outputs: before })
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
    expect(panel.textContent).toContain("Open Remote control") // OBS off: where to turn it on
  })
})
