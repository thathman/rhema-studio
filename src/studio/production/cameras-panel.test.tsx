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
const router = (patch: Record<string, unknown> = {}) => ({ installed: true, running: true, wanted: true, lanAddress: "192.168.1.20", ports: PORTS, restarts: 0, error: null, paths: [], ...patch })
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
  useSettingsStore.setState({ cameras: [], cameraRouterAuto: true })
  useBroadcastStore.setState({ scenes: [] })
})

const FP = "ab".repeat(32)

describe("Cameras panel (#209)", () => {
  it("offers the Rhema Studio Cam app's pairing link while the router serves RTSPS", async () => {
    answers.camera_router_status = router({ ports: { ...PORTS, rtsps: 8322 }, rtspsFingerprint: FP })
    useSettingsStore.setState({ cameras: [{ name: "pulpit", label: "Pulpit cam", token: "c".repeat(32) }] })
    const el = await mount()
    const text = el.textContent ?? ""
    expect(text).toContain(`rhema-camera://pair?host=192.168.1.20&port=8322&name=pulpit&user=cam-pulpit&token=${"c".repeat(32)}&fp=${FP}&label=Pulpit%20cam`)
    expect(el.querySelector('img[alt="QR code of the Pulpit cam Rhema Studio Cam link"]')).toBeTruthy()
  })

  it("explains what the app needs when the router has no RTSPS (no certificate yet, or an older build)", async () => {
    useSettingsStore.setState({ cameras: [{ name: "pulpit", label: "Pulpit", token: "c".repeat(32) }] })
    const el = await mount()
    expect(el.textContent).toContain("The app needs the router's secure connection")
    expect(el.textContent).not.toContain("rhema-camera://")
  })

  it("adds a camera: its phone page QR and link, the scene address and the OBS address", async () => {
    answers.camera_router_status = router({ paths: [{ name: "pulpit", live: true, source: "webRTCSession", readers: 2, tracks: ["H264"] }] })
    const el = await mount()
    await typeInto(el.querySelector('[aria-label="Camera name"]') as HTMLInputElement, "Pulpit")
    await act(async () => button(el, "Add camera")!.click())
    await flush()
    const [cam] = useSettingsStore.getState().cameras
    expect(cam).toMatchObject({ name: "pulpit", label: "Pulpit" })
    expect(cam.token).toMatch(/^[0-9a-f]{32}$/)
    const text = el.textContent ?? ""
    expect(text).toContain(`https://192.168.1.20:8081/camera?name=pulpit&k=${cam.token}&label=Pulpit`)
    expect(text).toContain("http://192.168.1.20:8889/pulpit/whep")
    expect(text).toContain("rtsp://192.168.1.20:8554/pulpit")
    expect(text).toContain("Sending")
    expect(text).toContain("watched by 2")
    expect(el.querySelector('img[alt="QR code of the Pulpit camera page"]')).toBeTruthy()
    // A camera app signs in as this camera only, with its own secret.
    expect(text).toContain(`rtmp://192.168.1.20:1935/pulpit?user=cam-pulpit&pass=${cam.token}`)
    expect(text).toContain(`srt://192.168.1.20:8890?streamid=publish:pulpit:cam-pulpit:${cam.token}&pkt_size=1316`)
  })

  it("names who reads each camera, which OBS companion has it on program, and warns when the network load is high for Wi-Fi", async () => {
    useSettingsStore.setState({ cameras: [{ name: "pulpit", label: "Pulpit", token: "a".repeat(32) }, { name: "choir", label: "Choir", token: "b".repeat(32) }] })
    const watchers = [
      { kind: "screen", name: "Rhema Studio screens on this computer", remote: false },
      { kind: "screen", name: "A screen or TV at 192.168.1.40", remote: true },
      { kind: "companion", name: "Media desk (OBS companion)", remote: true },
    ]
    answers.camera_router_status = router({ paths: [
      { name: "pulpit", live: true, source: "webRTCSession", readers: 3, tracks: ["H264"], width: 1280, height: 720, kbps: 4000, watchers, obs: [{ desk: "Media desk", program: true, preview: false, receiving: true }] },
      { name: "choir", live: true, source: "webRTCSession", readers: 1, tracks: ["H264"], kbps: 4000, watchers: [watchers[2]], obs: [{ desk: "Media desk", program: false, preview: true, receiving: false }] },
    ] })
    const el = await mount()
    const text = el.textContent ?? ""
    expect(text).toContain("H264 · 1280×720 · 4.0 Mbit/s")
    expect(text).toContain("Read by: Rhema Studio screens on this computer, A screen or TV at 192.168.1.40, Media desk (OBS companion)")
    expect(text).toContain("On the program of Media desk's OBS")
    expect(text).toContain("In the preview of Media desk's OBS (its OBS is not receiving it)")
    // 4 Mbit/s × 2 network readers + 4 × 1 = 12 Mbit/s: fine for Wi-Fi.
    expect(text).toContain("about 12.0 Mbit/s (3 readers on other computers and TVs)")
    expect(el.querySelector('[role="alert"]')?.textContent ?? "").not.toContain("a lot for Wi-Fi")
    answers.camera_router_status = router({ paths: [{ name: "pulpit", live: true, readers: 8, tracks: ["H264"], kbps: 4000, watchers: Array.from({ length: 8 }, (_, i) => ({ kind: "screen", name: `TV ${i}`, remote: true })), obs: [] }] })
    const busy = await mount()
    expect(busy.textContent).toContain("about 32.0 Mbit/s")
    expect(busy.textContent).toContain("That is a lot for Wi-Fi")
  })

  it("New link gives the camera a new secret, which the router and listener are told", async () => {
    useSettingsStore.setState({ cameras: [{ name: "pulpit", label: "Pulpit", token: "a".repeat(32) }] })
    const stop = startCameras()
    await flush()
    const el = await mount()
    await act(async () => button(el, "New link")!.click())
    const token = useSettingsStore.getState().cameras[0].token
    expect(token).toMatch(/^[0-9a-f]{32}$/)
    expect(token).not.toBe("a".repeat(32))
    expect(calls.filter((c) => c.cmd === "cameras_set").at(-1)?.args).toEqual({ cameras: [{ name: "pulpit", token }] })
    stop()
  })

  it("turns the router on, and off", async () => {
    answers.camera_router_status = router({ running: false, wanted: false })
    const el = await mount()
    await act(async () => button(el, "Turn on")!.click())
    expect(calls.some((c) => c.cmd === "camera_router_start")).toBe(true)
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
    await flush()
    // The list reaches the router before it starts.
    const order = calls.map((c) => c.cmd).filter((c) => c === "cameras_set" || c === "camera_router_start")
    expect(order.slice(-2)).toEqual(["cameras_set", "camera_router_start"])
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
