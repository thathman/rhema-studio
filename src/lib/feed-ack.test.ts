import { describe, expect, it, vi } from "vitest"
import { ACK_FALLBACK_MS, ackUrl, afterDrawn, type AckClock } from "@/lib/feed-ack"

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

describe("afterDrawn (#844 S20, never a false 'on screen')", () => {
  it("a visible page says seen on its next animation frame, once", () => {
    const { clock, frames, timers } = fakeClock(false)
    const done = vi.fn()
    afterDrawn(done, clock)
    expect(done).not.toHaveBeenCalled()
    frames[0]()
    expect(done.mock.calls).toEqual([[true]])
    // The fallback timer after it sends nothing more.
    expect(timers.map((t) => t.ms)).toEqual([ACK_FALLBACK_MS])
    timers[0].fn()
    expect(done.mock.calls).toEqual([[true]])
  })

  it("a hidden page (an OBS source off the scene, a TV after Home) acknowledges by timer, marked not seen", () => {
    const { clock, timers } = fakeClock(true)
    const done = vi.fn()
    afterDrawn(done, clock)
    expect(timers.map((t) => t.ms)).toEqual([0])
    timers[0].fn()
    expect(done.mock.calls).toEqual([[false]])
  })

  it("a page that says it is visible but gets no frames: the timer's acknowledgement is not seen either", () => {
    const { clock, timers } = fakeClock(false)
    const done = vi.fn()
    afterDrawn(done, clock)
    timers[0].fn()
    expect(done.mock.calls).toEqual([[false]])
  })

  it("shown again after the timer: the animation frame then says seen", () => {
    const { clock, frames, timers } = fakeClock(true)
    const done = vi.fn()
    afterDrawn(done, clock)
    timers[0].fn()
    frames[0]()
    expect(done.mock.calls).toEqual([[false], [true]])
  })

  it("marks a not-seen acknowledgement in its address (the Receiver reads only addresses)", () => {
    expect(ackUrl("l3", "s3cr+t", true)).toBe("/api/v1/feed/l3/ack?k=s3cr%2Bt")
    expect(ackUrl("l3", "s3cr+t", false)).toBe("/api/v1/feed/l3/ack?k=s3cr%2Bt&hidden=1")
  })
})
