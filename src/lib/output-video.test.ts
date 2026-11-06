import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createVideoPlayer, videoPosition } from "./output-video"

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

  it("Pause holds the frame (drawn once), Resume carries on from there, and a re-send keeps it paused (#36)", () => {
    const fake = fakeVideo()
    const onFrame = vi.fn()
    const onPaused = vi.fn()
    const p = createVideoPlayer({ onFrame, onEnded: vi.fn(), onPaused, onError: vi.fn(), allowSound: true, fps: () => 30, create: () => fake.v as unknown as HTMLVideoElement })
    p.sync(spec)
    fake.fire("playing")
    vi.advanceTimersByTime(100)
    fake.v.currentTime = 12
    p.sync({ ...spec, paused: true })
    expect(fake.v.pause).toHaveBeenCalledTimes(1)
    expect(onPaused).toHaveBeenCalledTimes(1)
    onFrame.mockClear()
    vi.advanceTimersByTime(500)
    expect(onFrame).not.toHaveBeenCalled()
    // A theme edit re-sends the same paused item: nothing moves, nothing restarts.
    p.sync({ ...spec, paused: true })
    vi.advanceTimersByTime(300)
    expect(onFrame).not.toHaveBeenCalled()
    expect(fake.v.play).toHaveBeenCalledTimes(1)
    // Resume: from where it stopped, never from the start.
    p.sync(spec)
    expect(fake.v.play).toHaveBeenCalledTimes(2)
    expect(fake.v.currentTime).toBe(12)
    fake.fire("playing")
    vi.advanceTimersByTime(100)
    expect(onFrame).toHaveBeenCalled()
  })

  it("a paused video put back waits on its first frame for Resume", () => {
    const fake = fakeVideo()
    const onPaused = vi.fn()
    const p = createVideoPlayer({ onFrame: vi.fn(), onEnded: vi.fn(), onPaused, onError: vi.fn(), allowSound: true, fps: () => 30, create: () => fake.v as unknown as HTMLVideoElement })
    p.sync({ ...spec, paused: true })
    expect(fake.v.src).toBe(spec.url)
    expect(fake.v.play).not.toHaveBeenCalled()
    fake.fire("loadeddata")
    expect(onPaused).toHaveBeenCalledTimes(1)
    p.sync(spec)
    expect(fake.v.play).toHaveBeenCalledTimes(1)
  })

  it("a window loading a video late (Black then Back, a reopened window) carries on where it is, not from 0:00 (#411)", () => {
    vi.setSystemTime(100_000)
    const fake = fakeVideo()
    const p = createVideoPlayer({ onFrame: vi.fn(), onEnded: vi.fn(), onError: vi.fn(), allowSound: true, fps: () => 30, create: () => fake.v as unknown as HTMLVideoElement })
    // Started 42 s ago: the fresh window seeks there once it knows the length.
    p.sync({ ...spec, startedAt: 58_000 })
    Object.assign(fake.v, { duration: 120 })
    fake.fire("loadedmetadata")
    expect(fake.v.currentTime).toBeCloseTo(42)
    // Looping, past its length: where it is in this round.
    const loopFake = fakeVideo()
    const q = createVideoPlayer({ onFrame: vi.fn(), onEnded: vi.fn(), onError: vi.fn(), allowSound: true, fps: () => 30, create: () => loopFake.v as unknown as HTMLVideoElement })
    q.sync({ ...spec, token: 2, loop: true, startedAt: 100_000 - 130_000 })
    Object.assign(loopFake.v, { duration: 60 })
    loopFake.fire("loadedmetadata")
    expect(loopFake.v.currentTime).toBeCloseTo(10)
  })

  it("where a video is: from its start, or the frame it was paused on; a fresh present starts at 0", () => {
    expect(videoPosition({ startedAt: 1_000 }, 31_000)).toBe(30)
    expect(videoPosition({ startedAt: 1_000, paused: true, heldAt: 11_000 }, 99_000)).toBe(10)
    expect(videoPosition({}, 99_000)).toBe(0)
  })
})
