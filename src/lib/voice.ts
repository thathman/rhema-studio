import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { create } from "zustand"
import { DEFAULT_TALK_RULES, useSettingsStore } from "@/stores/settings-store"
import { roleLabel } from "@/lib/remote-roles"

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
/** How loud the others are while the main desk talks with priority, unless Settings → Audio says otherwise. */
const DUCKED = DEFAULT_TALK_RULES.duck

/** Where a voice goes: "all", a channel id, or "to:<name>" (one person; "to:host" for the main desk). */
export function talkName(talk: string, hostName = "Main desk"): string {
  if (talk === "all") return "All crew"
  if (talk === PRIORITY) return "All crew (priority)"
  if (talk.startsWith("to:")) return talk === `to:${HOST}` ? hostName : talk.slice(3)
  return CHANNELS.find((c) => c.id === talk)?.name ?? talk
}

/**
 * Whether a voice talking to `talk` is heard by the listener whose key id is `listener` ("host" for
 * the main desk) and who listens to `listen`. A private call ("to:…") reaches only the key it was
 * resolved to when it was chosen (`toId`), never a name: a desk named like another (a look-alike
 * letter, a copied name) never hears a call meant for the other (#251).
 */
export function hears(talk: string, listener: string, listen: readonly string[], toId?: string | null): boolean {
  if (talk === "all" || talk === PRIORITY) return true
  if (talk.startsWith("to:")) return !!toId && toId === listener
  return listen.includes(talk)
}

/**
 * Whose key a private call to `talk` ("to:<name>") goes to, decided once, when it is chosen: "host"
 * for the main desk, else the one desk in the talk channel with exactly that name. None when no
 * desk, or more than one, has it: then nobody hears the call rather than the wrong person.
 */
export function callTarget(talk: string, people: Iterable<[string, { name: string }]>): string | undefined {
  if (!talk.startsWith("to:")) return undefined
  const name = talk.slice(3)
  if (name === HOST) return HOST
  const found = [...people].filter(([, p]) => p.name === name)
  return found.length === 1 ? found[0][0] : undefined
}

/**
 * Whether a desk with `role` may hear and talk on `channel` (Settings → Audio → Talk channels). All
 * crew is everyone's; a channel the rules do not list is open to every role; the main desk and a
 * desk with no known role (this computer itself, a shared key) may use every channel.
 */
export function mayUseChannel(rules: { channels: Partial<Record<string, readonly string[]>> } | undefined, channel: string, role?: string): boolean {
  if (!role || channel === "all" || channel === PRIORITY || channel.startsWith("to:")) return true
  const allowed = rules?.channels[channel]
  return !allowed || allowed.includes(role)
}

/** The talk channels a desk with `role` may use, by the host's rules (all of them when it says none). */
export function channelsFor(rights: Record<string, string[]> | undefined, role?: string): { id: string; name: string }[] {
  return CHANNELS.filter((c) => mayUseChannel({ channels: rights ?? {} }, c.id, role))
}

/** A person in the talk channel as the crew reads them: their name and their desk's role ("Ade · Bible"). */
export function speakerName(p: { name: string; role?: string }): string {
  return p.role ? `${p.name} · ${roleLabel(p.role)}` : p.name
}

/**
 * How loud one person is heard (0–1), from a listener's own levels: muted is silent, otherwise its
 * volume, and full for anyone not set. Each listener's levels change only what they hear.
 */
export interface PersonLevel { volume: number; muted?: boolean }
export function levelOf(levels: Readonly<Record<string, PersonLevel | number>> | undefined, key: string): number {
  const l = levels?.[key]
  if (l === undefined) return 1
  if (typeof l === "number") return Number.isFinite(l) ? Math.min(1, Math.max(0, l)) : 1
  return l.muted ? 0 : Math.min(1, Math.max(0, l.volume))
}

/** The key a joined desk or phone uses for the main desk in its levels (it knows the others by name). */
export const HOST_LEVEL = "to:host"

export interface VoicePerson {
  /** The desk's key id: on the main desk only, never sent to joined desks. */
  id?: string
  name: string
  /** The desk's role ("bible", "stage"…), so the crew can tell who is talking (absent for the main desk and older hosts). */
  role?: string
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
  /** Said when the chosen talk microphone is missing and the system's is used instead. */
  micNote: string | null
  /** How loud the main desk hears the crew, 0–1. */
  volume: number
  /** The main desk's channels (besides All crew) and whom it talks to. */
  hostListen: string[]
  hostTalkTo: string
  /** Whose key the main desk's private call goes to (see callTarget). */
  hostTalkToId: string | null
  /** How loud the main desk hears each desk, by key id (its own output only). */
  hostLevels: Record<string, PersonLevel>
}

export const useVoice = create<VoiceState>(() => ({ peers: [], hostTalking: false, hostSpeaking: false, micError: null, micNote: null, volume: 1, hostListen: [...CHANNEL_IDS], hostTalkTo: "all", hostTalkToId: null, hostLevels: {} }))

/** How loud the main desk hears one desk (by key id), or mutes it; only what the main desk hears changes. */
export function setHostLevel(id: string, level: PersonLevel): void {
  const volume = Math.min(1, Math.max(0, Number.isFinite(level.volume) ? level.volume : 1))
  useVoice.setState((s) => ({ hostLevels: { ...s.hostLevels, [id]: { volume, ...(level.muted ? { muted: true } : {}) } } }))
  rewire()
}

/** How loud the main desk hears the crew (its own output only). */
export function setVoiceVolume(v: number): void {
  const volume = Math.min(1, Math.max(0, v))
  if (monitor) monitor.gain.value = volume
  useVoice.setState({ volume })
}

const VOICE = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
const MIC: MediaStreamConstraints = { audio: VOICE }

/**
 * The talk microphone: the one chosen for this computer when it is plugged in, otherwise the
 * system's (and the desk is told), so an unplugged headset never leaves someone unable to talk.
 */
export async function openTalkMic(deviceId = useSettingsStore.getState().talkInputId): Promise<MediaStream> {
  if (deviceId) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { ...VOICE, deviceId: { exact: deviceId } } })
      useVoice.setState({ micNote: null })
      return s
    } catch (e) {
      const name = (e as { name?: string } | null)?.name
      if (name !== "OverconstrainedError" && name !== "NotFoundError") throw e
      useVoice.setState({ micNote: "The chosen talk microphone is not connected: using the system's microphone." })
      return navigator.mediaDevices.getUserMedia(MIC)
    }
  }
  useVoice.setState({ micNote: null })
  return navigator.mediaDevices.getUserMedia(MIC)
}

type Sinkable = { setSinkId?: (id: string) => Promise<void> }

/** Whether this computer can send the crew to a chosen output; where it cannot (WebKit, so far) the crew plays on the system output. */
export function canChooseTalkOutput(): boolean {
  const media = globalThis.HTMLMediaElement?.prototype as Sinkable | undefined
  const context = globalThis.AudioContext?.prototype as Sinkable | undefined
  return typeof media?.setSinkId === "function" || typeof context?.setSinkId === "function"
}

/** Send an audio element or audio context to the chosen output ("" = the system's), where it can. */
async function toOutput(target: object | null, id: string): Promise<void> {
  const set = (target as Sinkable | null)?.setSinkId
  if (typeof set !== "function") return
  await set.call(target, id).catch((e: unknown) => console.warn("[voice] could not use the chosen output", e))
}

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
  /** The name its key was paired under: for people to read only. */
  name: string
  pc: RTCPeerConnection
  /** What this desk hears: everyone but itself. */
  mix: MediaStreamAudioDestinationNode
  /** This desk's voice, once its track arrives. */
  voice: AudioNode | null
  analyser: AnalyserNode | null
  talking: boolean
  listen: string[]
  talkTo: string
  /** Whose key its private call goes to, found when it chose it. */
  toId?: string
  /** Its paired role, from the main desk's list of devices (for channel rights and the crew list). */
  role?: string
  /** How loud it hears each person (0–1), by name, or HOST_LEVEL for the main desk: set on that desk. */
  levels: Record<string, number>
}

let ctx: AudioContext | null = null
let monitor: GainNode | null = null
/** The desks in the talk channel, by key id (the host's server stamps it; never a name). */
const peers = new Map<string, Peer>()
let hostMic: { stream: MediaStream; source: AudioNode; gate: GainNode; analyser: AnalyserNode } | null = null
/** One gain per speaker → listener (key ids, from → to → route); 1 when the speaker's talk reaches that listener. */
const routes = new Map<string, Map<string, { gain: GainNode; source: AudioNode }>>()

/**
 * Wire every speaker to every listener through its own gain and set each by the talk rules: All
 * crew reaches everyone, a channel its listeners, a private call only the key it was chosen for.
 * Nobody hears themselves. Called whenever someone joins, leaves or changes channels.
 */
function rewire() {
  if (!ctx) return
  const v = useVoice.getState()
  const rules = useSettingsStore.getState().talkRules ?? DEFAULT_TALK_RULES
  const duck = Number.isFinite(rules.duck) && rules.duck > 0 ? rules.duck : DUCKED
  type End = { source: AudioNode | null; sink: AudioNode; listen: readonly string[]; talk: string; toId?: string | null; role?: string; level: (from: string) => number }
  const ends = new Map<string, End>()
  if (monitor) ends.set(HOST, { source: hostMic?.gate ?? null, sink: monitor, listen: v.hostListen, talk: v.hostTalkTo, toId: v.hostTalkToId, level: (from) => levelOf(v.hostLevels, from) })
  // A desk sets levels by the names it sees; the main desk's is HOST_LEVEL.
  for (const [id, p] of peers) ends.set(id, { source: p.analyser, sink: p.mix, listen: p.listen, talk: p.talkTo, toId: p.toId, role: p.role, level: (from) => levelOf(p.levels, from === HOST ? HOST_LEVEL : peers.get(from)?.name ?? "") })
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
      // While the main desk talks with priority, everyone else is quieter for every listener (never silent).
      const ducked = v.hostTalking && v.hostTalkTo === PRIORITY && from !== HOST
      // A channel's rights by role: a speaker it does not allow reaches nobody on it, and a listener it does not allow never hears it.
      const allowed = mayUseChannel(rules, a.talk, a.role) && mayUseChannel(rules, a.talk, b.role)
      r.gain.gain.value = allowed && hears(a.talk, to, b.listen, a.toId) ? (ducked ? duck : 1) * b.level(from) : 0
    }
  }
}

/** How loud `from` reaches `to` now (key ids, "host" for the main desk): for tests and QA. Undefined when there is no route yet. */
export function routeLevel(from: string, to: string): number | undefined {
  return routes.get(from)?.get(to)?.gain.gain.value
}

/**
 * The main desk's channels and talk target. A private call ("to:<name>") goes to `toId`, the key
 * the main desk picked from the crew list, or else the one desk in the channel with that name now.
 */
export function setHostChannels(listen: string[], talkTo: string, toId?: string): void {
  const talk = validTalk(talkTo)
  useVoice.setState({ hostListen: listen.filter((c) => CHANNEL_IDS.includes(c)), hostTalkTo: talk, hostTalkToId: talk.startsWith("to:") ? toId ?? callTarget(talk, peers) ?? null : null })
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
    const out = useSettingsStore.getState().talkOutputId
    if (out) void toOutput(ctx, out)
  }
  if (ctx.state !== "running") await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 1500))])
  return ctx
}

function publishPeers() {
  const before = useVoice.getState().peers
  useVoice.setState({ peers: [...peers.entries()].map(([id, p]) => ({ id, name: p.name, ...(p.role ? { role: p.role } : {}), talk: p.talkTo, talking: p.talking, speaking: !!before.find((x) => x.id === id)?.speaking })) })
}

function drop(id: string) {
  const p = peers.get(id)
  if (!p) return
  peers.delete(id)
  p.voice?.disconnect()
  p.analyser?.disconnect()
  p.pc.close()
  rewire()
  publishPeers()
}

/** How long a desk that went quiet on the network keeps its place before it leaves the crew list. */
const PEER_GRACE_MS = 3000

function connected(pc: RTCPeerConnection): boolean {
  return pc.connectionState === "connected" || pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed"
}

/**
 * Which desk a talk event is from: its key id, stamped by the host's server. This computer itself,
 * with keys off, has no key and is known by its name then.
 */
function talker(p: { by?: unknown; byId?: unknown }): string {
  return typeof p.byId === "string" && p.byId ? p.byId : `name:${String(p.by ?? "")}`
}

/** A paired desk's role, by its key id (none for this computer itself or a shared key). */
function deviceRole(id: string): string | undefined {
  return useSettingsStore.getState().remoteDevices.find((d) => d.hash === id)?.role
}

/** A desk's levels as it sent them (percent, by name): at most 32 people, each 0–1. */
function asLevels(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 32)) if (typeof v === "number" && Number.isFinite(v)) out[k.slice(0, 84)] = Math.min(100, Math.max(0, v)) / 100
  return out
}

/** A desk's offer: answer it with what that desk should hear. `by` is its key id, `name` for people to read. */
async function answer(id: string, by: string, name: string, sdp: string) {
  const a = await audio()
  drop(by) // a desk that reconnects replaces its old connection
  const pc = new RTCPeerConnection({ iceServers: [] })
  const mix = a.createMediaStreamDestination()
  const peer: Peer = { name, pc, mix, voice: null, analyser: null, talking: false, listen: [...CHANNEL_IDS], talkTo: "all", role: deviceRole(by), levels: {} }
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
  // A desk that left or lost the network leaves the crew list: at once on failure, after a short
  // grace otherwise (a blip on the network often comes back by itself). Its Talk shows let go at once.
  const watch = () => {
    if (peers.get(by)?.pc !== pc) return
    const states = [pc.connectionState, pc.iceConnectionState] as string[]
    if (states.includes("failed") || states.includes("closed")) return drop(by)
    if (!states.includes("disconnected")) return
    if (peer.talking) {
      peer.talking = false
      publishPeers()
    }
    setTimeout(() => { if (peers.get(by)?.pc === pc && !connected(pc)) drop(by) }, PEER_GRACE_MS)
  }
  pc.onconnectionstatechange = watch
  pc.oniceconnectionstatechange = watch
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
    const s = stream ?? (await openTalkMic())
    const gate = a.createGain()
    gate.gain.value = 0
    const analyser = a.createAnalyser()
    analyser.fftSize = 1024
    const source = a.createMediaStreamSource(s)
    source.connect(gate)
    gate.connect(analyser)
    // Keep the meter processed without hearing yourself.
    const silent = a.createGain()
    silent.gain.value = 0
    analyser.connect(silent).connect(a.destination)
    hostMic = { stream: s, source, gate, analyser }
    rewire()
    useVoice.setState({ micError: null })
  } catch (e) {
    useVoice.setState({ micError: `The microphone is not available: ${e instanceof Error ? e.message : String(e)}` })
  }
}

/** Close the main desk's microphone (another was chosen): the next Talk press opens the new one. */
function closeHostMic() {
  if (!hostMic) return
  for (const t of hostMic.stream.getTracks()) t.stop()
  hostMic.source.disconnect()
  hostMic.gate.disconnect()
  hostMic.analyser.disconnect()
  hostMic = null
  wantTalk = false
  useVoice.setState({ hostTalking: false, hostSpeaking: false })
  rewire()
}

let hosting = false
/** Start answering desks (the main window, once). */
export function startVoiceHub(): () => void {
  if (hosting) return () => {}
  hosting = true
  // A device whose key is revoked leaves the talk channel at once (its next request would be
  // refused anyway, but an open call would carry on). Known by its key, as everywhere here.
  const offSettings = useSettingsStore.subscribe((s, p) => {
    // Another headset chosen for this computer: the crew is heard there now, the microphone from the next Talk.
    if (s.talkOutputId !== p.talkOutputId && ctx) void toOutput(ctx, s.talkOutputId)
    if (s.talkInputId !== p.talkInputId) closeHostMic()
    // The channels' rights or priority level changed: everyone's routes follow at once.
    if (s.talkRules !== p.talkRules) rewire()
    if (s.remoteDevices === p.remoteDevices) return
    const kept = new Set(s.remoteDevices.map((d) => d.hash))
    for (const d of p.remoteDevices) if (!kept.has(d.hash)) drop(d.hash)
    // A desk given another role: its channel rights and crew label follow.
    let changed = false
    for (const [id, peer] of peers) {
      const role = deviceRole(id)
      if (role !== peer.role) { peer.role = role; changed = true }
    }
    if (changed) { rewire(); publishPeers() }
  })
  const offs = [
    listen<string>("remote:voice_offer", (e) => {
      try {
        const p = JSON.parse(e.payload) as { id: string; by: string; byId?: string; sdp: string }
        void answer(p.id, talker(p), String(p.by), p.sdp).catch((err) => console.warn("[voice] could not answer", p.by, err))
      } catch {
        // not an offer
      }
    }),
    listen<string>("remote:voice_leave", (e) => {
      try {
        drop(talker(JSON.parse(e.payload) as { by?: string; byId?: string }))
      } catch {
        // ignore
      }
    }),
    listen<string>("remote:voice_channels", (e) => {
      try {
        const p = JSON.parse(e.payload) as { by: string; byId?: string; listen: string[]; talk: string; levels?: unknown }
        const peer = peers.get(talker(p))
        if (!peer) return
        peer.listen = (Array.isArray(p.listen) ? p.listen : []).filter((c) => CHANNEL_IDS.includes(c))
        peer.talkTo = validTalk(String(p.talk))
        // Priority is the main desk's alone.
        if (peer.talkTo === PRIORITY) peer.talkTo = "all"
        peer.levels = asLevels(p.levels)
        // A private call: whose key it goes to is found now, when it is chosen.
        peer.toId = callTarget(peer.talkTo, peers)
        rewire()
        publishPeers()
      } catch {
        // ignore
      }
    }),
    listen<string>("remote:voice_talk", (e) => {
      try {
        const p = JSON.parse(e.payload) as { on: boolean; by: string; byId?: string }
        const peer = peers.get(talker(p))
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
      const a = x.id ? peers.get(x.id)?.analyser : undefined
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
    for (const id of [...peers.keys()]) drop(id)
  }
}

// ---------------------------------------------------------------- a joined desk

/**
 * How a joined desk's talk channel stands: in it; dropped (the main desk went quiet on the network)
 * and joining again; back after a drop; or lost (gave up after the last try).
 */
export type TalkStatus = "on" | "dropped" | "back" | "lost"

/** A blip this short may come back by itself before the desk joins again. */
const BLIP_MS = 2000
/** Tries to join again after a drop (about a minute and a half in all), each given 2 s, 4 s, 8 s… (at most 15 s) to connect. */
const REJOIN_TRIES = 8
const rejoinWait = (tries: number) => Math.min(15000, 2000 * 2 ** Math.max(0, tries - 1))

/**
 * One desk's connection to the host's talk channel. A dropped connection stops the microphone at
 * once and joins again by itself (a bounded number of times); the microphone stays off until the
 * person presses Talk again, so nobody is heard by surprise when the channel comes back.
 */
export class TalkClient {
  private pc: RTCPeerConnection | null = null
  private stream: MediaStream | null = null
  private mic: MediaStreamTrack | null = null
  private player: HTMLAudioElement | null = null
  private down = false
  private left = false
  private tries = 0
  private retry: ReturnType<typeof setTimeout> | null = null
  private input = ""
  private output = ""
  /** What this desk hears (the host's mix of everyone else). */
  remote: MediaStream | null = null
  /** Told when the connection drops, comes back or is given up. */
  onStatus: ((s: TalkStatus) => void) | null = null

  private address: string
  private token: string

  constructor(address: string, token: string) {
    this.address = address
    this.token = token
  }

  /** Join; `stream` replaces the microphone (tests). Hears the crew on `output` ("" = the system's). */
  async join(stream?: MediaStream, output = useSettingsStore.getState().talkOutputId): Promise<void> {
    this.output = output
    this.input = useSettingsStore.getState().talkInputId
    const s = stream ?? (await openTalkMic(this.input))
    this.stream = s
    this.mic = s.getAudioTracks()[0]
    this.mic.enabled = false
    await this.connect()
  }

  /** One connection to the host: offer, its answer, and watching that it stays up. */
  private async connect(): Promise<void> {
    const pc = new RTCPeerConnection({ iceServers: [] })
    this.pc = pc
    pc.addTransceiver(this.mic!, { direction: "sendrecv", streams: [this.stream!] })
    pc.ontrack = (e) => {
      if (this.pc !== pc) return
      this.remote = e.streams[0] ?? new MediaStream([e.track])
      if (!this.player) {
        this.player = new Audio()
        void toOutput(this.player, this.output)
      }
      this.player.srcObject = this.remote
      void this.player.play().catch(() => {})
    }
    pc.onconnectionstatechange = () => this.watch(pc)
    pc.oniceconnectionstatechange = () => this.watch(pc)
    await pc.setLocalDescription(await pc.createOffer())
    await gathered(pc)
    if (this.pc !== pc) return
    const sdp = await invoke<string>("join_voice", { address: this.address, token: this.token, sdp: pc.localDescription!.sdp })
    if (this.pc !== pc) return // left, or replaced, while asking
    await pc.setRemoteDescription({ type: "answer", sdp })
  }

  private watch(pc: RTCPeerConnection) {
    if (pc !== this.pc || this.left) return
    const states = [pc.connectionState, pc.iceConnectionState] as string[]
    if (connected(pc)) {
      if (!this.down) return
      this.down = false
      this.tries = 0
      if (this.retry) clearTimeout(this.retry)
      this.retry = null
      this.onStatus?.("back")
    } else if (states.includes("failed")) this.dropped(0)
    else if (states.includes("disconnected")) this.dropped(BLIP_MS)
  }

  /** The main desk went quiet: stop talking now, then join again (unless the blip passes first). */
  private dropped(wait: number) {
    if (!this.down) {
      this.down = true
      this.stopTalking()
      this.onStatus?.("dropped")
    }
    if (this.retry && wait > 0) return
    if (this.retry) clearTimeout(this.retry)
    this.retry = setTimeout(() => void this.rejoin(), wait)
  }

  private async rejoin() {
    this.retry = null
    if (this.left || !this.down) return
    if (this.tries >= REJOIN_TRIES) {
      this.onStatus?.("lost")
      this.leave()
      return
    }
    this.tries++
    // Each try is checked after its wait: still not connected means the next one.
    this.retry = setTimeout(() => void this.rejoin(), rejoinWait(this.tries))
    const old = this.pc
    this.pc = null
    old?.close()
    try {
      await this.connect()
    } catch {
      // the main desk is not answering yet: the next try is already waiting
    }
  }

  private stopTalking() {
    if (!this.mic?.enabled) return
    this.mic.enabled = false
    void invoke("join_command", { address: this.address, token: this.token, command: { command: "voice_talk", value: false } }).catch(() => {})
  }

  /**
   * Channels heard besides All crew, whom to talk to ("all", a channel, "to:<name>"), and how loud
   * this desk hears each person (0–1, by name; HOST_LEVEL for the main desk). The main desk mixes
   * what this desk hears, so the levels are applied there.
   */
  channels(listen: string[], talk: string, levels: Record<string, PersonLevel> = {}): void {
    const percent = Object.fromEntries(Object.keys(levels).map((k) => [k, Math.round(levelOf(levels, k) * 100)]).filter(([, v]) => v !== 100))
    void invoke("join_command", { address: this.address, token: this.token, command: { command: "voice_channels", value: { listen, talk, ...(Object.keys(percent).length ? { levels: percent } : {}) } } }).catch(() => {})
  }

  /** Hold or let go of Talk; everyone sees it. Nothing while the connection is down. */
  talk(on: boolean): void {
    if (!this.mic || this.mic.enabled === on || (on && this.down)) return
    this.mic.enabled = on
    void invoke("join_command", { address: this.address, token: this.token, command: { command: "voice_talk", value: on } }).catch(() => {})
  }

  /** Whether the connection is down and joining again. */
  get dropping(): boolean {
    return this.down
  }

  get state(): RTCPeerConnectionState | "off" {
    return this.pc?.connectionState ?? "off"
  }

  /**
   * Another headset chosen: the crew is heard on `output` now, and `input` talks from the next
   * Talk press (Talk is let go meanwhile). True when the microphone changed.
   */
  async useDevices(input: string, output: string): Promise<boolean> {
    if (output !== this.output) {
      this.output = output
      await toOutput(this.player, output)
    }
    if (!this.mic || this.left || input === this.input) return false
    this.input = input
    const s = await openTalkMic(input)
    const track = s.getAudioTracks()[0]
    if (this.left) {
      track.stop()
      return false
    }
    this.stopTalking()
    track.enabled = false
    await this.pc?.getSenders().find((x) => x.track === this.mic)?.replaceTrack(track)
    this.mic.stop()
    this.mic = track
    this.stream = s
    return true
  }

  /** Muting what this desk hears (its own output only). */
  set muted(m: boolean) {
    if (this.player) this.player.muted = m
  }

  leave(): void {
    this.talk(false)
    this.left = true
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    if (this.pc) void invoke("join_command", { address: this.address, token: this.token, command: { command: "voice_leave" } }).catch(() => {})
    this.player?.pause()
    this.mic?.stop()
    this.pc?.close()
    this.pc = null
    this.mic = null
    this.remote = null
  }
}
