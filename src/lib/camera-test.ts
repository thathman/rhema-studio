import { networkMeasures } from "@/lib/camera-playback"
import { WhepPlayer, type CameraPlayback, type WhepSignal } from "@/lib/whep"

/**
 * Test camera (#209): play a camera here for a few seconds and measure it: how long its first
 * frame takes, the frames a second shown, jitter, packets lost and the round trip to the router.
 * Measured on this computer; nothing is guessed from the connection.
 */
export interface CameraTestResult {
  /** A picture came. */
  ok: boolean
  firstFrameMs: number | null
  fps: number | null
  jitterMs: number | null
  lossPct: number | null
  rttMs: number | null
  width: number | null
  height: number | null
}

type Player = Pick<WhepPlayer, "ready" | "readStats" | "report" | "close" | "meter">

export interface CameraTestOptions {
  make?: (url: string, signal: WhepSignal) => Player
  wait?: (ms: number) => Promise<void>
  /** No first frame by then: the test says so (ms). */
  timeoutMs?: number
  /** Measured over this long once the picture is there (ms). */
  settleMs?: number
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

export async function testCamera(url: string, signal: WhepSignal, o: CameraTestOptions = {}): Promise<CameraTestResult> {
  const make = o.make ?? ((u, s) => new WhepPlayer(u, s, () => {}))
  const wait = o.wait ?? sleep
  const timeout = o.timeoutMs ?? 10_000
  const settle = o.settleMs ?? 4_000
  const p = make(url, signal)
  try {
    let waited = 0
    while (!p.ready && waited < timeout) {
      await wait(100)
      waited += 100
    }
    if (!p.ready) return { ok: false, firstFrameMs: null, fps: null, jitterMs: null, lossPct: null, rttMs: null, width: null, height: null }
    p.meter.read()
    await p.readStats()
    await wait(settle)
    await p.readStats()
    const r: CameraPlayback = p.report()
    return { ok: true, firstFrameMs: r.firstFrameMs ?? null, fps: r.fps, jitterMs: r.jitterMs ?? null, lossPct: r.lossPct ?? null, rttMs: r.rttMs ?? null, width: r.width, height: r.height }
  } finally {
    p.close()
  }
}

/** The test's result in words, with the measured lag when there is one. */
export function cameraTestWords(r: CameraTestResult, lag: string | null): { text: string; tone: "ok" | "warn" } {
  if (!r.ok) return { text: "No picture within 10 s: is the phone sending, and on the church network?", tone: "warn" }
  const parts = [r.firstFrameMs === null ? "Picture arrived" : `First picture after ${(r.firstFrameMs / 1000).toFixed(1)} s`]
  if (r.fps !== null) parts.push(`${Math.round(r.fps * 10) / 10} fps here`)
  if (r.width && r.height) parts.push(`${r.width}×${r.height}`)
  parts.push(...networkMeasures(r))
  parts.push(lag ? `lag ${lag}` : "lag not measured yet (Setup → Screens → Measure camera lag)")
  const warn = (r.lossPct ?? 0) >= 2 || (r.jitterMs ?? 0) >= 60 || (r.fps !== null && r.fps > 0 && r.fps < 15)
  return { text: parts.join(" · "), tone: warn ? "warn" : "ok" }
}
