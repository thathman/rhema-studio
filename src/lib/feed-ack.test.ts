import { describe, expect, it, vi } from "vitest"
import { ACK_FALLBACK_MS, afterDrawn, type AckClock } from "@/lib/feed-ack"

function fakeClock(hidden: boolean) {
  const frames: (() => void)[] = []
  const timers: { fn: () => void; ms: number }[] = []
  const clock: AckClock = {
    hidden: () => hidden,
    frame: (fn) => { frames.push(fn) },
    timer: (fn, ms) => { timers.push({ fn, ms }) },
  }
  return { clock, frames, timers }
}

describe("afterDrawn (#844 S20)", () => {
  it("a visible page acknowledges on its next animation frame, once", () => {
    const { clock, frames, timers } = fakeClock(false)
    const done = vi.fn()
    afterDrawn(done, clock)
    expect(done).not.toHaveBeenCalled()
    frames[0]()
    expect(done).toHaveBeenCalledTimes(1)
    // The fallback timer that follows does not send it again.
    expect(timers.map((t) => t.ms)).toEqual([ACK_FALLBACK_MS])
    timers[0].fn()
    expect(done).toHaveBeenCalledTimes(1)
  })

  it("a hidden page (an OBS source not in the scene) acknowledges by timer, without animation frames", () => {
    const { clock, frames, timers } = fakeClock(true)
    const done = vi.fn()
    afterDrawn(done, clock)
    expect(frames).toEqual([])
    expect(timers.map((t) => t.ms)).toEqual([0])
    timers[0].fn()
    expect(done).toHaveBeenCalledTimes(1)
  })

  it("a page that says it is visible but gets no frames still acknowledges after the fallback", () => {
    const { clock, timers } = fakeClock(false)
    const done = vi.fn()
    afterDrawn(done, clock)
    timers[0].fn()
    expect(done).toHaveBeenCalledTimes(1)
  })
})
