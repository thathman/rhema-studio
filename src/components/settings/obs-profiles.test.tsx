// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn(), success: vi.fn() } }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

/** An OBS that answers Hello/Identify and GetVersion, and records every request. */
class VersionObs {
  static urls: string[] = []
  static requests: string[] = []
  readyState = 1
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(url: string) {
    VersionObs.urls.push(url)
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ op: 0, d: { rpcVersion: 1 } }) }))
  }
  send(raw: string) {
    const m = JSON.parse(raw) as { op: number; d: Record<string, unknown> }
    if (m.op === 1) return queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ op: 2, d: {} }) }))
    VersionObs.requests.push(String(m.d.requestType))
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ op: 7, d: { requestId: m.d.requestId, requestStatus: { result: true, code: 100 }, responseData: { obsVersion: "30.2.0", obsWebSocketVersion: "5.5.0" } } }) }))
  }
  close() {
    this.readyState = 3
  }
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve() })
}

let root: Root | null = null
describe("saved OBS computers (#197)", () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal("WebSocket", VersionObs)
    VersionObs.urls = []
    VersionObs.requests = []
  })
  afterEach(async () => {
    if (root) await act(async () => root!.unmount())
    root = null
    vi.unstubAllGlobals()
  })

  it("saves the connection under a name, tests one without using it, and uses one on a click", async () => {
    vi.resetModules()
    const { useSettingsStore } = await import("@/stores/settings-store")
    useSettingsStore.setState({ obs: { enabled: false, host: "192.168.1.30", port: 4455, password: "pw" }, obsProfiles: [{ id: "b", label: "Backup laptop", host: "192.168.1.31", port: 4456, password: "" }] })
    const { ObsSettingsBlock } = await import("./obs-settings-block")
    const el = document.createElement("div")
    document.body.appendChild(el)
    root = createRoot(el)
    await act(async () => root!.render(<ObsSettingsBlock />))
    const button = (label: string) => el.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement
    const name = el.querySelector('input[aria-label="Name for this OBS connection"]') as HTMLInputElement
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
      set.call(name, "Main stream PC")
      name.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => [...el.querySelectorAll("button")].find((b) => b.textContent === "Save this connection")!.click())
    expect(useSettingsStore.getState().obsProfiles.map((p) => [p.label, p.host, p.password])).toEqual([["Backup laptop", "192.168.1.31", ""], ["Main stream PC", "192.168.1.30", "pw"]])
    expect(el.querySelector('[aria-label="Main stream PC"]')?.textContent).toContain("In use")

    await act(async () => button("Test Backup laptop").click())
    await settle()
    expect(VersionObs.urls).toEqual(["ws://192.168.1.31:4456"])
    expect(VersionObs.requests).toEqual(["GetVersion"])
    expect(el.querySelector('[aria-label="Backup laptop"]')?.textContent).toContain("Reached OBS 30.2.0 (WebSocket 5.5.0)")
    expect(useSettingsStore.getState().obs.host).toBe("192.168.1.30") // testing does not switch

    await act(async () => button("Use Backup laptop").click())
    expect(useSettingsStore.getState().obs).toMatchObject({ host: "192.168.1.31", port: 4456, password: "" })
  })
})
