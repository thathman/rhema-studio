/**
 * Playing a camera on the church network (OP-009, #209): WHEP, the WebRTC playback MediaMTX offers
 * for each camera it relays. Receive-only video (the sanctuary hears the room, not the camera), on
 * a muted, inline video element a scene draws from. A dropped camera retries every few seconds.
 */
export type WhepSignal = (url: string, sdp: string) => Promise<string>

export class WhepPlayer {
  readonly video: HTMLVideoElement
  private pc: RTCPeerConnection | null = null
  private closed = false
  private retry: ReturnType<typeof setTimeout> | null = null
  state: "connecting" | "playing" | "failed" = "connecting"

  readonly url: string
  private readonly signal: WhepSignal
  private readonly onChange: () => void

  constructor(url: string, signal: WhepSignal, onChange: () => void) {
    this.url = url
    this.signal = signal
    this.onChange = onChange
    this.video = document.createElement("video")
    this.video.muted = true
    this.video.playsInline = true
    void this.connect()
  }

  private async connect() {
    if (this.closed) return
    this.state = "connecting"
    const pc = new RTCPeerConnection({ iceServers: [] })
    this.pc = pc
    pc.addTransceiver("video", { direction: "recvonly" })
    pc.ontrack = (e) => {
      this.video.srcObject = e.streams[0] ?? new MediaStream([e.track])
      void this.video.play().catch(() => {})
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

  /** A frame is ready to draw. */
  get ready(): boolean {
    return this.state === "playing" && this.video.readyState >= 2 && this.video.videoWidth > 0
  }

  close() {
    this.closed = true
    if (this.retry) clearTimeout(this.retry)
    this.pc?.close()
    this.pc = null
    this.video.srcObject = null
  }
}

/** Keep one player per camera layer of the scene up: start new ones, stop gone or changed ones. */
export function syncCameras(players: Map<string, WhepPlayer>, layers: { id: string; kind: string; cameraUrl?: string }[], signal: WhepSignal, onChange: () => void): void {
  const want = new Map(layers.filter((l) => l.kind === "camera" && l.cameraUrl).map((l) => [l.id, l.cameraUrl!]))
  for (const [id, p] of players) {
    if (want.get(id) !== p.url) {
      p.close()
      players.delete(id)
    }
  }
  for (const [id, url] of want) if (!players.has(id)) players.set(id, new WhepPlayer(url, signal, onChange))
}
