/**
 * Playing a camera on the church network (OP-009, #209): WHEP, the WebRTC playback MediaMTX offers
 * for each camera it relays. Receive-only video (the sanctuary hears the room, not the camera), on
 * a muted, inline video element a scene draws from. A dropped camera retries every few seconds.
 */
import { VideoMeter } from "@/lib/video-meter"
import { cameraPathOf } from "@/lib/live-sources"
import { NO_RTC, rtcReading, rtcSample, type RtcReading, type RtcSample } from "@/lib/rtc-stats"

export type WhepSignal = (url: string, sdp: string) => Promise<string>

/** One camera as this screen plays it, for Show health (#213): measured here, not guessed. */
export interface CameraPlayback {
  /** The router's name for it ("pulpit"); empty for an address typed by hand. */
  camera: string
  /** This screen has a picture from it now. */
  playing: boolean
  fps: number | null
  decoded: number | null
  dropped: number | null
  droppedPct: number | null
  frameAgeMs: number | null
  width: number | null
  height: number | null
  /** Frozen by the operator on purpose (the last frame is held). */
  held: boolean
  /** WebRTC's own counters (#213): jitter (ms), packets lost (%), round trip to the router (ms). */
  jitterMs?: number | null
  lossPct?: number | null
  rttMs?: number | null
  /** Frames a second arriving from the network, and decoded, on this screen. */
  recvFps?: number | null
  decodeFps?: number | null
  /** From asking the router to the first frame on this screen (ms), for the latest connection. */
  firstFrameMs?: number | null
}

/** How often a player reads WebRTC's counters. */
const STATS_MS = 2000

export class WhepPlayer {
  readonly video: HTMLVideoElement
  private pc: RTCPeerConnection | null = null
  private closed = false
  private retry: ReturnType<typeof setTimeout> | null = null
  state: "connecting" | "playing" | "failed" = "connecting"
  /** Counts the frames this screen really shows (#213). */
  readonly meter: VideoMeter
  /** The operator froze it: the last frame stays (the video is paused, the connection kept). */
  held = false
  /** The router says it is connected but sending nothing: the box shows its fallback instead of a stale frame. */
  stale = false

  readonly url: string
  /** The address and the operator's Retry count: a new count starts the player afresh. */
  readonly key: string
  private readonly signal: WhepSignal
  private readonly onChange: () => void
  private statsTimer: ReturnType<typeof setInterval> | null = null
  private lastStats: RtcSample | null = null
  /** WebRTC's counters as last read (every 2 s). */
  rtc: RtcReading = NO_RTC
  /** When the latest connection was asked for, and how long its first frame took (ms). */
  private askedAt = 0
  firstFrameMs: number | null = null

  constructor(url: string, signal: WhepSignal, onChange: () => void, key = url) {
    this.url = url
    this.key = key
    this.signal = signal
    this.onChange = onChange
    this.video = document.createElement("video")
    this.video.muted = true
    this.video.playsInline = true
    // The first frame (and a new size) is when it can be drawn: say so.
    this.video.addEventListener("loadeddata", () => {
      if (this.firstFrameMs === null && this.askedAt > 0) this.firstFrameMs = Math.round(performance.now() - this.askedAt)
      this.onChange()
    })
    this.video.addEventListener("resize", () => this.onChange())
    this.meter = new VideoMeter(this.video)
    this.statsTimer = setInterval(() => void this.readStats(), STATS_MS)
    void this.connect()
  }

  /** Read WebRTC's counters for the video now (a browser without them leaves the reading empty). */
  async readStats(): Promise<RtcReading> {
    const pc = this.pc
    if (!pc || typeof pc.getStats !== "function") return this.rtc
    try {
      const cur = rtcSample(await pc.getStats(), performance.now())
      if (pc !== this.pc) return this.rtc
      if (!cur) return this.rtc
      this.rtc = rtcReading(this.lastStats, cur)
      this.lastStats = cur
    } catch {
      // A closed connection: the next one starts afresh.
    }
    return this.rtc
  }

  private async connect() {
    if (this.closed) return
    // No WebRTC here (a test page, a very old browser): nothing to play, said as failed.
    if (typeof RTCPeerConnection === "undefined") {
      this.state = "failed"
      return
    }
    this.state = "connecting"
    const pc = new RTCPeerConnection({ iceServers: [] })
    this.pc = pc
    this.lastStats = null
    this.rtc = NO_RTC
    this.askedAt = performance.now()
    this.firstFrameMs = null
    pc.addTransceiver("video", { direction: "recvonly" })
    pc.ontrack = (e) => {
      this.video.srcObject = e.streams[0] ?? new MediaStream([e.track])
      if (!this.held) void this.video.play().catch(() => {})
    }
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return
      if (pc.connectionState === "connected") this.state = "playing"
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") this.again()
      this.onChange()
    }
    try {
      await pc.setLocalDescription(await pc.createOffer())
      await new Promise<void>((done) => {
        if (pc.iceGatheringState === "complete") return done()
        pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") done() })
        setTimeout(done, 2000)
      })
      const answer = await this.signal(this.url, pc.localDescription!.sdp)
      if (this.closed || pc !== this.pc) return
      await pc.setRemoteDescription({ type: "answer", sdp: answer })
    } catch {
      this.again()
    }
    this.onChange()
  }

  private again() {
    this.state = "failed"
    this.pc?.close()
    this.pc = null
    if (this.closed || this.retry) return
    this.retry = setTimeout(() => { this.retry = null; void this.connect() }, 4000)
  }

  /** A frame is ready to draw (and, unless frozen on purpose, the camera is not known to be stale). */
  get ready(): boolean {
    return this.state === "playing" && this.video.readyState >= 2 && this.video.videoWidth > 0 && (this.held || !this.stale)
  }

  /** Freeze on the last frame (pause), or play live again. */
  hold(on: boolean) {
    if (on === this.held) return
    this.held = on
    if (on) this.video.pause()
    else void this.video.play().catch(() => {})
  }

  /** How this screen plays it now (frames a second and dropped since the last report). */
  report(): CameraPlayback {
    const r = this.meter.read()
    const playing = this.ready
    return {
      camera: cameraPathOf(this.url) ?? "",
      playing,
      fps: this.held ? 0 : r.fps,
      decoded: r.decoded,
      dropped: r.dropped,
      droppedPct: r.droppedPct,
      frameAgeMs: r.frameAgeMs,
      width: this.video.videoWidth || null,
      height: this.video.videoHeight || null,
      held: this.held,
      jitterMs: this.rtc.jitterMs,
      lossPct: this.rtc.lossPct,
      rttMs: this.rtc.rttMs,
      recvFps: this.held ? null : this.rtc.recvFps,
      decodeFps: this.held ? null : this.rtc.decodeFps,
      firstFrameMs: this.firstFrameMs,
    }
  }

  close() {
    this.closed = true
    this.meter.close()
    if (this.statsTimer) clearInterval(this.statsTimer)
    if (this.retry) clearTimeout(this.retry)
    this.pc?.close()
    this.pc = null
    this.video.srcObject = null
  }
}

/** What a camera layer's frame says to a screen's player (#213 operator controls). */
export interface CameraLayerPlay {
  id: string
  kind: string
  cameraUrl?: string
  /** The operator's Retry count for its camera: a new one restarts the reader. */
  retry?: number
  /** Freeze: hold the last frame. */
  hold?: boolean
  /** The router says the camera is connected but sending nothing. */
  stale?: boolean
}

/** A player's key: its address and Retry count. */
export const playerKey = (l: Pick<CameraLayerPlay, "cameraUrl" | "retry">) => (l.retry ? `${l.cameraUrl}#${l.retry}` : (l.cameraUrl ?? ""))

/**
 * Keep one player per camera layer of the scene up: start new ones, stop gone or changed ones
 * (another address, or the operator pressed Retry), and hold or release each as the frame says.
 */
export function syncCameras(players: Map<string, WhepPlayer>, layers: CameraLayerPlay[], signal: WhepSignal, onChange: () => void, make: (url: string, signal: WhepSignal, onChange: () => void, key: string) => WhepPlayer = (u, s, c, k) => new WhepPlayer(u, s, c, k)): void {
  const want = new Map(layers.filter((l) => l.kind === "camera" && l.cameraUrl).map((l) => [l.id, l]))
  for (const [id, p] of players) {
    const l = want.get(id)
    if (!l || playerKey(l) !== p.key) {
      p.close()
      players.delete(id)
    }
  }
  let changed = false
  for (const [id, l] of want) {
    let p = players.get(id)
    if (!p) players.set(id, (p = make(l.cameraUrl!, signal, onChange, playerKey(l))))
    const stale = !!l.stale
    if (p.held !== !!l.hold || p.stale !== stale) changed = true
    p.hold(!!l.hold)
    p.stale = stale
  }
  if (changed) onChange()
}

/** How each camera of the scene plays on this screen now, for the host's Show health. */
export function cameraReports(players: Map<string, WhepPlayer>): CameraPlayback[] {
  return [...players.values()].map((p) => p.report())
}
