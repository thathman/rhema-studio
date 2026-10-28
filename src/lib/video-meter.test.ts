import { describe, expect, it } from "vitest"
import { meterReading, VideoMeter, type MeterSample } from "@/lib/video-meter"

const sample = (at: number, presented: number | null, total: number | null, dropped: number | null, lastFrameAt: number | null = at): MeterSample => ({ at, presented, total, dropped, lastFrameAt })

describe("what a camera really shows on a screen (#213)", () => {
  it("frames a second and the share dropped come from two samples, never from one", () => {
    const first = meterReading(null, sample(0, 0, 0, 0))
    expect(first).toEqual({ fps: null, decoded: 0, dropped: 0, droppedPct: null, frameAgeMs: 0 })
    // 2 s later: 60 frames shown, the browser had 60 + 0.12% … 1 dropped of 61.
    const r = meterReading(sample(0, 0, 0, 0), sample(2000, 59.6 * 2, 120, 1, 1990))
    expect(r.fps).toBe(59.6)
    expect(r.droppedPct).toBe(0.8)
    expect(r.decoded).toBe(119)
    expect(r.frameAgeMs).toBe(10)
  })

  it("without frame callbacks the decoded total gives the rate", () => {
    const r = meterReading(sample(0, null, 100, 0), sample(1000, null, 130, 0))
    expect(r.fps).toBe(30)
    expect(r.droppedPct).toBe(0)
  })

  it("a stall shows as no frames and an old last frame; a restarted video gives no rate", () => {
    const stalled = meterReading(sample(0, 300, 300, 0, 0), sample(5000, 300, 300, 0, 0))
    expect(stalled).toMatchObject({ fps: 0, droppedPct: null, frameAgeMs: 5000 })
    expect(meterReading(sample(0, 900, 900, 3), sample(2000, 10, 10, 0)).fps).toBeNull()
    // Samples too close together say nothing yet.
    expect(meterReading(sample(0, 0, 0, 0), sample(100, 3, 3, 0)).fps).toBeNull()
  })

  it("counts presented frames with requestVideoFrameCallback and reads the browser's totals", () => {
    let cb: ((now: number, meta: { presentedFrames?: number }) => void) | null = null
    let total = 0
    const video = {
      requestVideoFrameCallback: (f: typeof cb) => { cb = f; return 1 },
      cancelVideoFrameCallback: () => { cb = null },
      getVideoPlaybackQuality: () => ({ totalVideoFrames: total, droppedVideoFrames: 0 }),
    } as unknown as HTMLVideoElement
    const m = new VideoMeter(video)
    m.read(0)
    for (let i = 1; i <= 30; i++) { total = i; cb!(i * 33, { presentedFrames: i }) }
    const r = m.read(1000)
    expect(r.fps).toBe(30)
    expect(r.decoded).toBe(30)
    m.close()
    expect(cb).toBeNull()
  })
})
