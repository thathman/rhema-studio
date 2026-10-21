import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createVideoPlayer } from "./output-video"

function fakeVideo() {
  const handlers: Record<string, () => void> = {}
  const v = {
    src: "", loop: false, muted: false, crossOrigin: "", playsInline: false, preload: "",
    paused: true, ended: false, readyState: 0, videoWidth: 0, currentTime: 5,
    play: vi.fn(() => { v.paused = false; v.ended = false; return Promise.resolve() }),
    pause: vi.fn(() => { v.paused = true }),
    load: vi.fn(),
    removeAttribute: vi.fn((k: string) => { if (k === "src") v.src = "" }),
    addEventListener: (t: string, f: () => void) => { handlers[t] = f },
  }
  return { v, fire: (t: string) => handlers[t]?.() }
}

const spec = { url: "asset://localhost/m/abc.mp4", fit: "cover" as const, loop: false, sound: true, name: "Countdown", token: 1 }

describe("output window video player", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("plays once per present, redraws only while playing, and releases the file", () => {
    const fake = fakeVideo()
    const onFrame = vi.fn()
    const p = createVideoPlayer({ onFrame, onEnded: vi.fn(), onError: vi.fn(), allowSound: false, fps: () => 25, create: () => fake.v as unknown as HTMLVideoElement })
    p.sync(spec)
    expect(fake.v.src).toBe(spec.url)
    expect(fake.v.crossOrigin).toBe("anonymous")
    expect(fake.v.muted).toBe(true)
    expect(p.state()).toBe("loading")
    fake.fire("playing")
    vi.advanceTimersByTime(200)
    expect(onFrame.mock.calls.length).toBeGreaterThanOrEqual(5)
    fake.v.readyState = 4
    fake.v.videoWidth = 1920
    expect(p.state()).toBe("ready")
    // A re-send of the same live item keeps playing and does not restart.
    p.sync({ ...spec, loop: true })
    expect(fake.v.play).toHaveBeenCalledTimes(1)
    expect(fake.v.loop).toBe(true)
    p.sync(undefined)
    expect(fake.v.pause).toHaveBeenCalled()
    expect(fake.v.src).toBe("")
    onFrame.mockClear()
    vi.advanceTimersByTime(500)
    expect(onFrame).not.toHaveBeenCalled()
  })

  it("after the end, re-sends do not force frames, and presenting again replays from the start", () => {
    const fake = fakeVideo()
    const onFrame = vi.fn()
    const onEnded = vi.fn()
    const p = createVideoPlayer({ onFrame, onEnded, onError: vi.fn(), allowSound: true, fps: () => 30, create: () => fake.v as unknown as HTMLVideoElement })
    p.sync(spec)
    expect(fake.v.muted).toBe(false)
    fake.fire("playing")
    fake.v.ended = true
    fake.v.paused = true
    fake.fire("ended")
    expect(onEnded).toHaveBeenCalledTimes(1)
    onFrame.mockClear()
    p.sync(spec) // theme edit / output-ready re-sync
    vi.advanceTimersByTime(300)
    expect(onFrame).not.toHaveBeenCalled()
    expect(fake.v.play).toHaveBeenCalledTimes(1)
    p.sync({ ...spec, token: 2 }) // presented again
    expect(fake.v.play).toHaveBeenCalledTimes(2)
    expect(fake.v.currentTime).toBe(0)
  })

  it("reports a failure by name and stays failed until the next present", () => {
    const fake = fakeVideo()
    const onError = vi.fn()
    const p = createVideoPlayer({ onFrame: vi.fn(), onEnded: vi.fn(), onError, allowSound: true, fps: () => 30, create: () => fake.v as unknown as HTMLVideoElement })
    p.sync(spec)
    fake.fire("error")
    expect(onError).toHaveBeenCalledWith("Countdown")
    expect(p.state()).toBe("failed")
    p.sync({ ...spec, token: 2, url: "asset://localhost/m/other.mp4" })
    expect(p.state()).toBe("loading")
  })
})
