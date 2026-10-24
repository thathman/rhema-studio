// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn(), success: vi.fn() } }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

/**
 * A small fake OBS speaking obs-websocket v5 (Hello, Identify, Request, RequestResponse, Event):
 * it keeps its own scenes, program, preview and Studio Mode, and announces changes the way OBS does.
 */
class FakeObs {
  static last: FakeObs | null = null
  readyState = 1
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  identify: Record<string, unknown> | null = null
  requests: Array<{ type: string; data?: Record<string, unknown> }> = []
  scenes = ["Wide", "Pulpit", "Choir"] // OBS's list, top first
  program = "Wide"
  preview = "Pulpit"
  studioMode = false
  /** OBS → Settings → Video: the output size and frame rate. */
  video = { baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080, fpsNumerator: 60, fpsDenominator: 1 }
  url: string
  constructor(url: string) {
    this.url = url
    FakeObs.last = this
    queueMicrotask(() => this.push(0, { obsWebSocketVersion: "5.5.0", rpcVersion: 1 }))
  }
  private push(op: number, d: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify({ op, d }) })
  }
  event(eventType: string, eventData: Record<string, unknown> = {}) {
    this.push(5, { eventType, eventIntent: 0, eventData })
  }
  /** OBS's scene list: bottom of its list first, sceneIndex 0. */
  private list() {
    return [...this.scenes].reverse().map((sceneName, sceneIndex) => ({ sceneName, sceneIndex, sceneUuid: `uuid-${sceneName}` }))
  }
  send(raw: string) {
    const msg = JSON.parse(raw) as { op: number; d: Record<string, unknown> }
    if (msg.op === 1) {
      this.identify = msg.d
      queueMicrotask(() => this.push(2, { negotiatedRpcVersion: 1 }))
      return
    }
    if (msg.op !== 6) return
    const type = String(msg.d.requestType)
    const data = msg.d.requestData as Record<string, unknown> | undefined
    this.requests.push({ type, data })
    let ok = true
    let code = 100
    let responseData: Record<string, unknown> | undefined
    const after: Array<() => void> = []
    if (type === "GetRecordStatus") responseData = { outputActive: false, outputPaused: false }
    else if (type === "GetVideoSettings") responseData = this.video
    else if (type === "GetStudioModeEnabled") responseData = { studioModeEnabled: this.studioMode }
    else if (type === "GetSceneList") responseData = { currentProgramSceneName: this.program, currentPreviewSceneName: this.studioMode ? this.preview : null, scenes: this.list() }
    else if (type === "SetCurrentPreviewScene") {
      if (!this.studioMode) { ok = false; code = 506 } else { this.preview = String(data?.sceneName); after.push(() => this.event("CurrentPreviewSceneChanged", { sceneName: this.preview })) }
    } else if (type === "SetCurrentProgramScene") {
      this.program = String(data?.sceneName)
      after.push(() => this.event("CurrentProgramSceneChanged", { sceneName: this.program }))
    } else if (type === "TriggerStudioModeTransition") {
      if (!this.studioMode) { ok = false; code = 506 } else {
        ;[this.program, this.preview] = [this.preview, this.program]
        after.push(() => this.event("CurrentProgramSceneChanged", { sceneName: this.program }))
        after.push(() => this.event("CurrentPreviewSceneChanged", { sceneName: this.preview }))
      }
    } else { ok = false; code = 204 }
    queueMicrotask(() => {
      this.push(7, { requestType: type, requestId: msg.d.requestId, requestStatus: { result: ok, code }, responseData })
      after.forEach((f) => f())
    })
  }
  /** OBS quits or the network drops. */
  drop() {
    this.readyState = 3
    this.onclose?.({ code: 1006, reason: "" })
  }
  close() {
    this.readyState = 3
  }
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve() })
}

async function setup(opts: { studioMode?: boolean } = {}) {
  vi.resetModules()
  const { useSettingsStore } = await import("@/stores/settings-store")
  // Set before the OBS store loads, so its settings-driven connect does not also run.
  useSettingsStore.setState({ obs: { enabled: true, host: "192.168.1.30", port: 4455, password: "" } })
  const { useObsStore } = await import("@/stores/obs-store")
  const { useJournalStore } = await import("@/stores/journal-store")
  const pending = useObsStore.getState().connect()
  if (opts.studioMode) FakeObs.last!.studioMode = true
  await pending
  await settle()
  return { useObsStore, useJournalStore, obs: FakeObs.last! }
}

let root: Root | null = null
async function render() {
  const { ObsPanel } = await import("./obs-panel")
  const el = document.createElement("div")
  document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => root!.render(<ObsPanel />))
  const button = (text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined
  const row = (name: string) => [...el.querySelectorAll('[aria-label="OBS scene list"] li')].find((li) => li.querySelector("span")?.textContent === name) as HTMLElement
  return { el, button, row }
}

/** The last request that is not one of the reads "Camera follows OBS" makes after a program change (#208). */
const PROGRAM_READS = ["GetInputList", "GetInputSettings", "GetSceneItemList", "GetGroupSceneItemList"]
const lastCommand = (requests: { type: string }[]) => requests.filter((r) => !PROGRAM_READS.includes(r.type)).at(-1)

describe("OBS scenes, against a fake obs-websocket", { timeout: 30_000 }, () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    // The store asks OBS for its record status every 2 s. Under load that poll could land between a
    // click and the check of OBS's last request; with the interval faked it only runs when a test says.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    vi.stubGlobal("WebSocket", FakeObs)
    FakeObs.last = null
  })
  afterEach(async () => {
    if (root) await act(async () => root!.unmount())
    root = null
    const { useObsStore } = await import("@/stores/obs-store")
    useObsStore.getState().disconnect()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("names the online program with OBS's own format, and reads it again when OBS changes profile (#215 G5.1)", async () => {
    const { useObsStore, obs } = await setup()
    expect(Number(obs.identify?.eventSubscriptions) & 2).toBe(2) // Config: profile changes
    expect(useObsStore.getState().video).toEqual({ width: 1920, height: 1080, fps: 60 })
    const { el } = await render()
    expect(el.querySelector('[aria-label="OBS program"] h3')?.textContent).toBe("Online program (OBS, 1080p60)")
    obs.video = { ...obs.video, outputWidth: 1280, outputHeight: 720, fpsNumerator: 30000, fpsDenominator: 1001 }
    await act(async () => obs.event("CurrentProfileChanged", { profileName: "Stream" }))
    await settle()
    expect(el.querySelector('[aria-label="OBS program"] h3')?.textContent).toBe("Online program (OBS, 720p29.97)")
    useObsStore.getState().disconnect()
    await settle()
    expect(useObsStore.getState().video).toBeNull()
  })

  it("loads OBS's scene list in OBS's order, its program, and Studio Mode, subscribing to scene and Studio Mode events", async () => {
    const { useObsStore, obs } = await setup()
    expect(obs.url).toBe("ws://192.168.1.30:4455")
    expect(Number(obs.identify?.eventSubscriptions) & 4).toBe(4) // Scenes
    expect(Number(obs.identify?.eventSubscriptions) & 1024).toBe(1024) // Ui: Studio Mode
    const s = useObsStore.getState()
    expect(s.status).toBe("connected")
    expect(s.scenes).toEqual(["Wide", "Pulpit", "Choir"])
    expect(s.program).toBe("Wide")
    expect(s.studioMode).toBe(false)
    expect(s.preview).toBeNull()
  })

  it("follows OBS's own events: a cut made in OBS, a new scene, and Studio Mode on and off", async () => {
    const { useObsStore, obs } = await setup()
    await act(async () => obs.event("CurrentProgramSceneChanged", { sceneName: "Choir" }))
    expect(useObsStore.getState().program).toBe("Choir")
    obs.scenes = ["Announcements", "Wide", "Pulpit", "Choir"]
    await act(async () => obs.event("SceneListChanged", { scenes: [...obs.scenes].reverse().map((sceneName, sceneIndex) => ({ sceneName, sceneIndex })) }))
    expect(useObsStore.getState().scenes).toEqual(["Announcements", "Wide", "Pulpit", "Choir"])
    obs.studioMode = true
    obs.preview = "Pulpit"
    await act(async () => obs.event("StudioModeStateChanged", { studioModeEnabled: true }))
    await settle()
    expect(useObsStore.getState()).toMatchObject({ studioMode: true, preview: "Pulpit" })
    await act(async () => obs.event("CurrentPreviewSceneChanged", { sceneName: "Wide" }))
    expect(useObsStore.getState().preview).toBe("Wide")
    obs.studioMode = false
    await act(async () => obs.event("StudioModeStateChanged", { studioModeEnabled: false }))
    expect(useObsStore.getState()).toMatchObject({ studioMode: false, preview: null })
  })

  it("in Studio Mode, sets OBS's preview and Takes it with OBS's own transition", async () => {
    const { useObsStore, useJournalStore, obs } = await setup({ studioMode: true })
    const { button, row } = await render()
    expect(button("Switch OBS to this scene")).toBeUndefined()
    await act(async () => (row("Choir").querySelector("button") as HTMLButtonElement).click())
    await settle()
    expect(lastCommand(obs.requests)).toEqual({ type: "SetCurrentPreviewScene", data: { sceneName: "Choir" } })
    expect(useObsStore.getState().preview).toBe("Choir")
    expect(useObsStore.getState().program).toBe("Wide") // a preview changes nothing on the stream
    await act(async () => button("Take in OBS")!.click())
    await settle()
    expect(lastCommand(obs.requests)?.type).toBe("TriggerStudioModeTransition")
    expect(obs.requests.some((r) => r.type === "SetCurrentProgramScene")).toBe(false)
    expect(useObsStore.getState()).toMatchObject({ program: "Choir", preview: "Wide" })
    expect(useJournalStore.getState().entries.at(-1)?.label).toBe("OBS: took Choir to its program (from Rhema Studio)")
  })

  it("outside Studio Mode, switching OBS's program asks first, saying it changes the stream", async () => {
    const { useObsStore, obs } = await setup()
    const { el, button, row } = await render()
    expect(button("Set as OBS preview")).toBeUndefined()
    expect(button("Take in OBS")).toBeUndefined()
    await act(async () => (row("Pulpit").querySelector("button") as HTMLButtonElement).click())
    expect(obs.requests.some((r) => r.type === "SetCurrentProgramScene")).toBe(false)
    expect(el.querySelector('[role="alertdialog"]')?.textContent).toContain("This changes what the stream shows.")
    await act(async () => button("Cancel")!.click())
    expect(el.querySelector('[role="alertdialog"]')).toBeNull()
    expect(obs.requests.some((r) => r.type === "SetCurrentProgramScene")).toBe(false)
    await act(async () => (row("Pulpit").querySelector("button") as HTMLButtonElement).click())
    await act(async () => (el.querySelector('[role="alertdialog"] button') as HTMLButtonElement).click()) // "Switch OBS"
    await settle()
    expect(lastCommand(obs.requests)).toEqual({ type: "SetCurrentProgramScene", data: { sceneName: "Pulpit" } })
    expect(useObsStore.getState().program).toBe("Pulpit")
  })

  it("never switches OBS's program directly while Studio Mode is on, and never previews outside it", async () => {
    const studio = await setup({ studioMode: true })
    await studio.useObsStore.getState().switchProgram("Choir")
    expect(studio.obs.requests.some((r) => r.type === "SetCurrentProgramScene")).toBe(false)
    studio.useObsStore.getState().disconnect()
    const plain = await setup()
    await plain.useObsStore.getState().setPreview("Choir")
    await plain.useObsStore.getState().take()
    expect(plain.obs.requests.some((r) => r.type === "SetCurrentPreviewScene" || r.type === "TriggerStudioModeTransition")).toBe(false)
  })

  it("when OBS goes away, forgets its scenes and says so instead of showing a stale program", async () => {
    const { useObsStore, obs } = await setup()
    const { el, button } = await render()
    expect(el.textContent).toContain("Wide")
    await act(async () => obs.drop())
    const s = useObsStore.getState()
    expect(s.status).toBe("error")
    expect(s).toMatchObject({ scenes: [], program: null, preview: null, studioMode: null })
    expect(el.querySelector('[aria-label="OBS scene list"]')).toBeNull()
    expect(el.textContent).toContain("Not connected")
    expect(button("Try now")).toBeTruthy()
  })

  it("in rehearsal, nothing reaches OBS: the buttons stay focusable, say why, and the store refuses too", async () => {
    const reason = "Rehearsal is on: OBS is the live stream, so Rhema Studio doesn't change it while you practise"
    const studio = await setup({ studioMode: true })
    const { useBroadcastStore } = await import("@/stores/broadcast-store")
    useBroadcastStore.setState({ rehearsal: true })
    const sent = () => studio.obs.requests.filter((r) => r.type.startsWith("Set") || r.type === "TriggerStudioModeTransition")
    const { button, row } = await render()
    const take = button("Take in OBS")!
    const preview = row("Choir").querySelector("button") as HTMLButtonElement
    for (const b of [take, preview]) {
      expect(b.disabled).toBe(false) // focusable
      expect(b.getAttribute("aria-disabled")).toBe("true")
      expect(document.getElementById(b.getAttribute("aria-describedby")!)?.textContent).toContain(reason)
    }
    await act(async () => { take.click(); preview.click() })
    await settle()
    expect(sent()).toEqual([])
    // Defence in depth: the store itself refuses, whoever calls it.
    await studio.useObsStore.getState().setPreview("Choir")
    await studio.useObsStore.getState().take()
    expect(sent()).toEqual([])
    await act(async () => root!.unmount())
    root = null
    studio.useObsStore.getState().disconnect()

    const plain = await setup()
    const { useBroadcastStore: broadcast } = await import("@/stores/broadcast-store")
    broadcast.setState({ rehearsal: true })
    const view = await render()
    const sw = view.row("Pulpit").querySelector("button") as HTMLButtonElement
    expect(sw.getAttribute("aria-disabled")).toBe("true")
    await act(async () => sw.click())
    expect(view.el.querySelector('[role="alertdialog"]')).toBeNull()
    await plain.useObsStore.getState().switchProgram("Pulpit")
    expect(plain.obs.requests.some((r) => r.type === "SetCurrentProgramScene")).toBe(false)
    expect(plain.useObsStore.getState().program).toBe("Wide")
    expect(view.el.textContent).toContain(reason)
  })

  it("on a computer that joined a host, OBS's scenes are shown only", async () => {
    await setup()
    const { useJoin } = await import("@/stores/join-store")
    useJoin.setState({ status: "connected" })
    const { el, button } = await render()
    expect(el.textContent).toContain("changed from the main desk")
    expect(button("Switch OBS to this scene")).toBeUndefined()
  })
})
