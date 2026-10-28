// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const calls: { cmd: string; args: Record<string, unknown> }[] = []
const answers: Record<string, unknown> = {}
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args })
    const a = answers[cmd]
    if (a instanceof Error) throw a.message
    return typeof a === "function" ? a(args) : (a ?? null)
  }),
}))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => "data:image/png;base64,qr") } }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ProductionWorkspace } from "./production-workspace"
import { useProductionTab } from "./production-tab"
import { SignalWatch } from "@/studio/shell/signal-watch"
import { OutputEditorDialog } from "@/components/broadcast/output-editor-dialog"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useSettingsDialogStore } from "@/lib/settings-dialog"
import { useShellStore } from "@/studio/shell-store"
import { defaultNdiSettings, type BroadcastOutput, type Scene } from "@/types"

const PORTS = { webrtc: 8889, webrtcUdp: 8189, rtsp: 8554, rtmp: 1935, srt: 8890, api: 9997 }
const router = (paths: unknown[] = []) => ({ installed: true, running: true, wanted: true, lanAddress: "192.168.1.20", ports: PORTS, restarts: 0, error: null, paths })
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
const theme = BUILTIN_THEMES[0].id
const main: BroadcastOutput = { id: "main", name: "Main", type: "display", themeId: theme, monitorIndex: 0, ndi: defaultNdiSettings("Main"), sceneId: "s1" }
const foyer: BroadcastOutput = { id: "foyer", name: "Foyer TV", type: "browser", themeId: theme, monitorIndex: 0, ndi: defaultNdiSettings("Foyer"), feedToken: "f".repeat(32), tvs: [{ name: "Foyer Google TV", address: "192.168.1.40", sentAt: Date.now() }] }
const scene = { id: "s1", name: "Sermon split", background: "#000", layers: [{ id: "a", name: "Pulpit place", kind: "camera", cameraUrl: "http://192.168.1.20:8889/pulpit/whep", cameraFallback: "Back soon", noSignal: "words", box: { x: 0, y: 0, w: 1, h: 1 } }] } as unknown as Scene

const roots: Root[] = []
async function mount(node: React.ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  const el = document.createElement("div")
  document.body.appendChild(el)
  const root = createRoot(el)
  roots.push(root)
  await act(async () => root.render(node))
  await flush()
  return el
}
const button = (el: ParentNode, text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.includes(text) || b.getAttribute("aria-label") === text) as HTMLButtonElement | undefined

beforeEach(() => {
  calls.length = 0
  for (const k of Object.keys(answers)) delete answers[k]
  answers.camera_router_status = router([{ name: "pulpit", live: false, source: null, readers: 0, tracks: [] }])
  answers.feed_status = { watching: 0, seq: 4, acked: 0 }
  answers.get_http_status = { running: false, lan: false, port: null }
  answers.get_osc_status = { running: false, lan: false, port: null }
  answers.get_remote_auth_status = { required: true, credential_count: 0 }
  useSettingsStore.setState({ cameras: [{ name: "pulpit", label: "Pulpit", token: "p".repeat(32) }] })
  useBroadcastStore.setState({ themes: BUILTIN_THEMES, outputs: [main, foyer], scenes: [scene], outputStatus: { main: { previewOpen: true, ndiActive: false }, foyer: { previewOpen: false, ndiActive: false, feedActive: true } } })
  useShellStore.setState({ workspace: "production" })
  useProductionTab.setState({ requested: "health" })
})
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()))
  document.body.replaceChildren()
})

describe("Show health: cameras and Google TVs (#213)", () => {
  it("warns when a running LAN listener accepts commands without authentication and opens Remote settings", async () => {
    answers.get_http_status = { running: true, lan: true, port: 8080, tls_port: null }
    answers.get_osc_status = { running: false, lan: false, port: null }
    answers.get_remote_auth_status = { required: false, credential_count: 0 }
    useSettingsStore.setState({
      remoteAuthRequired: false,
      remoteSecret: "",
      remoteDevices: [],
      remoteListeners: { osc: false, http: true, oscPort: 8000, httpPort: 8080, lan: true },
    })
    const el = await mount(<><SignalWatch /><ProductionWorkspace /></>)
    const card = el.querySelector('[aria-label="Remote control access"]')!

    expect(card.textContent).toContain("Unauthenticated LAN control is enabled")
    expect(card.textContent).toContain("HTTP · LAN · port 8080")
    expect(card.textContent).toContain("Any device on a local/private network that can reach this listener can send remote commands")
    expect(card.textContent).toContain("Public-source commands are refused")
    await act(async () => button(card, "Review Remote settings")!.click())
    expect(useSettingsDialogStore.getState()).toMatchObject({ isOpen: true, activeSection: "remote" })
  })

  it("uses the listener's actual LAN scope and keeps local-only and stopped states calm", async () => {
    answers.get_http_status = { running: false, lan: false, port: null }
    answers.get_osc_status = { running: true, lan: true, port: 8000 }
    answers.get_remote_auth_status = { required: false, credential_count: 0 }
    useSettingsStore.setState({
      remoteAuthRequired: false,
      remoteSecret: "",
      remoteDevices: [],
      remoteListeners: { osc: true, http: false, oscPort: 8000, httpPort: 8080, lan: true },
    })
    const el = await mount(<><SignalWatch /><ProductionWorkspace /></>)
    const card = el.querySelector('[aria-label="Remote control access"]')!
    expect(card.textContent).toContain("Unauthenticated LAN control is enabled")
    expect(card.textContent).toContain("OSC · LAN · port 8000")

    answers.get_osc_status = { running: false, lan: false, port: null }
    answers.get_http_status = { running: true, lan: false, port: 8080 }
    useSettingsStore.setState({ remoteListeners: { osc: false, http: true, oscPort: 8000, httpPort: 8080, lan: false } })
    // The next status poll reflects a listener bound only to this computer.
    await act(async () => { await new Promise((r) => setTimeout(r, 3200)) })
    expect(card.textContent).toContain("No LAN listener is accepting remote commands")
    expect(card.textContent).not.toContain("Unauthenticated LAN control is enabled")
  })

  it("reports an unknown listener state instead of assuming LAN control is safe", async () => {
    answers.get_http_status = new Error("status unavailable")
    answers.get_osc_status = new Error("status unavailable")
    answers.get_remote_auth_status = new Error("status unavailable")
    const el = await mount(<><SignalWatch /><ProductionWorkspace /></>)
    const card = el.querySelector('[aria-label="Remote control access"]')!
    expect(card.textContent).toContain("Unable to verify remote listener state")
    expect(card.textContent).not.toContain("No LAN listener is accepting remote commands")
  })

  it("says commands are refused when a LAN listener requires auth but no credential is configured", async () => {
    answers.get_http_status = { running: true, lan: true, port: 8080 }
    answers.get_osc_status = { running: false, lan: false, port: null }
    answers.get_remote_auth_status = { required: true, credential_count: 0 }
    useSettingsStore.setState({ remoteAuthRequired: true, remoteSecret: "", remoteDevices: [] })
    const el = await mount(<><SignalWatch /><ProductionWorkspace /></>)
    const card = el.querySelector('[aria-label="Remote control access"]')!
    expect(card.textContent).toContain("A key or paired device is required")
    expect(card.textContent).toContain("remote commands are currently refused")
    expect(card.textContent).not.toContain("Unauthenticated LAN control is enabled")
  })

  it("uses the backend's effective auth state when legacy settings still say off", async () => {
    answers.get_http_status = { running: true, lan: true, port: 8080 }
    answers.get_remote_auth_status = { required: true, credential_count: 1 }
    useSettingsStore.setState({ remoteAuthRequired: false, remoteSecret: "legacy-key" })
    const el = await mount(<><SignalWatch /><ProductionWorkspace /></>)
    const card = el.querySelector('[aria-label="Remote control access"]')!
    expect(card.textContent).toContain("A key or paired device is required")
    expect(card.textContent).not.toContain("Unauthenticated LAN control is enabled")
  })

  it("a scene on air whose camera is not sending is an attention item; the feed says no screen is watching", async () => {
    const el = await mount(<><SignalWatch /><ProductionWorkspace /></>)
    await flush()
    expect(calls.some((c) => c.cmd === "camera_router_status")).toBe(true)
    expect(calls.some((c) => c.cmd === "feed_status" && c.args.id === "foyer")).toBe(true)
    expect(el.querySelector('[aria-label="Needs attention"]')?.textContent).toContain('Pulpit camera is not sending; "Sermon split" on Main shows its fallback words there')
    const cam = el.querySelector('[aria-label="Camera signals"] li[aria-label="Pulpit"]')!.textContent
    expect(cam).toContain("Not sending")
    expect(cam).toContain("on air on Main")
    expect(el.querySelector('[aria-label="Feed signals"] li[aria-label="Foyer TV"]')?.textContent).toContain("No screen watching")
    // The preflight says the same (Home reads it too).
    const preflight = el.querySelector('section[aria-label="Sunday preflight"]')!.textContent
    expect(preflight).toContain("Pulpit camera is not sending")
    expect(preflight).toContain("Main (on air now)")
    expect(preflight).toContain("Foyer TV: no screen is watching")
  })

  it("a sending camera shows what it sends and who watches; a screen showing the latest is counted", async () => {
    answers.camera_router_status = router([{ name: "pulpit", live: true, source: "webRTCSession", readers: 3, tracks: ["H264"] }])
    answers.feed_status = { watching: 2, seq: 4, acked: 4 }
    const el = await mount(<><SignalWatch /><ProductionWorkspace /></>)
    await flush()
    expect(el.querySelector('[aria-label="Needs attention"]')).toBeNull()
    expect(el.querySelector('li[aria-label="Pulpit"]')?.textContent).toContain("Sending (H264) · fps: no Rhema screen plays it now · watched by 3 screens or programs")
    expect(el.querySelector('li[aria-label="Foyer TV"]')?.textContent).toContain("2 screens showing the latest")
  })

  it("lists the TVs a feed was sent to; Check TV asks the TV what it shows; Forget removes it", async () => {
    answers.tv_status = { name: "Foyer Google TV", feed: "foyer", problem: null }
    const el = await mount(<><SignalWatch /><ProductionWorkspace /></>)
    const tvs = el.querySelector('[aria-label="TVs showing Foyer TV"]')!
    expect(tvs.textContent).toContain("Foyer Google TV · 192.168.1.40")
    await act(async () => button(tvs, "Check TV")!.click())
    await flush()
    expect(calls.find((c) => c.cmd === "tv_status")?.args).toEqual({ address: "192.168.1.40" })
    expect(tvs.textContent).toContain("Showing this feed")
    answers.tv_status = new Error("This TV's Rhema Studio Receiver is too old to be checked: install version 1.1 or newer on it.")
    await act(async () => button(tvs, "Check TV")!.click())
    await flush()
    expect(tvs.textContent).toContain("too old to be checked")
    await act(async () => button(tvs, "Forget")!.click())
    expect(useBroadcastStore.getState().outputs.find((o) => o.id === "foyer")?.tvs).toEqual([])
  })

  it("stops asking when Production, Present and Home are all closed", async () => {
    useBroadcastStore.setState({ outputStatus: { foyer: { previewOpen: false, ndiActive: false, feedActive: true } } })
    await mount(<SignalWatch />)
    expect(calls.some((c) => c.cmd === "camera_router_status")).toBe(true)
    await act(async () => useShellStore.setState({ workspace: "library" }))
    calls.length = 0
    await act(async () => { await new Promise((r) => setTimeout(r, 2200)) })
    expect(calls.filter((c) => c.cmd === "camera_router_status" || c.cmd === "feed_status")).toEqual([])
  })

  it("keeps asking the router while a scene with a camera is on air, wherever the operator is (#213)", async () => {
    await mount(<SignalWatch />)
    await act(async () => useShellStore.setState({ workspace: "library" }))
    calls.length = 0
    await act(async () => { await new Promise((r) => setTimeout(r, 2200)) })
    expect(calls.some((c) => c.cmd === "camera_router_status")).toBe(true)
    expect(calls.some((c) => c.cmd === "feed_status")).toBe(false)
  })
})

describe("Show on a Google TV remembers the TV (#213)", () => {
  it("adds the TV to the feed's output, saved or not", async () => {
    // A TV gets only the https link, so the secure page is on (#198).
    answers.get_http_status = { running: true, lan: true, port: 8080, tls_port: 8081 }
    answers.remote_lan_address = "192.168.1.20"
    answers.tv_show = "Hall TV"
    const hall: BroadcastOutput = { ...foyer, id: "hall", name: "Hall", tvs: undefined }
    useBroadcastStore.setState({ outputs: [main, hall] })
    const onSubmit = vi.fn()
    await mount(<OutputEditorDialog open onOpenChange={() => {}} output={hall} draft={main} monitors={[]} monitorsRefreshing={false} onRefreshMonitors={() => {}} onSubmit={onSubmit} />)
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    const type = async (label: string, value: string) => {
      const input = document.body.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement
      await act(async () => { set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })) })
    }
    await type("TV address", "192.168.1.41")
    await type("Code on the TV", "123456")
    await act(async () => button(document.body, "Show on TV")!.click())
    await flush()
    expect(calls.find((c) => c.cmd === "tv_show")?.args).toMatchObject({ address: "192.168.1.41", code: "123456", url: expect.stringMatching(/^https:\/\/192\.168\.1\.20:8081\/feed\/hall\?k=/) })
    // Its own key (#198): in its link (not the feed's), known to the listener before the link went, and kept.
    const own = (calls.find((c) => c.cmd === "tv_show")!.args.url as string).split("?k=")[1]
    expect(own).toMatch(/^[0-9a-f]{32}$/)
    expect(own).not.toBe(hall.feedToken)
    const sets = calls.filter((c) => c.cmd === "feeds_set")
    const before = calls.findIndex((c) => c.cmd === "tv_show")
    expect(calls.slice(0, before).some((c) => c.cmd === "feeds_set" && JSON.stringify(c.args).includes(own))).toBe(true)
    expect(JSON.stringify(sets.at(-1)!.args)).toContain(own)
    expect(useBroadcastStore.getState().outputs.find((o) => o.id === "hall")?.tvs).toEqual([{ name: "Hall TV", address: "192.168.1.41", sentAt: expect.any(Number), token: own }])
    expect(document.body.textContent).toContain("Show health lists it under this feed")
  })
})

describe("TVs showing a feed: revoke one (#198)", () => {
  it("lists each TV's size, link and the feed's rule; Revoke withdraws only that TV's key", async () => {
    const hall: BroadcastOutput = {
      ...foyer, id: "hall", name: "Hall", hostLost: { mode: "countdown" }, overscan: 2.5,
      tvs: [{ name: "Hall TV", address: "192.168.1.41:8095", sentAt: Date.now(), token: "a".repeat(32), width: 1920, height: 1080 }, { name: "Old TV", address: "192.168.1.42:8095", sentAt: Date.now() }],
    }
    useBroadcastStore.setState({ outputs: [main, hall], outputStatus: { hall: { previewOpen: false, ndiActive: false, feedActive: true } } })
    answers.feed_status = { watching: 1, seq: 4, acked: 4, tvs: [{ id: "192.168.1.41:8095", watching: 1 }] }
    answers.tv_status = { name: "Old TV", feed: "hall", problem: null, width: 3840, height: 2160 }
    const el = await mount(<><SignalWatch /><ProductionWorkspace /></>)
    await flush()
    const list = el.querySelector('[aria-label="TVs showing Hall"]')!
    const text = list.parentElement!.textContent!
    expect(text).toContain("Public screen · If this computer is lost: counts down to the service start · 2.5% kept clear at each edge")
    expect(text).toContain("Hall TV · 192.168.1.41:8095")
    expect(text).toContain("1920×1080")
    expect(text).toContain("Private link: its own key · following the feed now")
    expect(text).toContain("Shared link")
    expect(button(list, "Revoke Old TV"), "a shared-link TV cannot be revoked alone").toBeUndefined()
    // Check TV keeps the size the TV said.
    await act(async () => button(list, "Check Old TV")!.click())
    await flush()
    expect(useBroadcastStore.getState().outputs.find((o) => o.id === "hall")!.tvs![1]).toMatchObject({ width: 3840, height: 2160 })
    calls.length = 0
    await act(async () => button(list, "Revoke Hall TV")!.click())
    await act(async () => button(list, "Confirm revoke Hall TV")!.click())
    await flush()
    expect(useBroadcastStore.getState().outputs.find((o) => o.id === "hall")!.tvs!.map((t) => t.name)).toEqual(["Old TV"])
    const set = calls.filter((c) => c.cmd === "feeds_set").at(-1)!
    expect(set.args).toEqual({ feeds: [{ id: "hall", token: "f".repeat(32), tvs: [] }] })
  })
})
