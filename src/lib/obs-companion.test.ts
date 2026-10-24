import { describe, expect, it } from "vitest"
import { ObsClient } from "@/lib/obs"
import { addCameraToObs, cameraInputs, cameraOfInput, companionUrl, hostOf, mediaState, obsTally, readCompanionView, readMbps, updateInput, type CompanionSrt, type ObsRequest } from "@/lib/obs-companion"

const SRT: CompanionSrt = { port: 8890, passphrase: "0123456789abcdef0123456789abcdef", user: "read-a1b2c3d4", pass: "f".repeat(64), path: "companion/" }

type Item = { sceneItemId: number; sourceName: string; sceneItemEnabled: boolean; isGroup: boolean; sourceType: string }

/**
 * A fake OBS speaking obs-websocket v5 over a socket (Hello, Identify, Request, RequestResponse):
 * scenes with items, groups, inputs with settings, and media states. Requests it does not know
 * (and any request that removes something) fail, so the test sees them.
 */
class FakeObs {
  readyState = 1
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  requests: Array<{ type: string; data: Record<string, unknown> }> = []
  scenes = new Map<string, Item[]>([["Wide", []], ["Service", []]])
  groups = new Map<string, Item[]>()
  inputs = new Map<string, { kind: string; settings: Record<string, unknown> }>([["Mic", { kind: "coreaudio_input_capture", settings: {} }], ["Intro video", { kind: "ffmpeg_source", settings: { is_local_file: true, local_file: "/x.mp4" } }]])
  states = new Map<string, string>()
  private id = 1
  constructor() {
    queueMicrotask(() => this.push(0, { obsWebSocketVersion: "5.5.0", rpcVersion: 1 }))
  }
  private push(op: number, d: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify({ op, d }) })
  }
  item(sourceName: string, extra: Partial<Item> = {}): Item {
    return { sceneItemId: this.id++, sourceName, sceneItemEnabled: true, isGroup: false, sourceType: "OBS_SOURCE_TYPE_INPUT", ...extra }
  }
  send(raw: string) {
    const msg = JSON.parse(raw) as { op: number; d: Record<string, unknown> }
    if (msg.op === 1) return queueMicrotask(() => this.push(2, { negotiatedRpcVersion: 1 }))
    const type = String(msg.d.requestType)
    const data = (msg.d.requestData ?? {}) as Record<string, unknown>
    this.requests.push({ type, data })
    let r: Record<string, unknown> | undefined
    let ok = true
    const name = String(data.inputName ?? data.sceneName ?? "")
    switch (type) {
      case "GetSceneList":
        r = { scenes: [...this.scenes.keys()].map((sceneName, sceneIndex) => ({ sceneName, sceneIndex })) }
        break
      case "CreateScene":
        if (this.scenes.has(name)) ok = false
        else this.scenes.set(name, [])
        break
      case "GetInputList":
        r = { inputs: [...this.inputs].filter(([, i]) => !data.inputKind || i.kind === data.inputKind).map(([inputName, i]) => ({ inputName, inputKind: i.kind })) }
        break
      case "GetInputSettings":
        ok = this.inputs.has(name)
        r = ok ? { inputKind: this.inputs.get(name)!.kind, inputSettings: this.inputs.get(name)!.settings } : undefined
        break
      case "CreateInput": {
        const scene = this.scenes.get(String(data.sceneName))
        if (!scene || this.inputs.has(name)) ok = false
        else {
          this.inputs.set(name, { kind: String(data.inputKind), settings: data.inputSettings as Record<string, unknown> })
          const it = this.item(name)
          scene.push(it)
          r = { sceneItemId: it.sceneItemId }
        }
        break
      }
      case "CreateSceneItem": {
        const it = this.item(String(data.sourceName))
        this.scenes.get(name)!.push(it)
        r = { sceneItemId: it.sceneItemId }
        break
      }
      case "GetSceneItemList":
        r = { sceneItems: this.scenes.get(name) ?? [] }
        ok = this.scenes.has(name)
        break
      case "GetGroupSceneItemList":
        r = { sceneItems: this.groups.get(name) ?? [] }
        ok = this.groups.has(name)
        break
      case "SetInputSettings":
        this.inputs.get(name)!.settings = { ...this.inputs.get(name)!.settings, ...(data.inputSettings as Record<string, unknown>) }
        break
      case "GetVideoSettings":
        r = { baseWidth: 1920, baseHeight: 1080 }
        break
      case "SetSceneItemTransform":
      case "TriggerMediaInputAction":
        break
      case "GetMediaInputStatus":
        r = { mediaState: this.states.get(name) ?? "OBS_MEDIA_STATE_OPENING" }
        break
      default:
        ok = false
    }
    queueMicrotask(() => this.push(7, { requestType: type, requestId: msg.d.requestId, requestStatus: { result: ok, code: ok ? 100 : 600 }, responseData: r }))
  }
  close() {}
}

async function connect(): Promise<{ obs: FakeObs; request: ObsRequest }> {
  let obs!: FakeObs
  const client = new ObsClient({ url: "ws://127.0.0.1:4455", password: "", socket: () => (obs = new FakeObs()) as unknown as WebSocket })
  await client.connect()
  return { obs, request: (t, d) => client.request(t, d) }
}

describe("OBS companion: addresses (#209)", () => {
  it("reads a camera over SRT as this companion, encrypted, with the delay buffer in microseconds", () => {
    const url = companionUrl(hostOf("192.168.1.20:8080"), SRT, "pulpit", 200)
    expect(url).toBe(`srt://192.168.1.20:8890?streamid=read:companion/pulpit:read-a1b2c3d4:${"f".repeat(64)}&passphrase=0123456789abcdef0123456789abcdef&latency=200000&mode=caller`)
    expect(cameraOfInput(url)).toBe("pulpit")
    expect(cameraOfInput("rtsp://192.168.1.20:8554/pulpit")).toBeNull()
    expect(cameraOfInput("srt://x:8890?streamid=read:pulpit:u:p")).toBeNull()
    expect(cameraOfInput(undefined)).toBeNull()
    expect(hostOf("[fe80::1]:8080")).toBe("[fe80::1]")
  })

  it("takes the host's answer field by field", () => {
    const v = readCompanionView({ router: true, srt: SRT, cameras: [{ name: "pulpit", live: true, tracks: ["H264"], width: 1280, height: 720, kbps: 2500, readers: 2, watchers: [{ kind: "companion", name: "Media desk (OBS companion)", remote: true }], obs: [] }, { name: "../bad" }, "junk"] })
    expect(v.router).toBe(true)
    expect(v.srt?.user).toBe("read-a1b2c3d4")
    expect(v.cameras.map((c) => c.name)).toEqual(["pulpit"])
    expect(readCompanionView(null)).toEqual({ router: false, srt: null, cameras: [] })
    expect(readCompanionView({ srt: { port: "x" } }).srt).toBeNull()
  })

  it("adds the network load: each camera's rate times its readers over the network", () => {
    expect(readMbps([{ kbps: 4000, watchers: [{ remote: true }, { remote: true }, { remote: false }] }, { kbps: 2000, watchers: [{ remote: true }] }, { kbps: null, watchers: [{ remote: true }] }])).toBe(10)
  })
})

describe("OBS companion: the request sequence against OBS (#209)", () => {
  it("adds a camera as a network Media Source in a new scene named after it, fitted to the canvas", async () => {
    const { obs, request } = await connect()
    const url = companionUrl("192.168.1.20", SRT, "pulpit", 200)
    const r = await addCameraToObs(request, { name: "pulpit", label: "Pulpit", url }, null)
    expect(r).toEqual({ inputName: "Pulpit (Rhema camera)", sceneName: "Pulpit", done: "added" })
    const made = obs.requests.find((q) => q.type === "CreateInput")!
    expect(made.data).toMatchObject({ sceneName: "Pulpit", inputKind: "ffmpeg_source", sceneItemEnabled: true })
    expect(made.data.inputSettings).toEqual({ is_local_file: false, input: url, input_format: "", restart_on_activate: true, close_when_inactive: false, buffering_mb: 1, hw_decode: true, reconnect_delay_sec: 2 })
    expect(obs.requests.map((q) => q.type)).toEqual(["GetSceneList", "CreateScene", "GetInputList", "GetInputSettings", "GetInputList", "CreateInput", "GetVideoSettings", "SetSceneItemTransform"])
    expect(obs.requests.find((q) => q.type === "SetSceneItemTransform")!.data.sceneItemTransform).toMatchObject({ boundsType: "OBS_BOUNDS_SCALE_INNER", boundsWidth: 1920, boundsHeight: 1080 })
  })

  it("puts a camera already in OBS into another scene with the same input, and gives it a new address", async () => {
    const { obs, request } = await connect()
    const old = companionUrl("192.168.1.20", SRT, "pulpit", 200)
    await addCameraToObs(request, { name: "pulpit", label: "Pulpit", url: old }, null)
    obs.requests = []
    const renewed = companionUrl("192.168.1.20", { ...SRT, pass: "e".repeat(64) }, "pulpit", 200)
    const r = await addCameraToObs(request, { name: "pulpit", label: "Pulpit", url: renewed }, "Service")
    expect(r).toEqual({ inputName: "Pulpit (Rhema camera)", sceneName: "Service", done: "placed" })
    const types = obs.requests.map((q) => q.type)
    expect(types).not.toContain("CreateInput")
    expect(types).toContain("CreateSceneItem")
    expect(obs.inputs.get("Pulpit (Rhema camera)")!.settings.input).toBe(renewed)
    expect(obs.requests.find((q) => q.type === "TriggerMediaInputAction")!.data).toEqual({ inputName: "Pulpit (Rhema camera)", mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART" })
    // Asked again for the same scene: nothing new is made.
    obs.requests = []
    expect((await addCameraToObs(request, { name: "pulpit", label: "Pulpit", url: renewed }, "Service")).done).toBe("updated")
    expect(obs.requests.map((q) => q.type)).not.toContain("CreateSceneItem")
  })

  it("never takes a name OBS already uses, and finds its cameras by their address", async () => {
    const { obs, request } = await connect()
    obs.inputs.set("Pulpit (Rhema camera)", { kind: "image_source", settings: {} })
    const r = await addCameraToObs(request, { name: "pulpit", label: "Pulpit", url: companionUrl("h", SRT, "pulpit", 200) }, "Wide")
    expect(r.inputName).toBe("Pulpit (Rhema camera) 2")
    await addCameraToObs(request, { name: "choir", label: "Choir", url: companionUrl("h", SRT, "choir", 200) }, "Wide")
    const found = await cameraInputs(request)
    expect([...found.keys()].sort()).toEqual(["choir", "pulpit"])
    expect(found.get("pulpit")![0].input).toBe("Pulpit (Rhema camera) 2")
  })

  it("updates an address and reads OBS's media state", async () => {
    const { obs, request } = await connect()
    await addCameraToObs(request, { name: "pulpit", label: "Pulpit", url: companionUrl("h", SRT, "pulpit", 200) }, null)
    await updateInput(request, "Pulpit (Rhema camera)", companionUrl("h", SRT, "pulpit", 400))
    expect(String(obs.inputs.get("Pulpit (Rhema camera)")!.settings.input)).toContain("latency=400000")
    expect(await mediaState(request, "Pulpit (Rhema camera)")).toBe("opening")
    obs.states.set("Pulpit (Rhema camera)", "OBS_MEDIA_STATE_PLAYING")
    expect(await mediaState(request, "Pulpit (Rhema camera)")).toBe("playing")
  })

  it("tallies the cameras OBS shows on program and preview, through nested scenes and groups, never hidden ones", async () => {
    const { obs, request } = await connect()
    for (const [name, label] of [["pulpit", "Pulpit"], ["choir", "Choir"], ["wide", "Wide cam"]]) await addCameraToObs(request, { name, label, url: companionUrl("h", SRT, name, 200) }, null)
    // Program "Service": the Pulpit scene nested, a group holding Choir, and Wide hidden.
    obs.groups.set("Band", [obs.item("Choir (Rhema camera)")])
    obs.scenes.set("Service", [obs.item("Pulpit", { sourceType: "OBS_SOURCE_TYPE_SCENE" }), obs.item("Band", { isGroup: true, sourceType: "OBS_SOURCE_TYPE_SCENE" }), obs.item("Wide cam (Rhema camera)", { sceneItemEnabled: false }), obs.item("Mic")])
    const inputs = await cameraInputs(request)
    expect(await obsTally(request, "Service", "Wide cam", inputs)).toEqual({ program: ["choir", "pulpit"], preview: ["wide"] })
    expect(await obsTally(request, "Wide", null, inputs)).toEqual({ program: [], preview: [] })
    // Nothing the operator made is ever removed.
    expect(obs.requests.some((q) => /^Remove/.test(q.type))).toBe(false)
  })
})
