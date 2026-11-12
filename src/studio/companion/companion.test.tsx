// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The studio's modules load with App (it is not shown here); one of them needs this browser API.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})

const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = []
let hostAnswer: unknown = null
let hostRefusal: string | null = null
let overlaysAnswer: unknown = { httpPort: 8080, feeds: [] }
let overlaysRefusal: string | null = null
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args })
    if (cmd === "join_cameras") {
      if (hostRefusal) throw hostRefusal
      return hostAnswer
    }
    if (cmd === "join_overlays") {
      if (overlaysRefusal) throw overlaysRefusal
      return overlaysAnswer
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
  overlaysRefusal = null
  overlaysAnswer = { httpPort: 8080, feeds: [] }
  hostAnswer = view()
  obs.inputs.clear()
  obs.scenes.clear()
  obs.states.clear()
  obs.requests = []
  useSettingsStore.setState({ joinAddress: "192.168.1.20:8080", joinToken: "tok", companionLatencyMs: 200, companionMode: false })
  useJoin.setState({ status: "connected", me: { name: "Media desk", role: "obs-companion" }, live: null })
  useCompanion.setState({ cameras: [], srt: null, router: false, hostError: null, heard: false, inputs: {}, tally: { program: [], preview: [] } })
})

describe("OBS companion: following the main computer (#209)", () => {
  it("keeps OBS's camera addresses current and tells the main computer what is on OBS's program", async () => {
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

  it("says plainly when the main computer has taken back control, and touches nothing in OBS for the cameras it cannot read", async () => {
    hostRefusal = "paused: The main computer has taken back control"
    await look()
    expect(useCompanion.getState().hostError).toBe("The main computer has taken back control")
    expect(useCompanion.getState().srt).toBeNull()
    // No old rows saying Sending under the error (#411): cameras read, then the host refuses.
    hostRefusal = null
    await look()
    expect(useCompanion.getState().cameras.length).toBeGreaterThan(0)
    hostRefusal = "paused: The main computer has taken back control"
    await look()
    expect(useCompanion.getState().cameras).toEqual([])
  })

  it("asks nothing of the main computer while it is not joined", async () => {
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

  it("shows only the companion screen in companion mode: the main computer, OBS, and the cameras with who watches", async () => {
    useSettingsStore.setState({ companionMode: true })
    useSettingsStore.setState((s) => ({ obs: { ...s.obs, enabled: true } }))
    useJoin.setState({ live: { cameraFeeds: [{ name: "pulpit", label: "Pulpit", url: null }] } as never })
    await act(async () => root.render(<App />))
    await act(async () => { await look() })
    const text = host.textContent ?? ""
    expect(host.querySelector('[aria-label="OBS companion"]')).not.toBeNull()
    expect(host.querySelector("nav")).toBeNull() // no studio sidebar
    expect(text).toContain("Church cameras in this OBS")
    expect(host.querySelector('[aria-label="OBS connection status"]')?.textContent).toContain("Connected")
    expect(text).toContain("Pulpit")
    expect(text).toContain("H264 · 1280×720 · 2.5 Mbit/s")
    expect(text).toContain("Watching: Media desk (OBS companion)")
    expect(text).toContain("Not sending")
    expect(host.querySelector('select[aria-label="Delay buffer"]')).not.toBeNull()
    const add = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Add to OBS"))
    expect(add?.disabled).toBe(false)
  })

  it("companion mode joins its saved host again by itself when it starts (#411)", async () => {
    useSettingsStore.setState({ companionMode: true })
    useJoin.setState({ status: "off" })
    const connect = vi.spyOn(useJoin.getState(), "connect").mockResolvedValue()
    await act(async () => root.render(<App />))
    expect(connect).toHaveBeenCalledTimes(1)
    connect.mockRestore()
  })

  it("marks OBS unavailable when its saved connection is enabled but cannot connect", async () => {
    useSettingsStore.setState({ companionMode: true })
    useSettingsStore.setState((s) => ({ obs: { ...s.obs, enabled: true } }))
    const { useObsStore } = await import("@/stores/obs-store")
    useObsStore.setState({ status: "error", error: "Connection refused" })
    await act(async () => root.render(<App />))
    expect(host.querySelector('[aria-label="OBS connection status"]')?.textContent).toContain("OBS unreachable")
    expect(host.querySelector('[aria-label="Why OBS is not connected"]')?.textContent).toContain("Connection refused")
  })

  it("says which side failed and why, and that a refused key was revoked (#842)", async () => {
    useSettingsStore.setState({ companionMode: true })
    useJoin.setState({ status: "reconnecting", error: "error sending request for url (https://192.168.1.20:8081/api/v1/live/events)" })
    await act(async () => root.render(<App />))
    expect(host.querySelector('[aria-label="Main computer connection status"]')?.textContent).toBe("Main computer unreachable")
    expect(host.querySelector('[aria-label="Why the main computer is not connected"]')?.textContent).toContain("error sending request")
    await act(async () => useJoin.setState({ status: "refused", error: "The main computer refused this computer (403): pair again" }))
    expect(host.querySelector('[aria-label="Main computer connection status"]')?.textContent).toBe("Key revoked")
    expect(host.querySelector('[aria-label="Why the main computer is not connected"]')?.textContent).toContain("Pair a device")
    // Trying a revoked key again cannot help: only Leave (and pair again) is offered.
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Try again")).toBe(false)
    // The crate's certificate-mismatch words (pin.rs) say "pair again" too: a security warning, not a revoked key.
    await act(async () => useJoin.setState({ status: "reconnecting", error: "The main computer's certificate is not the one this computer paired with, so nothing was sent: pair again if the main computer was reinstalled (Leave this main computer, then join with a new code). Otherwise another computer may be pretending to be the main computer." }))
    expect(host.querySelector('[aria-label="Main computer connection status"]')?.textContent).toBe("Main computer certificate changed: this may not be your Rhema computer")
  })

  it("asks before leaving the main computer, and stays joined on Stay (#831)", async () => {
    useSettingsStore.setState({ companionMode: true })
    const leave = vi.spyOn(useJoin.getState(), "leave").mockResolvedValue()
    await act(async () => root.render(<App />))
    const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text)
    await act(async () => button("Leave this main computer")!.click())
    expect(leave).not.toHaveBeenCalled()
    expect(host.querySelector('[aria-label="Leave this main computer?"]')?.textContent).toContain("new pairing code")
    await act(async () => button("Stay joined")!.click())
    expect(host.querySelector('[aria-label="Leave this main computer?"]')).toBeNull()
    expect(leave).not.toHaveBeenCalled()
    await act(async () => button("Leave this main computer")!.click())
    await act(async () => button("Leave and forget the main computer")!.click())
    expect(leave).toHaveBeenCalledWith(true)
    leave.mockRestore()
  })

  it("lists Rhema's overlays already in OBS, and offers to add one to an existing scene (#848)", async () => {
    useSettingsStore.setState({ companionMode: true })
    const { useObsStore } = await import("@/stores/obs-store")
    useObsStore.setState({ status: "connected", error: null })
    obs.inputs.set("Bible (Rhema overlay)", { url: "http://192.168.1.20:8080/feed/out-bible?k=0123456789abcdef", width: 1920, height: 1080 })
    obs.inputs.set("My own page", { url: "https://example.org/x.html" })
    await act(async () => root.render(<App />))
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    const list = host.querySelector('[aria-label="Overlays in OBS"]')
    expect(list?.textContent).toContain("Bible (Rhema overlay)")
    expect(list?.textContent).not.toContain("My own page")
    const scenes = [...host.querySelectorAll('select[aria-label="OBS scene for the overlay"] option')].map((o) => o.textContent)
    expect(scenes).toEqual(["Pick a scene…", "Service", "Wide"])
    expect(obs.requests.some((r) => r.startsWith("Remove") || r === "CreateScene")).toBe(false)
    // The overlay's key is not shown on screen, only its last four characters.
    const field = host.querySelector<HTMLInputElement>('input[aria-label="Feed link for Bible (Rhema overlay)"]')!
    expect(field.value).toBe("http://192.168.1.20:8080/feed/out-bible?k=••••cdef")
  })

  it("will not add an overlay whose link is for another computer unless the operator says so (#865)", async () => {
    useSettingsStore.setState({ companionMode: true })
    const { useObsStore } = await import("@/stores/obs-store")
    useObsStore.setState({ status: "connected", error: null })
    await act(async () => root.render(<App />))
    const form = host.querySelector('form[aria-label="Add an overlay"]')!
    const set = (el: HTMLInputElement | HTMLSelectElement, v: string) => {
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v)
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }))
    }
    const add = () => [...form.querySelectorAll("button")].find((b) => b.textContent?.includes("Add to the scene"))!
    await act(async () => {
      set(form.querySelector<HTMLSelectElement>('select[aria-label="OBS scene for the overlay"]')!, "Wide")
      set(form.querySelector<HTMLInputElement>('input[aria-label="Feed link"]')!, "http://10.9.9.9:8080/feed/out-bible?k=0123456789abcdef")
    })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(form.textContent).toContain("not for the main computer this Companion joined")
    expect(add().disabled).toBe(true)
    await act(async () => form.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    expect(add().disabled).toBe(false)
    // The paired host's own address needs no confirmation.
    await act(async () => set(form.querySelector<HTMLInputElement>('input[aria-label="Feed link"]')!, "http://192.168.1.20:8080/feed/out-bible?k=0123456789abcdef"))
    expect(form.textContent).not.toContain("not for the main computer this Companion joined")
    expect(add().disabled).toBe(false)
  })

  it("offers the main computer's overlay feeds: picking one fills the overlay and its link for the paired host (#848 G4)", async () => {
    overlaysAnswer = { httpPort: 8080, feeds: [{ id: "out-clock", name: "Rhema Clock", kind: "timer", path: "/feed/out-clock?k=0123456789abcdef" }] }
    useSettingsStore.setState({ companionMode: true, joinAddress: "192.168.1.20:8443" })
    const { useObsStore } = await import("@/stores/obs-store")
    useObsStore.setState({ status: "connected", error: null })
    await act(async () => root.render(<App />))
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(calls.find((c) => c.cmd === "join_overlays")?.args).toEqual({ address: "192.168.1.20:8443", token: "tok" })
    const form = host.querySelector('form[aria-label="Add an overlay"]')!
    const pick = form.querySelector<HTMLSelectElement>('select[aria-label="Feed from the main computer"]')!
    expect([...pick.options].map((o) => o.textContent)).toEqual(["Pick a feed, or paste a link below…", "Rhema Clock (Timer)"])
    const set = (el: HTMLSelectElement, v: string) => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v)
      el.dispatchEvent(new Event("change", { bubbles: true }))
    }
    await act(async () => {
      set(pick, "out-clock")
      set(form.querySelector<HTMLSelectElement>('select[aria-label="OBS scene for the overlay"]')!, "Wide")
    })
    expect(form.querySelector<HTMLSelectElement>('select[aria-label="Overlay"]')!.value).toBe("timer")
    // The key stays hidden on screen; the link is the paired host's own, so no warning.
    expect(form.querySelector<HTMLInputElement>('input[aria-label="Feed link"]')!.value).toBe("http://192.168.1.20:8080/feed/out-clock?k=••••cdef")
    expect(form.textContent).not.toContain("not for the main computer this Companion joined")
    expect([...form.querySelectorAll("button")].find((b) => b.textContent?.includes("Add to the scene"))!.disabled).toBe(false)
  })

  it("says why the main computer's feeds cannot be listed, and keeps pasting a link possible", async () => {
    overlaysRefusal = "paused: The main computer has taken back control"
    useSettingsStore.setState({ companionMode: true })
    const { useObsStore } = await import("@/stores/obs-store")
    useObsStore.setState({ status: "connected", error: null })
    await act(async () => root.render(<App />))
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    const form = host.querySelector('form[aria-label="Add an overlay"]')!
    expect(form.textContent).toContain("The main computer's feeds cannot be listed: The main computer has taken back control")
    expect(form.querySelector('select[aria-label="Feed from the main computer"]')).toBeNull()
    expect(form.querySelector('input[aria-label="Feed link"]')).not.toBeNull()
  })

  it("tells the operator when the main computer gave this computer another role", async () => {
    useSettingsStore.setState({ companionMode: true })
    useJoin.setState({ me: { name: "Media desk", role: "present" } })
    await act(async () => root.render(<App />))
    expect(host.textContent).toContain("set \"Media desk\" to OBS companion")
  })

  it("offers the join form, pairing as an OBS companion, until it has joined", async () => {
    // Not paired yet: nothing saved to join again by itself.
    useSettingsStore.setState({ companionMode: true, joinAddress: null, joinToken: null } as never)
    useJoin.setState({ status: "off" })
    const pair = vi.spyOn(useJoin.getState(), "pair")
    await act(async () => root.render(<App />))
    expect(host.textContent).toContain("to take its cameras into OBS here")
    const input = (label: string) => [...host.querySelectorAll("label")].find((l) => l.textContent?.includes(label))!.querySelector("input")!
    await act(async () => {
      const set = (el: HTMLInputElement, v: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })) }
      set(input("Main computer address"), "192.168.1.20:8080")
      set(input("Pairing code"), "123456")
    })
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
    expect(pair).toHaveBeenCalledWith("192.168.1.20:8080", "123456", expect.any(String), true)
  })
})
