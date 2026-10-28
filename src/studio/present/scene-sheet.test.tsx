// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const router = { installed: true, running: true, wanted: true, lanAddress: "192.168.1.10", ports: { webrtc: 8889, webrtcUdp: 8189, rtsp: 8554, rtmp: 1935, srt: 8890, api: 9997 }, restarts: 0, error: null, paths: [] }
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (cmd: string) => (cmd === "camera_router_status" ? router : cmd === "media_list" ? [] : null)), convertFileSrc: (p: string) => p }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ScenesStrip } from "./scenes-strip"
import { ProductionWorkspace } from "@/studio/production/production-workspace"
import { openProductionTab, useProductionTab } from "@/studio/production/production-tab"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import { SCENE_PRESETS, newScene } from "@/lib/scenes"
import { MAIN_OUTPUT_ID, defaultNdiSettings } from "@/types"

/** Present's New / Edit scene sheet (#243 SC.18), the composer's camera picker (SC.10) and language (SC.12), the output card's safe area (#299 4.9). */
let el: HTMLDivElement
let root: Root
const camera = { ...newScene("Camera with the Bible", SCENE_PRESETS[3]), id: "cam" }

const byLabel = <T extends Element>(label: string) => document.querySelector(`[aria-label="${label}"]`) as T
const buttonText = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement
const change = (input: HTMLInputElement | HTMLSelectElement, value: string) => act(async () => {
  const proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }))
})

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  const themeId = useBroadcastStore.getState().themes[0].id
  useBroadcastStore.setState({ outputs: [{ id: MAIN_OUTPUT_ID, name: "Sanctuary", type: "display", themeId, monitorIndex: 0, ndi: defaultNdiSettings() }], scenes: [camera], sceneReturn: {}, sources: {}, isLive: false, liveVerse: null, rehearsal: false })
  useSettingsStore.setState({ cameras: [{ name: "pulpit", label: "Pulpit", token: "0123456789abcdef0123" }] })
  el = document.createElement("div")
  document.body.appendChild(el)
  root = createRoot(el)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.replaceChildren()
  useProductionTab.setState({ requested: null, scene: null })
})

describe("New / Edit scene from Present", () => {
  it("New scene makes a basic scene without leaving Present, and puts nothing on air", async () => {
    await act(async () => root.render(<ScenesStrip />))
    await act(async () => buttonText("New scene").click())
    expect(document.body.textContent).toContain("Saving puts nothing on air")
    await change(byLabel("Scene name"), "Sermon with camera")
    await change(byLabel("What the content box shows"), "bible")
    await change(byLabel("Where the content box goes"), "lower")
    await act(async () => (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click())
    await act(async () => buttonText("Save scene").click())
    const s = useBroadcastStore.getState()
    const made = s.scenes.find((x) => x.name === "Sermon with camera")!
    expect(made.layers.map((l) => l.kind)).toEqual(["feed", "lowerThird"])
    expect(made.layers[0]).toMatchObject({ shows: ["bible"], box: { y: 66 } })
    expect(s.outputs[0].sceneId).toBeUndefined()
  })

  it("Edit scene changes the picked scene; its camera is chosen by name; the composer is one click away", async () => {
    await act(async () => root.render(<ScenesStrip />))
    const pick = [...el.querySelectorAll('[aria-label^="Scenes for"] button')][0] as HTMLButtonElement
    await act(async () => pick.click())
    await act(async () => buttonText("Edit scene").click())
    expect((byLabel<HTMLInputElement>("Scene name")).value).toBe("Camera with the Bible")
    await change(byLabel("Camera"), "pulpit")
    await act(async () => buttonText("Open in the composer").click())
    const cam = useBroadcastStore.getState().scenes.find((x) => x.id === "cam")!.layers.find((l) => l.kind === "camera")!
    expect(cam.cameraUrl).toBe("http://192.168.1.10:8889/pulpit/whep")
    expect(useProductionTab.getState()).toMatchObject({ requested: "programs", scene: "cam" })
  })

  it("the camera's box while it is not sending: colour bars by default, with its name if ticked; static, words or nothing", async () => {
    await act(async () => root.render(<ScenesStrip />))
    await act(async () => ([...el.querySelectorAll('[aria-label^="Scenes for"] button')][0] as HTMLButtonElement).click())
    await act(async () => buttonText("Edit scene").click())
    const when = () => byLabel<HTMLSelectElement>("When the camera isn't sending")
    expect([...when().options].map((o) => o.textContent)).toEqual(["Colour bars", "TV static", "Words", "Nothing (what is behind shows)"])
    expect(when().value).toBe("bars")
    const name = [...document.querySelectorAll("label")].find((l) => l.textContent === "Show the camera's name on the bars")!.querySelector("input")!
    await act(async () => name.click())
    await act(async () => buttonText("Save scene").click())
    const cam = () => useBroadcastStore.getState().scenes.find((x) => x.id === "cam")!.layers.find((l) => l.kind === "camera")!
    expect(cam()).toMatchObject({ noSignalName: true })
    expect(cam().noSignal).toBeUndefined()
    await act(async () => buttonText("Edit scene").click())
    expect(when().value).toBe("bars")
    await change(when(), "words")
    await change(byLabel("Words while the camera is not playing"), "Back in a moment")
    await act(async () => buttonText("Save scene").click())
    expect(cam()).toMatchObject({ noSignal: "words", cameraFallback: "Back in a moment" })
    await act(async () => buttonText("Edit scene").click())
    await change(when(), "static")
    expect(byLabel("Words while the camera is not playing")).toBeNull()
    await act(async () => buttonText("Save scene").click())
    expect(cam()).toMatchObject({ noSignal: "static", cameraFallback: "Back in a moment" })
  })
})

describe("the composer and the output card", () => {
  it("a camera layer picks the church's cameras by name (typing an address stays under Advanced); a content layer has a language", async () => {
    openProductionTab("programs", { sceneId: "cam" })
    await act(async () => root.render(<ProductionWorkspace />))
    const layerButton = (name: string) => [...el.querySelectorAll('[aria-label="Layers, bottom first"] button')].find((b) => b.textContent?.includes(name)) as HTMLButtonElement
    await act(async () => layerButton("Pulpit camera").click())
    const select = byLabel<HTMLSelectElement>("Camera")
    expect([...select.options].map((o) => o.textContent)).toEqual(["No camera yet", "Pulpit"])
    expect(el.textContent).toContain("Advanced: type a stream address")
    await change(select, "pulpit")
    expect(el.querySelector('[aria-label="Layers, bottom first"]')!.textContent).toContain("camera")
    expect(byLabel<HTMLSelectElement>("When the camera isn't sending").value).toBe("bars")
    expect(el.textContent).toContain("Show the camera's name on the bars")
    await change(byLabel("When the camera isn't sending"), "static")
    expect(byLabel<HTMLSelectElement>("When the camera isn't sending").value).toBe("static")
    expect(el.textContent).not.toContain("Show the camera's name on the bars")
    await act(async () => layerButton("Bible").click())
    const language = byLabel<HTMLSelectElement>("Layer language")
    expect([...language.options].map((o) => o.value)).toEqual(["", "both", "first", "second"])
    await change(language, "second")
    expect(byLabel<HTMLSelectElement>("Layer language").value).toBe("second")
    expect(byLabel<HTMLSelectElement>("How this layer changes")).toBeTruthy()
  })

  it("the Screens card shows the output's safe area", async () => {
    openProductionTab("screens")
    await act(async () => root.render(<ProductionWorkspace />))
    const card = el.querySelector('li[aria-label="Sanctuary"]')!
    expect(card.textContent).toMatch(/Safe area\d+% /)
    expect(card.querySelector('[data-testid="safe-area-outline"]')).toBeTruthy()
  })
})
