import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { create } from "zustand"

/**
 * Rhema Comms voice (C3, ADR 0002): one LAN talk channel, full duplex. The host is the hub: each
 * joined desk has one WebRTC connection to it, and the host sums everyone else's voice (and the main
 * desk's microphone) into what each desk hears, never its own. Anyone may talk at any time; nothing
 * is muted because someone else is talking. Talk is the microphone track switched on; who is
 * actually audible is measured here. The intercom has its own microphone stream and audio graph:
 * nothing reaches the outputs, NDI, the sound player, listening or any recording.
 */
export interface VoicePerson {
  name: string
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
}

export const useVoice = create<VoiceState>(() => ({ peers: [], hostTalking: false, hostSpeaking: false, micError: null, volume: 1 }))

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
  /** Keeps WebKit pulling the remote track (it can stay silent in WebAudio otherwise). */
  sink: HTMLAudioElement | null
}

let ctx: AudioContext | null = null
let monitor: GainNode | null = null
const peers = new Map<string, Peer>()
let hostMic: { stream: MediaStream; gate: GainNode; analyser: AnalyserNode } | null = null

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
  useVoice.setState({ peers: [...peers.entries()].map(([name, p]) => ({ name, talking: p.talking, speaking: !!useVoice.getState().peers.find((x) => x.name === name)?.speaking })) })
}

function drop(name: string) {
  const p = peers.get(name)
  if (!p) return
  peers.delete(name)
  p.voice?.disconnect()
  p.sink?.pause()
  p.pc.close()
  publishPeers()
}

/** A desk's offer: answer it with what that desk should hear. */
async function answer(id: string, by: string, sdp: string) {
  const a = await audio()
  drop(by) // a desk that reconnects replaces its old connection
  const pc = new RTCPeerConnection({ iceServers: [] })
  const mix = a.createMediaStreamDestination()
  const peer: Peer = { pc, mix, voice: null, analyser: null, talking: false, sink: null }
  hostMic?.gate.connect(mix)
  for (const other of peers.values()) other.voice?.connect(mix)
  peers.set(by, peer)
  pc.ontrack = (e) => {
    const stream = e.streams[0] ?? new MediaStream([e.track])
    peer.sink = new Audio()
    peer.sink.muted = true
    peer.sink.srcObject = stream
    void peer.sink.play().catch(() => {})
    const voice = a.createMediaStreamSource(stream)
    const analyser = a.createAnalyser()
    analyser.fftSize = 1024
    voice.connect(analyser)
    voice.connect(monitor!)
    for (const [name, other] of peers) if (name !== by) voice.connect(other.mix)
    peer.voice = voice
    peer.analyser = analyser
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
  await invoke("voice_answer", { id, sdp: pc.localDescription!.sdp })
}

/** The main desk's Talk. `stream` replaces the microphone (tests). */
export async function hostTalk(on: boolean, stream?: MediaStream): Promise<void> {
  if (on && !hostMic) {
    try {
      const a = await audio()
      const s = stream ?? (await navigator.mediaDevices.getUserMedia(MIC))
      const gate = a.createGain()
      gate.gain.value = 0
      const analyser = a.createAnalyser()
      analyser.fftSize = 1024
      a.createMediaStreamSource(s).connect(gate)
      gate.connect(analyser)
      for (const p of peers.values()) gate.connect(p.mix)
      hostMic = { stream: s, gate, analyser }
      useVoice.setState({ micError: null })
    } catch (e) {
      useVoice.setState({ micError: `The microphone is not available: ${e instanceof Error ? e.message : String(e)}` })
      return
    }
  }
  if (hostMic) hostMic.gate.gain.value = on ? 1 : 0
  useVoice.setState({ hostTalking: on && !!hostMic })
}

let hosting = false
/** Start answering desks (the main window, once). */
export function startVoiceHub(): () => void {
  if (hosting) return () => {}
  hosting = true
  const offs = [
    listen<string>("remote:voice_offer", (e) => {
      try {
        const p = JSON.parse(e.payload) as { id: string; by: string; sdp: string }
        void answer(p.id, p.by, p.sdp).catch((err) => console.warn("[voice] could not answer", p.by, err))
      } catch {
        // not an offer
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
    this.player?.pause()
    this.mic?.stop()
    this.pc?.close()
    this.pc = null
    this.mic = null
    this.remote = null
  }
}
