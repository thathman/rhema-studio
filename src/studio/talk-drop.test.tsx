// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const invoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }))
const handlers = new Map<string, (e: { payload: string }) => void>()
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn(async () => {}),
  listen: vi.fn(async (name: string, f: (e: { payload: string }) => void) => {
    handlers.set(name, f)
    return () => {}
  }),
}))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { JoinedTalk, TalkDevices } from "./talk"
import { TalkClient, canChooseTalkOutput, openTalkMic, routeLevel, setHostChannels, startVoiceHub, useVoice, type TalkStatus } from "@/lib/voice"
import { useSettingsStore } from "@/stores/settings-store"

/** A stand-in for the browser's WebRTC connection: the test moves its state. */
class FakePC {
  static all: FakePC[] = []
  connectionState = "new"
  iceConnectionState = "new"
  iceGatheringState = "complete"
  localDescription: { type: string; sdp: string } | null = null
  onconnectionstatechange: (() => void) | null = null
  oniceconnectionstatechange: (() => void) | null = null
  ontrack: ((e: { streams: unknown[]; track: unknown }) => void) | null = null
  closed = false
  senders: { track: unknown; replaceTrack: (t: unknown) => Promise<void> }[] = []
  transceiver = { receiver: { track: { kind: "audio" } }, sender: { replaceTrack: vi.fn(async () => {}) }, direction: "" }
  constructor() {
    FakePC.all.push(this)
  }
  addTransceiver(track: unknown) {
    const s = { track, replaceTrack: async (t: unknown) => { s.track = t } }
    this.senders.push(s)
  }
  getSenders() { return this.senders }
  getTransceivers() { return [this.transceiver] }
  async createOffer() { return { type: "offer", sdp: "offer" } }
  async createAnswer() { return { type: "answer", sdp: "answer" } }
  async setLocalDescription(d: { type: string; sdp: string }) { this.localDescription = d }
  async setRemoteDescription() {}
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.closed = true
    this.connectionState = "closed"
  }
  /** Move to a connection state, as the browser would, and tell the watcher. */
  set(state: string) {
    this.connectionState = state
    this.onconnectionstatechange?.()
  }
}

/** A stand-in audio graph: every node connects and chains. */
const node = () => ({ connect: vi.fn((n: unknown) => n), disconnect: vi.fn(), gain: { value: 1 }, fftSize: 0, getFloatTimeDomainData: vi.fn(), stream: { getAudioTracks: () => [{}] } })
class FakeContext {
  static last: FakeContext | null = null
  state = "running"
  destination = node()
  setSinkId = vi.fn(async () => {})
  constructor() {
    FakeContext.last = this
  }
  createGain = node
  createAnalyser = node
  createMediaStreamDestination = node
  createMediaStreamSource = node
  resume = async () => {}
}

const track = () => ({ enabled: true, kind: "audio", stop: vi.fn() })
const stream = (t: ReturnType<typeof track>) => ({ getAudioTracks: () => [t], getTracks: () => [t] }) as unknown as MediaStream
const getUserMedia = vi.fn()
const enumerateDevices = vi.fn(async () => [] as Partial<MediaDeviceInfo>[])
const joinVoiceCalls = () => invoke.mock.calls.filter((c) => c[0] === "join_voice").length
const media = HTMLMediaElement.prototype as unknown as Record<string, unknown>

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  FakePC.all = []
  invoke.mockReset()
  invoke.mockImplementation(async (cmd: string) => (cmd === "join_voice" ? "answer" : cmd === "voice_answer" ? true : null))
  getUserMedia.mockReset()
  getUserMedia.mockImplementation(async () => stream(track()))
  vi.stubGlobal("RTCPeerConnection", FakePC)
  vi.stubGlobal("AudioContext", FakeContext)
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia, enumerateDevices, addEventListener: vi.fn(), removeEventListener: vi.fn() }, configurable: true })
  media.play = vi.fn(async () => {})
  media.pause = vi.fn()
  useSettingsStore.setState({ talkInputId: "", talkOutputId: "" })
  useVoice.setState({ micNote: null })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete media.setSinkId
})

/** A joined desk whose host vanishes (Rhema Comms #251). */
describe("a dropped talk connection", () => {
  async function joined() {
    const c = new TalkClient("host:8080", "key")
    const seen: TalkStatus[] = []
    c.onStatus = (s) => seen.push(s)
    const mic = track()
    await c.join(stream(mic), "")
    FakePC.all[0].set("connected")
    return { c, seen, mic, pc: FakePC.all[0] }
  }

  it("stops the microphone, says so, joins again, and leaves the microphone off until Talk is pressed", async () => {
    const { c, seen, mic, pc } = await joined()
    expect(mic.enabled).toBe(false)
    c.talk(true)
    expect(mic.enabled).toBe(true)

    pc.set("failed")
    expect(mic.enabled).toBe(false)
    expect(seen).toEqual(["dropped"])
    expect(invoke).toHaveBeenCalledWith("join_command", expect.objectContaining({ command: { command: "voice_talk", value: false } }))
    // Talk does nothing while the connection is down.
    c.talk(true)
    expect(mic.enabled).toBe(false)

    await vi.advanceTimersByTimeAsync(10)
    expect(pc.closed).toBe(true)
    expect(FakePC.all).toHaveLength(2)
    expect(joinVoiceCalls()).toBe(2)
    expect(getUserMedia).not.toHaveBeenCalled() // the same microphone, never opened again by itself

    FakePC.all[1].set("connected")
    expect(seen).toEqual(["dropped", "back"])
    expect(mic.enabled).toBe(false)
    c.talk(true)
    expect(mic.enabled).toBe(true)
    c.leave()
  })

  it("watches the network connection too (ICE), not only the overall state", async () => {
    const { c, seen, mic, pc } = await joined()
    c.talk(true)
    pc.iceConnectionState = "failed"
    pc.connectionState = "connecting"
    pc.oniceconnectionstatechange?.()
    expect(mic.enabled).toBe(false)
    expect(seen).toEqual(["dropped"])
    c.leave()
  })

  it("a blip that comes back by itself is back without joining again", async () => {
    const { c, seen, pc } = await joined()
    pc.set("disconnected")
    expect(seen).toEqual(["dropped"])
    await vi.advanceTimersByTimeAsync(1000)
    pc.set("connected")
    expect(seen).toEqual(["dropped", "back"])
    await vi.advanceTimersByTimeAsync(5000)
    expect(FakePC.all).toHaveLength(1)
    expect(joinVoiceCalls()).toBe(1)
    c.leave()
  })

  it("gives up after a bounded number of tries and says the channel is lost", async () => {
    const { seen, mic, pc } = await joined()
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "join_voice") throw new Error("Could not reach the host")
      return null
    })
    pc.set("failed")
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(seen).toEqual(["dropped", "lost"])
    expect(joinVoiceCalls()).toBe(9) // the first join and eight tries
    expect(mic.stop).toHaveBeenCalled()
    const pcs = FakePC.all.length
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(FakePC.all).toHaveLength(pcs)
  })

  it("leaving stops trying to join again", async () => {
    const { c, pc } = await joined()
    pc.set("failed")
    c.leave()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakePC.all).toHaveLength(1)
  })
})

describe("the main desk's view of a dropped desk", () => {
  async function offer(by: string) {
    handlers.get("remote:voice_offer")!({ payload: JSON.stringify({ id: "1", by, sdp: "offer" }) })
    await vi.advanceTimersByTimeAsync(10)
    return FakePC.all.at(-1)!
  }

  it("a desk that goes quiet shows Talk let go at once and leaves the crew list after a short grace; a failed one at once", async () => {
    useSettingsStore.setState({ talkOutputId: "desk-headset" })
    const stop = startVoiceHub()
    const pc = await offer("Ade")
    // The crew is heard on this computer's chosen output where it can be.
    expect(FakeContext.last!.setSinkId).toHaveBeenCalledWith("desk-headset")
    handlers.get("remote:voice_talk")!({ payload: JSON.stringify({ by: "Ade", on: true }) })
    expect(useVoice.getState().peers).toMatchObject([{ name: "Ade", talking: true }])

    pc.set("disconnected")
    expect(useVoice.getState().peers).toMatchObject([{ name: "Ade", talking: false }])
    await vi.advanceTimersByTimeAsync(3100)
    expect(useVoice.getState().peers).toEqual([])
    expect(pc.closed).toBe(true)

    const pc2 = await offer("Femi")
    expect(useVoice.getState().peers.map((p) => p.name)).toEqual(["Femi"])
    pc2.iceConnectionState = "failed"
    pc2.oniceconnectionstatechange?.()
    expect(useVoice.getState().peers).toEqual([])

    // Another output chosen while the hub runs: used at once.
    useSettingsStore.setState({ talkOutputId: "" })
    expect(FakeContext.last!.setSinkId).toHaveBeenLastCalledWith("")
    stop()
  })

  it("a private call reaches the desk it was chosen for by key, never a desk named like it (#251)", async () => {
    const stop = startVoiceHub()
    // Each desk as the host's server stamps it: its name, and its key id.
    const join = async (by: string, byId: string) => {
      handlers.get("remote:voice_offer")!({ payload: JSON.stringify({ id: byId, by, byId, sdp: "offer" }) })
      await vi.advanceTimersByTimeAsync(10)
      const pc = FakePC.all.at(-1)!
      pc.ontrack?.({ streams: [{}], track: {} })
      return pc
    }
    await join("Ade", "k-ade")
    await join("\u0410de", "k-look") // a look-alike name (a Cyrillic "А")
    await join("Femi", "k-femi")
    expect(useVoice.getState().peers.map((p) => [p.id, p.name])).toEqual([["k-ade", "Ade"], ["k-look", "\u0410de"], ["k-femi", "Femi"]])
    handlers.get("remote:voice_channels")!({ payload: JSON.stringify({ by: "Femi", byId: "k-femi", listen: [], talk: "to:Ade" }) })
    expect([routeLevel("k-femi", "k-ade"), routeLevel("k-femi", "k-look"), routeLevel("k-femi", "host")]).toEqual([1, 0, 0])
    // Talk events are matched by key too: a desk sending under another's name moves nobody else.
    handlers.get("remote:voice_talk")!({ payload: JSON.stringify({ by: "Ade", byId: "k-look", on: true }) })
    expect(useVoice.getState().peers.map((p) => p.talking)).toEqual([false, true, false])

    // Ade leaves; a new key paired under the very same name joins: the call was for Ade's key.
    handlers.get("remote:voice_leave")!({ payload: JSON.stringify({ by: "Ade", byId: "k-ade" }) })
    await join("Ade", "k-new")
    expect(routeLevel("k-femi", "k-new")).toBe(0)
    // Ade back on the same key: heard again.
    await join("Ade", "k-ade")
    expect(routeLevel("k-femi", "k-ade")).toBe(1)

    // The main desk picks a desk from its crew list by key; the name is for reading.
    setHostChannels([], "to:\u0410de", "k-look")
    expect(useVoice.getState()).toMatchObject({ hostTalkTo: "to:\u0410de", hostTalkToId: "k-look" })
    // Revoking a key drops that desk from the channel, whatever its name.
    useSettingsStore.setState({ remoteDevices: [{ hash: "k-look", name: "\u0410de", role: "present", paired_at: "" }] as never })
    useSettingsStore.setState({ remoteDevices: [] })
    expect(useVoice.getState().peers.map((p) => p.id)).toEqual(["k-femi", "k-new", "k-ade"])
    stop()
  })

  it("a blip shorter than the grace keeps the desk", async () => {
    const stop = startVoiceHub()
    const pc = await offer("Tolu")
    pc.set("disconnected")
    await vi.advanceTimersByTimeAsync(1000)
    pc.set("connected")
    await vi.advanceTimersByTimeAsync(5000)
    expect(useVoice.getState().peers.map((p) => p.name)).toEqual(["Tolu"])
    stop()
  })
})

describe("the talk headset", () => {
  it("uses the chosen microphone, and the system's (saying so) when it is unplugged", async () => {
    useSettingsStore.setState({ talkInputId: "usb-headset" })
    const c = new TalkClient("host:8080", "key")
    await c.join()
    expect(getUserMedia).toHaveBeenCalledWith({ audio: expect.objectContaining({ deviceId: { exact: "usb-headset" }, echoCancellation: true }) })
    c.leave()

    getUserMedia.mockReset()
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error("no such device"), { name: "OverconstrainedError" })).mockImplementation(async () => stream(track()))
    await openTalkMic()
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(getUserMedia.mock.calls[1][0]).toEqual({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    expect(useVoice.getState().micNote).toMatch(/not connected/)

    // A refused microphone is still an error, not a quiet fallback.
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "NotAllowedError" }))
    await expect(openTalkMic()).rejects.toThrow("denied")
  })

  it("sends the crew to the chosen output where the computer can, and changes it live", async () => {
    const setSinkId = vi.fn(async () => {})
    media.setSinkId = setSinkId
    expect(canChooseTalkOutput()).toBe(true)
    const c = new TalkClient("host:8080", "key")
    await c.join(stream(track()), "ears")
    FakePC.all[0].ontrack?.({ streams: [{ id: "mix" }], track: {} })
    expect(setSinkId).toHaveBeenCalledWith("ears")
    await c.useDevices("", "speakers")
    expect(setSinkId).toHaveBeenLastCalledWith("speakers")
    c.leave()
  })

  it("without output choice (WebKit) the crew plays on the system output and nothing fails", async () => {
    vi.stubGlobal("AudioContext", undefined)
    expect(canChooseTalkOutput()).toBe(false)
    const c = new TalkClient("host:8080", "key")
    await c.join(stream(track()), "ears")
    expect(() => FakePC.all[0].ontrack?.({ streams: [{ id: "mix" }], track: {} })).not.toThrow()
    await expect(c.useDevices("", "speakers")).resolves.toBe(false)
    expect(media.play).toHaveBeenCalled()
    c.leave()

    const el = document.createElement("div")
    document.body.append(el)
    await act(async () => createRoot(el).render(<TalkDevices />))
    expect(el.textContent).toMatch(/system output/)
    expect(el.querySelector('select[aria-label="Hear the crew on"]')).toBeNull()
  })

  it("a new microphone mid-call replaces the one sent, with Talk let go", async () => {
    const c = new TalkClient("host:8080", "key")
    const first = track()
    await c.join(stream(first), "")
    c.talk(true)
    const next = track()
    getUserMedia.mockImplementationOnce(async () => stream(next))
    await expect(c.useDevices("usb-headset", "")).resolves.toBe(true)
    expect(first.stop).toHaveBeenCalled()
    expect(FakePC.all[0].senders[0].track).toBe(next)
    expect(next.enabled).toBe(false)
    c.leave()
  })

  it("the choice is kept in this computer's settings", async () => {
    enumerateDevices.mockResolvedValueOnce([
      { kind: "audioinput", deviceId: "default", label: "Default" },
      { kind: "audioinput", deviceId: "usb-headset", label: "USB headset" },
      { kind: "audiooutput", deviceId: "usb-ears", label: "USB headset" },
    ])
    const el = document.createElement("div")
    document.body.append(el)
    await act(async () => createRoot(el).render(<TalkDevices />))
    const mic = el.querySelector<HTMLSelectElement>('select[aria-label="Talk microphone"]')!
    expect([...mic.options].map((o) => o.textContent)).toEqual(["System microphone", "USB headset"])
    await act(async () => {
      mic.value = "usb-headset"
      mic.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(useSettingsStore.getState().talkInputId).toBe("usb-headset")
  })
})

describe("the joined desk's Talk panel", () => {
  it("shows the drop, holds Talk off while reconnecting, and says when it is back", async () => {
    useSettingsStore.setState({ joinAddress: "host:8080", joinToken: "key" })
    const el = document.createElement("div")
    document.body.append(el)
    await act(async () => createRoot(el).render(<JoinedTalk people={[]} />))
    const join = [...el.querySelectorAll("button")].find((b) => b.textContent === "Join the talk channel")!
    await act(async () => { join.click(); await vi.advanceTimersByTimeAsync(10) })
    const pc = FakePC.all[0]
    await act(async () => pc.set("connected"))
    const talk = () => el.querySelector<HTMLButtonElement>("button[aria-pressed]")!
    await act(async () => { talk().dispatchEvent(new Event("pointerdown", { bubbles: true })) })
    expect(talk().getAttribute("aria-pressed")).toBe("true")

    await act(async () => pc.set("failed"))
    expect(el.textContent).toContain("Talk dropped — reconnecting…")
    expect(talk().disabled).toBe(true)
    expect(talk().getAttribute("aria-pressed")).toBe("false")

    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    await act(async () => FakePC.all[1].set("connected"))
    expect(el.textContent).toContain("Back in the talk channel")
    expect(talk().disabled).toBe(false)
    expect(talk().getAttribute("aria-pressed")).toBe("false")
    await act(async () => { await vi.advanceTimersByTimeAsync(4500) })
    expect(el.textContent).not.toContain("Back in the talk channel")
  })
})
