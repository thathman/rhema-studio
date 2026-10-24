// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The studio's modules load with App (it is not shown here); one of them needs this browser API.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})

const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = []
let hostAnswer: unknown = null
let hostRefusal: string | null = null
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args })
    if (cmd === "join_cameras") {
      if (hostRefusal) throw hostRefusal
      return hostAnswer
    }
    if (cmd === "host_discover") return []
    return null
  }),
}))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), info: vi.fn(), warning: vi.fn(), success: vi.fn() }), Toaster: () => null }))

/** This computer's OBS, in memory: inputs with settings, scenes with items, media states. */
const obs = {
  inputs: new Map<string, Record<string, unknown>>(),
  scenes: new Map<string, string[]>(),
  states: new Map<string, string>(),
  requests: [] as string[],
}
vi.mock("@/stores/obs-store", async () => {
  const { create } = await import("zustand")
  const useObsStore = create(() => ({ status: "connected", program: "Service", preview: null, studioMode: false, scenes: ["Service", "Wide"] }))
  const obsRequest = async (type: string, data: Record<string, unknown> = {}) => {
    obs.requests.push(type)
    const name = String(data.inputName ?? data.sceneName ?? "")
    switch (type) {
      case "GetInputList":
        return { inputs: [...obs.inputs.keys()].map((inputName) => ({ inputName })) }
      case "GetInputSettings":
        return { inputSettings: obs.inputs.get(name) }
      case "SetInputSettings":
        obs.inputs.set(name, { ...obs.inputs.get(name), ...(data.inputSettings as Record<string, unknown>) })
        return {}
      case "GetMediaInputStatus":
        return { mediaState: obs.states.get(name) ?? "OBS_MEDIA_STATE_PLAYING" }
      case "GetSceneItemList":
        return { sceneItems: (obs.scenes.get(name) ?? []).map((sourceName) => ({ sourceName, sceneItemEnabled: true, sourceType: "OBS_SOURCE_TYPE_INPUT" })) }
      case "TriggerMediaInputAction":
        return {}
      default:
        throw new Error(`unexpected ${type}`)
    }
  }
  return { useObsStore, obsRequest }
})

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { useSettingsStore } from "@/stores/settings-store"
import { useJoin } from "@/stores/join-store"
import { look, useCompanion } from "@/stores/companion-store"
import { companionUrl } from "@/lib/obs-companion"
import { App } from "@/App"

const SRT = { port: 8890, passphrase: "0123456789abcdef0123456789abcdef", user: "read-a1b2c3d4", pass: "a".repeat(64), path: "companion/" }
const view = (pass = SRT.pass) => ({ router: true, srt: { ...SRT, pass }, cameras: [{ name: "pulpit", live: true, readers: 2, tracks: ["H264"], width: 1280, height: 720, kbps: 2500, watchers: [{ kind: "companion", name: "Media desk (OBS companion)", remote: true }], obs: [] }, { name: "choir", live: false, readers: 0, tracks: [], watchers: [], obs: [] }] })

beforeEach(() => {
  calls.length = 0
  hostRefusal = null
  hostAnswer = view()
  obs.inputs.clear()
  obs.scenes.clear()
  obs.states.clear()
  obs.requests = []
  useSettingsStore.setState({ joinAddress: "192.168.1.20:8080", joinToken: "tok", companionLatencyMs: 200, companionMode: false })
  useJoin.setState({ status: "connected", me: { name: "Media desk", role: "obs-companion" }, live: null })
  useCompanion.setState({ cameras: [], srt: null, router: false, hostError: null, heard: false, inputs: {}, tally: { program: [], preview: [] } })
})

describe("OBS companion: following the host (#209)", () => {
  it("keeps OBS's camera addresses current and tells the host what is on OBS's program", async () => {
    // Pulpit is in OBS from an earlier run (an old address) and on the program scene.
    obs.inputs.set("Pulpit (Rhema camera)", { input: companionUrl("192.168.1.20", { ...SRT, pass: "b".repeat(64) }, "pulpit", 200) })
    obs.inputs.set("Mic", { device: "x" })
    obs.scenes.set("Service", ["Pulpit (Rhema camera)", "Mic"])
    await look()
    const want = companionUrl("192.168.1.20", SRT, "pulpit", 200)
    expect(obs.inputs.get("Pulpit (Rhema camera)")!.input).toBe(want)
    expect(obs.requests).toContain("TriggerMediaInputAction")
    expect(useCompanion.getState().inputs.pulpit).toEqual({ input: "Pulpit (Rhema camera)", state: "playing" })
    const tally = calls.find((c) => c.cmd === "join_tally")
    expect(tally?.args).toEqual({ address: "192.168.1.20:8080", token: "tok", tally: { program: ["pulpit"], preview: [], receiving: ["pulpit"] } })
    // The delay buffer changed: the next look gives OBS the new address.
    useSettingsStore.getState().setCompanionLatencyMs(400)
    await look()
    expect(String(obs.inputs.get("Pulpit (Rhema camera)")!.input)).toContain("latency=400000")
  })

  it("starts a camera again in OBS when it ended while the phone still sends", async () => {
    obs.inputs.set("Pulpit (Rhema camera)", { input: companionUrl("192.168.1.20", SRT, "pulpit", 200) })
    obs.states.set("Pulpit (Rhema camera)", "OBS_MEDIA_STATE_ENDED")
    await look()
    expect(obs.requests.filter((r) => r === "TriggerMediaInputAction")).toHaveLength(1)
    expect(useCompanion.getState().inputs.pulpit.state).toBe("ended")
  })

  it("says plainly when the host has taken back control, and touches nothing in OBS for the cameras it cannot read", async () => {
    hostRefusal = "paused: The main desk has taken back control"
    await look()
    expect(useCompanion.getState().hostError).toBe("The main desk has taken back control")
    expect(useCompanion.getState().srt).toBeNull()
  })

  it("asks nothing of the host while it is not joined", async () => {
    useJoin.setState({ status: "off" })
    await look()
    expect(calls.some((c) => c.cmd === "join_cameras" || c.cmd === "join_tally")).toBe(false)
  })
})

describe("OBS companion screen (#209)", () => {
  let root: Root
  let host: HTMLDivElement
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it("shows only the companion screen in companion mode: the host, OBS, and the cameras with who watches", async () => {
    useSettingsStore.setState({ companionMode: true })
    useJoin.setState({ live: { cameraFeeds: [{ name: "pulpit", label: "Pulpit", url: null }] } as never })
    await act(async () => root.render(<App />))
    await act(async () => { await look() })
    const text = host.textContent ?? ""
    expect(host.querySelector('[aria-label="OBS companion"]')).not.toBeNull()
    expect(host.querySelector("nav")).toBeNull() // no studio sidebar
    expect(text).toContain("The church's cameras, in this computer's OBS")
    expect(text).toContain("Pulpit")
    expect(text).toContain("H264 · 1280×720 · 2.5 Mbit/s")
    expect(text).toContain("Watching: Media desk (OBS companion)")
    expect(text).toContain("Not sending")
    expect(host.querySelector('select[aria-label="Delay buffer"]')).not.toBeNull()
    const add = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Add to OBS"))
    expect(add?.disabled).toBe(false)
  })

  it("tells the operator when the host gave this computer another role", async () => {
    useSettingsStore.setState({ companionMode: true })
    useJoin.setState({ me: { name: "Media desk", role: "present" } })
    await act(async () => root.render(<App />))
    expect(host.textContent).toContain("set \"Media desk\" to OBS companion")
  })

  it("offers the join form, pairing as an OBS companion, until it has joined", async () => {
    useSettingsStore.setState({ companionMode: true })
    useJoin.setState({ status: "off" })
    const pair = vi.spyOn(useJoin.getState(), "pair")
    await act(async () => root.render(<App />))
    expect(host.textContent).toContain("to take its cameras into OBS here")
    const input = (label: string) => [...host.querySelectorAll("label")].find((l) => l.textContent?.includes(label))!.querySelector("input")!
    await act(async () => {
      const set = (el: HTMLInputElement, v: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })) }
      set(input("Host address"), "192.168.1.20:8080")
      set(input("Pairing code"), "123456")
    })
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
    expect(pair).toHaveBeenCalledWith("192.168.1.20:8080", "123456", expect.any(String), true)
  })
})
