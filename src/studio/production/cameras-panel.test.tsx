// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

const calls: { cmd: string; args: Record<string, unknown> }[] = []
const answers: Record<string, unknown> = {}
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args })
    if (cmd in answers) return answers[cmd]
    return null
  }),
}))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => "data:image/png;base64,qr") } }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { CamerasPanel } from "./cameras-panel"
import { cameraName, startCameras } from "@/lib/cameras"
import { useSettingsStore } from "@/stores/settings-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import type { Scene } from "@/types"

const PORTS = { webrtc: 8889, webrtcUdp: 8189, rtsp: 8554, rtmp: 1935, srt: 8890, api: 9997 }
const router = (patch: Record<string, unknown> = {}) => ({ installed: true, running: true, wanted: true, lanAddress: "192.168.1.20", ports: PORTS, publishUser: "rhema", restarts: 0, error: null, paths: [], ...patch })
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })

async function mount() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const el = document.createElement("div")
  document.body.appendChild(el)
  await act(async () => createRoot(el).render(<CamerasPanel />))
  await flush()
  return el
}
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined
const typeInto = async (input: HTMLInputElement, value: string) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  await act(async () => { set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })) })
}

beforeEach(() => {
  calls.length = 0
  for (const k of Object.keys(answers)) delete answers[k]
  answers.get_http_status = { running: true, lan: true, port: 8080, tls_port: 8081 }
  answers.camera_router_status = router()
  useSettingsStore.setState({ cameras: [], cameraPassword: "", cameraRouterAuto: true })
  useBroadcastStore.setState({ scenes: [] })
})

describe("Cameras panel (#209)", () => {
  it("adds a camera: its phone page QR and link, the scene address and the OBS address", async () => {
    answers.camera_router_status = router({ paths: [{ name: "pulpit", live: true, source: "webRTCSession", readers: 2, tracks: ["H264"] }] })
    const el = await mount()
    await typeInto(el.querySelector('[aria-label="Camera name"]') as HTMLInputElement, "Pulpit")
    await act(async () => button(el, "Add camera")!.click())
    await flush()
    const [cam] = useSettingsStore.getState().cameras
    expect(cam).toMatchObject({ name: "pulpit", label: "Pulpit" })
    expect(cam.token).toMatch(/^[0-9a-f]{32}$/)
    expect(useSettingsStore.getState().cameraPassword).toMatch(/^[0-9a-f]{32}$/)
    const text = el.textContent ?? ""
    expect(text).toContain(`https://192.168.1.20:8081/camera?name=pulpit&k=${cam.token}&label=Pulpit`)
    expect(text).toContain("http://192.168.1.20:8889/pulpit/whep")
    expect(text).toContain("rtsp://192.168.1.20:8554/pulpit")
    expect(text).toContain("Sending")
    expect(text).toContain("watched by 2")
    expect(el.querySelector('img[alt="QR code of the Pulpit camera page"]')).toBeTruthy()
  })

  it("turns the router on with the church's camera password, and off", async () => {
    answers.camera_router_status = router({ running: false, wanted: false })
    const el = await mount()
    await act(async () => button(el, "Turn on")!.click())
    const start = calls.find((c) => c.cmd === "camera_router_start")
    expect(start?.args.password).toMatch(/^[0-9a-f]{32}$/)
    expect(start?.args.password).toBe(useSettingsStore.getState().cameraPassword)
    // Once running, the same switch turns it off.
    answers.camera_router_status = router()
    const again = await mount()
    await act(async () => button(again, "Turn off")!.click())
    expect(calls.some((c) => c.cmd === "camera_router_stop")).toBe(true)
  })

  it("says plainly when the router is not installed, and offers no switch", async () => {
    answers.camera_router_status = router({ installed: false, running: false, wanted: false })
    const el = await mount()
    expect(el.textContent).toContain("Camera router not installed")
    expect(button(el, "Turn on")!.disabled).toBe(true)
  })

  it("without secure phone pages there is no QR code, and a way to turn them on", async () => {
    answers.get_http_status = { running: true, lan: true, port: 8080, tls_port: null }
    useSettingsStore.setState({ cameras: [{ name: "choir", label: "Choir", token: "c".repeat(32) }] })
    const el = await mount()
    expect(el.textContent).toContain("secure (https) phone page")
    expect(button(el, "Open Remote control")).toBeTruthy()
    expect(el.textContent).not.toContain("/camera?name=choir")
    expect(el.textContent).toContain("http://192.168.1.20:8889/choir/whep")
  })

  it("Use in a scene fills an empty camera place; a scene on air is not changed", async () => {
    const scene = (id: string, layers: Scene["layers"]): Scene => ({ id, name: id, background: "#000000", layers, createdAt: 0, updatedAt: 0 })
    const box = { x: 0, y: 0, w: 100, h: 100 }
    useBroadcastStore.setState({
      scenes: [scene("Sermon", [{ id: "cam", name: "Pulpit place", kind: "camera", box, opacity: 1, visible: true }, { id: "words", name: "Bible", kind: "feed", box, opacity: 1, visible: true }]), scene("Live now", [])],
    })
    const live = useBroadcastStore.getState().outputs[0]
    useBroadcastStore.setState({ outputs: useBroadcastStore.getState().outputs.map((o) => (o.id === live.id ? { ...o, sceneId: "Live now" } : o)) })
    useSettingsStore.setState({ cameras: [{ name: "pulpit", label: "Pulpit", token: "p".repeat(32) }] })
    const el = await mount()
    const select = el.querySelector('[aria-label="Use Pulpit in a scene"]') as HTMLSelectElement
    expect([...select.options].find((o) => o.value === "Live now")?.disabled).toBe(true)
    await act(async () => {
      select.value = "Sermon"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    const sermon = useBroadcastStore.getState().scenes.find((s) => s.id === "Sermon")!
    expect(sermon.layers.map((l) => [l.id, l.cameraUrl])).toEqual([["cam", "http://192.168.1.20:8889/pulpit/whep"], ["words", undefined]])
  })
})

describe("cameras (#209)", () => {
  it("names a camera for the router from what was typed, never twice the same", () => {
    expect(cameraName("Pulpit", [])).toBe("pulpit")
    expect(cameraName("Choir (left) 2", [])).toBe("choir-left-2")
    expect(cameraName("Pulpit", ["pulpit", "pulpit-2"])).toBe("pulpit-3")
    expect(cameraName("Ẹ̀gbẹ́ Àkọ́rin", [])).toBe("egbe-akorin")
    expect(cameraName("!!!", [])).toBe("camera")
  })

  it("starts the router with Rhema only while cameras are added, and stops it with the last", async () => {
    useSettingsStore.setState({ cameras: [] })
    const stop = startCameras()
    await flush()
    expect(calls.some((c) => c.cmd === "camera_router_start")).toBe(false)
    expect(calls.find((c) => c.cmd === "cameras_set")?.args).toEqual({ cameras: [] })
    useSettingsStore.setState({ cameras: [{ name: "wide", label: "Wide", token: "w".repeat(32) }] })
    expect(calls.filter((c) => c.cmd === "cameras_set").at(-1)?.args).toEqual({ cameras: [{ name: "wide", token: "w".repeat(32) }] })
    expect(calls.some((c) => c.cmd === "camera_router_start")).toBe(true)
    useSettingsStore.setState({ cameras: [] })
    expect(calls.some((c) => c.cmd === "camera_router_stop")).toBe(true)
    stop()
  })

  it("does not start the router by itself when the setting is off", async () => {
    useSettingsStore.setState({ cameras: [{ name: "wide", label: "Wide", token: "w".repeat(32) }], cameraRouterAuto: false })
    const stop = startCameras()
    await flush()
    expect(calls.some((c) => c.cmd === "camera_router_start")).toBe(false)
    stop()
  })
})
