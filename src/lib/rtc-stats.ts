/**
 * What the network does to a camera on its way to a screen (#213 signal truth, #209): WebRTC's own
 * counters for the camera's video (RTCPeerConnection.getStats). A reading compares two samples:
 * jitter, the share of packets lost, the round trip to the camera router, and the frames a second
 * that arrive and that are decoded. Measured on the screen that plays it, never guessed.
 */

/** WebRTC's counters at one moment (only those Rhema reads). */
export interface RtcSample {
  /** performance.now() of the sample. */
  at: number
  /** The video's jitter as WebRTC estimates it (seconds); null when not said. */
  jitter: number | null
  packetsReceived: number | null
  packetsLost: number | null
  framesReceived: number | null
  framesDecoded: number | null
  /** The incoming frame rate WebRTC itself reports, when it does. */
  framesPerSecond: number | null
  /** The round trip to the router on the connection in use (seconds); null when not measured yet. */
  rtt: number | null
}

export interface RtcReading {
  /** Jitter (ms). */
  jitterMs: number | null
  /** Of the packets between the two samples, the share lost (0–100). */
  lossPct: number | null
  /** Round trip to the router (ms). */
  rttMs: number | null
  /** Frames a second arriving from the network, and decoded, between the two samples. */
  recvFps: number | null
  decodeFps: number | null
}

export const NO_RTC: RtcReading = { jitterMs: null, lossPct: null, rttMs: null, recvFps: null, decodeFps: null }

type Stat = Record<string, unknown> & { type?: string; id?: string }

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)

/** The counters from a getStats() report: the video coming in, and the connection pair in use. */
export function rtcSample(report: Iterable<Stat> | { forEach: (cb: (s: Stat) => void) => void }, at: number): RtcSample | null {
  const all: Stat[] = []
  if (typeof (report as { forEach?: unknown }).forEach === "function") (report as { forEach: (cb: (s: Stat) => void) => void }).forEach((s) => all.push(s))
  else for (const s of report as Iterable<Stat>) all.push(s)
  const video = all.find((s) => s.type === "inbound-rtp" && (s.kind === "video" || s.mediaType === "video"))
  if (!video) return null
  const selected = all.find((s) => s.type === "transport" && typeof s.selectedCandidatePairId === "string")?.selectedCandidatePairId
  const pair = all.find((s) => s.type === "candidate-pair" && (selected ? s.id === selected : s.state === "succeeded" && (s.nominated === true || s.selected === true)))
  return {
    at,
    jitter: num(video.jitter),
    packetsReceived: num(video.packetsReceived),
    packetsLost: num(video.packetsLost),
    framesReceived: num(video.framesReceived),
    framesDecoded: num(video.framesDecoded),
    framesPerSecond: num(video.framesPerSecond),
    rtt: pair ? num(pair.currentRoundTripTime) : null,
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** A reading from the sample before and this one (the first has no rates yet). */
export function rtcReading(prev: RtcSample | null, cur: RtcSample): RtcReading {
  const jitterMs = cur.jitter === null ? null : round1(cur.jitter * 1000)
  const rttMs = cur.rtt === null ? null : round1(cur.rtt * 1000)
  const secs = prev ? (cur.at - prev.at) / 1000 : 0
  const delta = (a: number | null | undefined, b: number | null) => (a !== null && a !== undefined && b !== null && b >= a ? b - a : null)
  const dRecv = delta(prev?.packetsReceived, cur.packetsReceived)
  const dLost = delta(prev?.packetsLost, cur.packetsLost)
  const lossPct = dRecv !== null && dLost !== null && dRecv + dLost > 0 ? round1((dLost / (dRecv + dLost)) * 100) : null
  const rate = (a: number | null | undefined, b: number | null) => {
    const d = delta(a, b)
    return d !== null && secs > 0.2 ? round1(d / secs) : null
  }
  const recvFps = rate(prev?.framesReceived, cur.framesReceived) ?? (cur.framesPerSecond === null ? null : round1(cur.framesPerSecond))
  return { jitterMs, lossPct, rttMs, recvFps, decodeFps: rate(prev?.framesDecoded, cur.framesDecoded) }
}
