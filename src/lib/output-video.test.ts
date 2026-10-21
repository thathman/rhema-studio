import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createVideoPlayer } from "./output-video"

function fakeVideo() {
  const handlers: Record<string, () => void> = {}
  const v = {
    src: "", loop: false, muted: false, crossOrigin: "", playsInline: false, preload: "",
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    load: vi.fn(),
    removeAttribute: vi.fn((k: string) => { if (k === "src") v.src = "" }),
    addEventListener: (t: string, f: () => void) => { handlers[t] = f },
  }
  return { v, fire: (t: string) => handlers[t]?.() }
}

const spec = { url: "asset://localhost/m/abc.mp4", fit: "cover" as const, loop: false, sound: true, name: "Countdown" }

describe("output window video player", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("plays once per url, redraws while playing, mutes away from the main output, and releases the file", () => {
    const fake = fakeVideo()
    const onFrame = vi.fn()
    const p = createVideoPlayer({ onFrame, onEnded: vi.fn(), onError: vi.fn(), allowSound: false, fps: () => 25, create: () => fake.v as unknown as HTMLVideoElement })
    p.sync(spec)
    expect(fake.v.src).toBe(spec.url)
    expect(fake.v.crossOrigin).toBe("anonymous")
    expect(fake.v.muted).toBe(true)
    expect(fake.v.play).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(200)
    expect(onFrame).toHaveBeenCalledTimes(5)
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

  it("plays sound only where allowed, stops redrawing at the end, and reports errors by name", () => {
    const fake = fakeVideo()
    const onFrame = vi.fn()
    const onEnded = vi.fn()
    const onError = vi.fn()
    const p = createVideoPlayer({ onFrame, onEnded, onError, allowSound: true, fps: () => 30, create: () => fake.v as unknown as HTMLVideoElement })
    p.sync(spec)
    expect(fake.v.muted).toBe(false)
    p.sync({ ...spec, sound: false })
    expect(fake.v.muted).toBe(true)
    fake.fire("ended")
    expect(onEnded).toHaveBeenCalledTimes(1)
    onFrame.mockClear()
    vi.advanceTimersByTime(300)
    expect(onFrame).not.toHaveBeenCalled()
    fake.fire("error")
    expect(onError).toHaveBeenCalledWith("Countdown")
  })
})
