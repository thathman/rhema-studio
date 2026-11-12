import { describe, expect, it, vi } from "vitest"
import { ACK_FALLBACK_MS, ackUrl, afterDrawn, drawnFrames, frameDrawn, frameHeard, type AckClock } from "@/lib/feed-ack"

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

describe("drawn frames across a host restart (TV acks stopped after a restart)", () => {
  /** The page hears a frame, then draws it: whether it acknowledges. */
  const show = (d: ReturnType<typeof drawnFrames>, seq: number) => frameDrawn(d, seq, frameHeard(d, seq), true)

  it("acknowledges a restarted host's frames, numbered from 1 again", () => {
    const d = drawnFrames()
    for (const seq of [1, 2, 3, 4, 5]) expect(show(d, seq)).toBe(true)
    expect(d.seq).toBe(5)
    // The host restarts: its stream opens with frame 0 (off), then counts 1, 2, 4.
    expect(frameHeard(d, 0)).toBe(1)
    expect(d.seq).toBe(0)
    for (const seq of [1, 2, 4]) expect(show(d, seq)).toBe(true)
    expect([d.seq, d.seen, d.run]).toEqual([4, true, 1])
  })

  it("starts a new run when the first frame after the restart is lower, even without frame 0", () => {
    const d = drawnFrames()
    show(d, 7)
    expect(show(d, 1)).toBe(true)
    expect([d.seq, d.run]).toEqual([1, 1])
  })

  it("keeps the run on a reconnect to the same host (its current frame again)", () => {
    const d = drawnFrames()
    show(d, 3)
    expect(show(d, 3)).toBe(true)
    expect(show(d, 4)).toBe(true)
    expect(d.run).toBe(0)
  })

  it("still drops a late acknowledgement of an older frame in the same run", () => {
    const d = drawnFrames()
    const r5 = frameHeard(d, 5)
    const r6 = frameHeard(d, 6)
    expect(frameDrawn(d, 6, r6, true)).toBe(true)
    expect(frameDrawn(d, 5, r5, true)).toBe(false)
    expect(d.seq).toBe(6)
  })

  it("drops an acknowledgement still pending from before the restart", () => {
    const d = drawnFrames()
    show(d, 49)
    const old = frameHeard(d, 50)
    const run = frameHeard(d, 1)
    expect(frameDrawn(d, 1, run, true)).toBe(true)
    // The old frame 50's timer fires late: it must not put back a number the new host never sent.
    expect(frameDrawn(d, 50, old, false)).toBe(false)
    expect([d.seq, d.seen]).toEqual([1, true])
  })
})
