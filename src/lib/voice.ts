import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { create } from "zustand"
import { useSettingsStore } from "@/stores/settings-store"

/**
 * Rhema Comms voice (C3, ADR 0002): one LAN talk channel, full duplex. The host is the hub: each
 * joined desk has one WebRTC connection to it, and the host sums everyone else's voice (and the main
 * desk's microphone) into what each desk hears, never its own. Anyone may talk at any time; nothing
 * is muted because someone else is talking. Talk is the microphone track switched on; who is
 * actually audible is measured here. The intercom has its own microphone stream and audio graph:
 * nothing reaches the outputs, NDI, the sound player, listening or any recording.
 */
/** Talk channels besides All crew (Comms C4). Everyone is always in All crew. */
export const CHANNELS = [{ id: "production", name: "Production" }, { id: "stage", name: "Stage & worship" }] as const
export const CHANNEL_IDS: readonly string[] = CHANNELS.map((c) => c.id)
/** The main desk, as a talk target ("to:host"). */
export const HOST = "host"
/** The main desk talking to everyone over the others: their voices drop while it holds Talk. */
export const PRIORITY = "priority"
/** How loud the others are while the main desk talks with priority. */
const DUCKED = 0.2

/** Where a voice goes: "all", a channel id, or "to:<name>" (one person; "to:host" for the main desk). */
export function talkName(talk: string, hostName = "Main desk"): string {
  if (talk === "all") return "All crew"
  if (talk === PRIORITY) return "All crew (priority)"
  if (talk.startsWith("to:")) return talk === `to:${HOST}` ? hostName : talk.slice(3)
  return CHANNELS.find((c) => c.id === talk)?.name ?? talk
}

/** Whether `from` (talking to `talk`) is heard by a listener named `to` who listens to `listen`. */
export function hears(talk: string, to: string, listen: readonly string[]): boolean {
  if (talk === "all" || talk === PRIORITY) return true
  if (talk.startsWith("to:")) return talk.slice(3) === to
  return listen.includes(talk)
}

export interface VoicePerson {
  name: string
  /** Whom they talk to ("all", a channel, "to:<name>"). */
  talk?: string
  /** Talk held. */
  talking: boolean
  /** Actually audible now. */
  speaking: boolean
}

interface VoiceState {
  /** The desks in the talk channel (host side). */
  peers: VoicePerson[]
  hostTalking: boolean
  hostSpeaking: boolean
  micError: string | null
  /** How loud the main desk hears the crew, 0–1. */
  volume: number
  /** The main desk's channels (besides All crew) and whom it talks to. */
  hostListen: string[]
  hostTalkTo: string
}

export const useVoice = create<VoiceState>(() => ({ peers: [], hostTalking: false, hostSpeaking: false, micError: null, volume: 1, hostListen: [...CHANNEL_IDS], hostTalkTo: "all" }))

/** How loud the main desk hears the crew (its own output only). */
export function setVoiceVolume(v: number): void {
  const volume = Math.min(1, Math.max(0, v))
  if (monitor) monitor.gain.value = volume
  useVoice.setState({ volume })
}

const MIC: MediaStreamConstraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
/** RMS above this is someone speaking (a quiet room reads well under it with noise suppression on). */
const SPEAKING = 0.02

/** Wait until the connection has gathered its LAN candidates (no trickle ICE), at most 3 s. */
function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => { if (pc.iceGatheringState === "complete") { pc.removeEventListener("icegatheringstatechange", done); resolve() } }
    pc.addEventListener("icegatheringstatechange", done)
    setTimeout(resolve, 3000)
  })
}

function rms(a: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  a.getFloatTimeDomainData(buf)
  let sum = 0
  for (const v of buf) sum += v * v
  return Math.sqrt(sum / buf.length)
}

// ---------------------------------------------------------------- host: the hub that mixes

interface Peer {
  pc: RTCPeerConnection
  /** What this desk hears: everyone but itself. */
  mix: MediaStreamAudioDestinationNode
  /** This desk's voice, once its track arrives. */
  voice: AudioNode | null
  analyser: AnalyserNode | null
  talking: boolean
  listen: string[]
  talkTo: string
}

let ctx: AudioContext | null = null
let monitor: GainNode | null = null
const peers = new Map<string, Peer>()
let hostMic: { stream: MediaStream; gate: GainNode; analyser: AnalyserNode } | null = null
/** One gain per speaker → listener (from → to → route); 1 when the speaker's talk reaches that listener. */
const routes = new Map<string, Map<string, { gain: GainNode; source: AudioNode }>>()

/**
 * Wire every speaker to every listener through its own gain and set each by the talk rules: All
 * crew reaches everyone, a channel its listeners, "to:<name>" only that person. Nobody hears
 * themselves. Called whenever someone joins, leaves or changes channels.
 */
function rewire() {
  if (!ctx) return
  const v = useVoice.getState()
  const ends = new Map<string, { source: AudioNode | null; sink: AudioNode; listen: readonly string[]; talk: string }>()
  if (monitor) ends.set(HOST, { source: hostMic?.gate ?? null, sink: monitor, listen: v.hostListen, talk: v.hostTalkTo })
  for (const [name, p] of peers) ends.set(name, { source: p.analyser, sink: p.mix, listen: p.listen, talk: p.talkTo })
  // Routes whose speaker or listener left, or whose speaker's node changed, go.
  for (const [from, row] of routes) {
    for (const [to, r] of row) {
      if (ends.get(from)?.source !== r.source || !ends.has(to)) {
        r.gain.disconnect()
        row.delete(to)
      }
    }
    if (row.size === 0) routes.delete(from)
  }
  for (const [from, a] of ends) {
    if (!a.source) continue
    let row = routes.get(from)
    if (!row) routes.set(from, (row = new Map()))
    for (const [to, b] of ends) {
      if (from === to) continue
      let r = row.get(to)
      if (!r) {
        const gain = ctx.createGain()
        a.source.connect(gain)
        gain.connect(b.sink)
        row.set(to, (r = { gain, source: a.source }))
      }
      // While the main desk talks with priority, everyone else is quieter for every listener.
      const ducked = v.hostTalking && v.hostTalkTo === PRIORITY && from !== HOST
      r.gain.gain.value = hears(a.talk, to, b.listen) ? (ducked ? DUCKED : 1) : 0
    }
  }
}

/** The main desk's channels and talk target. */
export function setHostChannels(listen: string[], talkTo: string): void {
  useVoice.setState({ hostListen: listen.filter((c) => CHANNEL_IDS.includes(c)), hostTalkTo: validTalk(talkTo) })
  rewire()
}

function validTalk(t: string): string {
  return t === "all" || t === PRIORITY || CHANNEL_IDS.includes(t) || (t.startsWith("to:") && t.length > 3) ? t.slice(0, 84) : "all"
}

/**
 * The intercom's audio graph, running. A new context starts suspended, and WebKit leaves a stream
 * source made while suspended silent for good (found on the desktop: the first desk was never heard).
 */
async function audio(): Promise<AudioContext> {
  if (!ctx) {
    ctx = new AudioContext()
    monitor = ctx.createGain()
    monitor.gain.value = useVoice.getState().volume
    monitor.connect(ctx.destination)
  }
  if (ctx.state !== "running") await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 1500))])
  return ctx
}

function publishPeers() {
  useVoice.setState({ peers: [...peers.entries()].map(([name, p]) => ({ name, talk: p.talkTo, talking: p.talking, speaking: !!useVoice.getState().peers.find((x) => x.name === name)?.speaking })) })
}

function drop(name: string) {
  const p = peers.get(name)
  if (!p) return
  peers.delete(name)
  p.voice?.disconnect()
  p.analyser?.disconnect()
  p.pc.close()
  rewire()
  publishPeers()
}

/** A desk's offer: answer it with what that desk should hear. */
async function answer(id: string, by: string, sdp: string) {
  const a = await audio()
  drop(by) // a desk that reconnects replaces its old connection
  const pc = new RTCPeerConnection({ iceServers: [] })
  const mix = a.createMediaStreamDestination()
  const peer: Peer = { pc, mix, voice: null, analyser: null, talking: false, listen: [...CHANNEL_IDS], talkTo: "all" }
  peers.set(by, peer)
  rewire()
  pc.ontrack = (e) => {
    const stream = e.streams[0] ?? new MediaStream([e.track])
    // WebAudio is the remote track's only consumer: a second one (a muted <audio> element) made the
    // jitter buffer grow from the first seconds (measured on the desktop, ADR 0002 §4).
    const voice = a.createMediaStreamSource(stream)
    const analyser = a.createAnalyser()
    analyser.fftSize = 1024
    // The meter feeds the routes; it also reaches the output (silently) because WebKit only keeps
    // processing nodes that do, and a meter off to the side reads stale levels (found on the desktop).
    voice.connect(analyser)
    const silent = a.createGain()
    silent.gain.value = 0
    analyser.connect(silent).connect(a.destination)
    peer.voice = voice
    peer.analyser = analyser
    rewire()
  }
  // A desk that left or lost the network: gone at once on failure, after 5 s of silence otherwise.
  pc.onconnectionstatechange = () => {
    const state = pc.connectionState
    if ((state === "failed" || state === "closed") && peers.get(by)?.pc === pc) drop(by)
    else if (state === "disconnected") setTimeout(() => { if (pc.connectionState === "disconnected" && peers.get(by)?.pc === pc) drop(by) }, 5000)
  }
  await pc.setRemoteDescription({ type: "offer", sdp })
  const tr = pc.getTransceivers().find((t) => t.receiver.track.kind === "audio")
  if (!tr) throw new Error("no audio in the offer")
  await tr.sender.replaceTrack(mix.stream.getAudioTracks()[0])
  tr.direction = "sendrecv"
  await pc.setLocalDescription(await pc.createAnswer())
  await gathered(pc)
  publishPeers()
  // Too late (the desk's request timed out): it will offer again; drop this one.
  const taken = await invoke<boolean>("voice_answer", { id, sdp: pc.localDescription!.sdp }).catch(() => false)
  if (!taken && peers.get(by)?.pc === pc) drop(by)
}

/** Whether the main desk wants to talk now (the last press or release). */
let wantTalk = false
/** The microphone being opened: one at a time, however many presses. */
let opening: Promise<void> | null = null

/**
 * The main desk's Talk. `stream` replaces the microphone (tests). A release while the microphone
 * is still opening (its permission prompt takes focus) wins: the gate follows the latest wish.
 */
export async function hostTalk(on: boolean, stream?: MediaStream): Promise<void> {
  wantTalk = on
  if (on && !hostMic) {
    opening ??= openHostMic(stream).finally(() => { opening = null })
    await opening
  }
  if (hostMic) hostMic.gate.gain.value = wantTalk ? 1 : 0
  useVoice.setState({ hostTalking: wantTalk && !!hostMic })
  // Priority ducks the others only while the main desk holds Talk.
  rewire()
}

async function openHostMic(stream?: MediaStream): Promise<void> {
  try {
    const a = await audio()
    const s = stream ?? (await navigator.mediaDevices.getUserMedia(MIC))
    const gate = a.createGain()
    gate.gain.value = 0
    const analyser = a.createAnalyser()
    analyser.fftSize = 1024
    a.createMediaStreamSource(s).connect(gate)
    gate.connect(analyser)
    // Keep the meter processed without hearing yourself.
    const silent = a.createGain()
    silent.gain.value = 0
    analyser.connect(silent).connect(a.destination)
    hostMic = { stream: s, gate, analyser }
    rewire()
    useVoice.setState({ micError: null })
  } catch (e) {
    useVoice.setState({ micError: `The microphone is not available: ${e instanceof Error ? e.message : String(e)}` })
  }
}

let hosting = false
/** Start answering desks (the main window, once). */
export function startVoiceHub(): () => void {
  if (hosting) return () => {}
  hosting = true
  // A device whose key is revoked leaves the talk channel at once (its next request would be
  // refused anyway, but an open call would carry on).
  const offSettings = useSettingsStore.subscribe((s, p) => {
    if (s.remoteDevices === p.remoteDevices) return
    const paired = new Set(s.remoteDevices.map((d) => d.name))
    for (const name of [...peers.keys()]) if (!paired.has(name) && name !== "Shared key" && name !== "This computer") drop(name)
  })
  const offs = [
    listen<string>("remote:voice_offer", (e) => {
      try {
        const p = JSON.parse(e.payload) as { id: string; by: string; sdp: string }
        void answer(p.id, p.by, p.sdp).catch((err) => console.warn("[voice] could not answer", p.by, err))
      } catch {
        // not an offer
      }
    }),
    listen<string>("remote:voice_leave", (e) => {
      try {
        drop((JSON.parse(e.payload) as { by: string }).by)
      } catch {
        // ignore
      }
    }),
    listen<string>("remote:voice_channels", (e) => {
      try {
        const p = JSON.parse(e.payload) as { by: string; listen: string[]; talk: string }
        const peer = peers.get(p.by)
        if (!peer) return
        peer.listen = (Array.isArray(p.listen) ? p.listen : []).filter((c) => CHANNEL_IDS.includes(c))
        peer.talkTo = validTalk(String(p.talk))
        rewire()
        publishPeers()
      } catch {
        // ignore
      }
    }),
    listen<string>("remote:voice_talk", (e) => {
      try {
        const p = JSON.parse(e.payload) as { on: boolean; by: string }
        const peer = peers.get(p.by)
        if (peer) {
          peer.talking = !!p.on
          publishPeers()
        }
      } catch {
        // ignore
      }
    }),
  ]
  const buf = new Float32Array(1024)
  const meter = setInterval(() => {
    const s = useVoice.getState()
    const next = s.peers.map((x) => {
      const a = peers.get(x.name)?.analyser
      return { ...x, speaking: !!a && rms(a, buf) > SPEAKING }
    })
    const hostSpeaking = !!hostMic && s.hostTalking && rms(hostMic.analyser, buf) > SPEAKING
    if (hostSpeaking !== s.hostSpeaking || next.some((x, i) => x.speaking !== s.peers[i].speaking)) useVoice.setState({ peers: next, hostSpeaking })
  }, 150)
  return () => {
    hosting = false
    clearInterval(meter)
    offSettings()
    for (const off of offs) void off.then((f) => f())
    for (const name of [...peers.keys()]) drop(name)
  }
}

// ---------------------------------------------------------------- a joined desk

/** One desk's connection to the host's talk channel. */
export class TalkClient {
  private pc: RTCPeerConnection | null = null
  private mic: MediaStreamTrack | null = null
  private player: HTMLAudioElement | null = null
  /** What this desk hears (the host's mix of everyone else). */
  remote: MediaStream | null = null

  private address: string
  private token: string

  constructor(address: string, token: string) {
    this.address = address
    this.token = token
  }

  /** Join; `stream` replaces the microphone (tests). */
  async join(stream?: MediaStream): Promise<void> {
    const s = stream ?? (await navigator.mediaDevices.getUserMedia(MIC))
    this.mic = s.getAudioTracks()[0]
    this.mic.enabled = false
    const pc = new RTCPeerConnection({ iceServers: [] })
    this.pc = pc
    pc.addTransceiver(this.mic, { direction: "sendrecv", streams: [s] })
    pc.ontrack = (e) => {
      this.remote = e.streams[0] ?? new MediaStream([e.track])
      this.player = new Audio()
      this.player.srcObject = this.remote
      void this.player.play().catch(() => {})
    }
    await pc.setLocalDescription(await pc.createOffer())
    await gathered(pc)
    const sdp = await invoke<string>("join_voice", { address: this.address, token: this.token, sdp: pc.localDescription!.sdp })
    await pc.setRemoteDescription({ type: "answer", sdp })
  }

  /** Channels heard besides All crew, and whom to talk to ("all", a channel, "to:<name>"). */
  channels(listen: string[], talk: string): void {
    void invoke("join_command", { address: this.address, token: this.token, command: { command: "voice_channels", value: { listen, talk } } }).catch(() => {})
  }

  /** Hold or let go of Talk; everyone sees it. */
  talk(on: boolean): void {
    if (!this.mic || this.mic.enabled === on) return
    this.mic.enabled = on
    void invoke("join_command", { address: this.address, token: this.token, command: { command: "voice_talk", value: on } }).catch(() => {})
  }

  get state(): RTCPeerConnectionState | "off" {
    return this.pc?.connectionState ?? "off"
  }

  /** Muting what this desk hears (its own output only). */
  set muted(m: boolean) {
    if (this.player) this.player.muted = m
  }

  leave(): void {
    this.talk(false)
    if (this.pc) void invoke("join_command", { address: this.address, token: this.token, command: { command: "voice_leave" } }).catch(() => {})
    this.player?.pause()
    this.mic?.stop()
    this.pc?.close()
    this.pc = null
    this.mic = null
    this.remote = null
  }
}
