import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mediaFileUrl } = vi.hoisted(() => ({ mediaFileUrl: vi.fn<(...args: unknown[]) => Promise<string | null>>() }))
vi.mock("@/stores/media-store", () => ({
  useMediaStore: { getState: () => ({ fileUrl: mediaFileUrl }) },
}))

class FakeAudio {
  static made: FakeAudio[] = []
  static playResult: () => Promise<void> = async () => {}
  static sinkFailure = false
  loop = false
  volume = 1
  sinkId = ""
  currentTime = 0
  duration = 180
  paused = true
  src: string
  listeners: Record<string, Array<() => void>> = {}

  constructor(src: string) { this.src = src; FakeAudio.made.push(this) }
  addEventListener(type: string, listener: () => void) { (this.listeners[type] ??= []).push(listener) }
  emit(type: string) { for (const listener of this.listeners[type] ?? []) listener() }
  async setSinkId(deviceId: string) {
    if (FakeAudio.sinkFailure) throw new Error("NotFoundError")
    this.sinkId = deviceId
  }
  play() { return FakeAudio.playResult().then(() => { this.paused = false }) }
  pause() { this.paused = true }
  removeAttribute(attribute: string) { if (attribute === "src") this.src = "" }
  load() {}
}

vi.stubGlobal("Audio", FakeAudio)

const { useSoundStore } = await import("./sound-store")
const { useJournalStore } = await import("./journal-store")

beforeEach(() => {
  vi.useFakeTimers()
  useSoundStore.getState().stop()
  FakeAudio.made = []
  FakeAudio.playResult = async () => {}
  FakeAudio.sinkFailure = false
  const urls: Record<string, string | null> = { a: "asset://a.mp3", b: "asset://b.mp3", gone: null }
  mediaFileUrl.mockReset().mockImplementation(async (id: unknown) => urls[String(id)] ?? null)
  useJournalStore.setState({ entries: [], startItemIds: null, added: 0, keptAt: 0 })
  useSoundStore.setState({ assetId: null, name: "", playing: false, position: 0, duration: 0, fading: false, error: null, loop: false, volume: 1 })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("sound player", () => {
  it("plays one sound at a time, logs it, and reports a missing file", async () => {
    await useSoundStore.getState().play({ id: "a", name: "Walk-in" })
    await useSoundStore.getState().play({ id: "b", name: "Offering" })
    expect(FakeAudio.made).toHaveLength(2)
    expect(FakeAudio.made[0].paused).toBe(true)
    expect(useSoundStore.getState()).toMatchObject({ assetId: "b", name: "Offering", playing: true })
    expect(useJournalStore.getState().entries.map((entry) => [entry.kind, entry.label])).toEqual([["sound", "Walk-in"], ["sound", "Offering"]])

    const started = await useSoundStore.getState().play({ id: "gone", name: "Old track" })
    expect(started).toBe(false)
    expect(useSoundStore.getState().error).toContain("missing")
    expect(useSoundStore.getState().name).toBe("Offering")
  })

  it("routes an audio cue locally and applies its saved volume, repeat, fades, and rundown id", async () => {
    await useSoundStore.getState().play({
      id: "a", name: "Walk-in", itemId: "cue-walk-in", outputDeviceId: "usb-output",
      volume: 0.4, loop: true, fadeInMs: 100, fadeOutMs: 8000,
    })

    const el = FakeAudio.made[0]
    expect(el.sinkId).toBe("usb-output")
    expect(el.loop).toBe(true)
    expect(el.volume).toBe(0)
    expect(useSoundStore.getState()).toMatchObject({ itemId: "cue-walk-in", volume: 0.4, loop: true, fading: true, fadeDirection: "in", fadeOutMs: 8000, outputNote: null })
    expect(useJournalStore.getState().entries.filter((entry) => entry.kind === "sound")).toMatchObject([{ itemId: "cue-walk-in", label: "Walk-in" }])

    vi.advanceTimersByTime(50)
    expect(el.volume).toBeCloseTo(0.2)
    vi.advanceTimersByTime(50)
    expect(el.volume).toBeCloseTo(0.4)
    expect(useSoundStore.getState()).toMatchObject({ fading: false, fadeDirection: null })
  })

  it("reports when the selected output disappears and falls back to the computer output", async () => {
    FakeAudio.sinkFailure = true
    const started = await useSoundStore.getState().play({ id: "a", name: "Walk-in", outputDeviceId: "usb-output" })

    expect(started).toBe(true)
    expect(useSoundStore.getState().outputNote).toContain("using this computer’s default output")
    expect(FakeAudio.made[0].paused).toBe(false)
  })

  it("fades out the previous cue after a replacement starts", async () => {
    await useSoundStore.getState().play({ id: "a", name: "Walk-in", itemId: "cue-a", volume: 0.8, fadeOutMs: 1000 })
    const previous = FakeAudio.made[0]

    await useSoundStore.getState().play({ id: "b", name: "Offering", itemId: "cue-b", volume: 0.5 })
    const current = FakeAudio.made[1]
    expect(previous.paused).toBe(false)
    expect(current.volume).toBe(0.5)

    vi.advanceTimersByTime(500)
    expect(previous.volume).toBeCloseTo(0.4)
    expect(current.volume).toBe(0.5)
    vi.advanceTimersByTime(500)
    expect(previous.paused).toBe(true)
    expect(current.paused).toBe(false)
    expect(useSoundStore.getState()).toMatchObject({ itemId: "cue-b", playing: true })
  })

  it("keeps the current track and its journal when a replacement cannot start", async () => {
    await useSoundStore.getState().play({ id: "a", name: "Walk-in" })
    FakeAudio.playResult = async () => { throw new Error("NotAllowedError") }

    const started = await useSoundStore.getState().play({ id: "b", name: "Offering" })

    expect(started).toBe(false)
    expect(useSoundStore.getState()).toMatchObject({ assetId: "a", name: "Walk-in", playing: true, error: expect.stringContaining("NotAllowedError") })
    expect(FakeAudio.made[0].paused).toBe(false)
    expect(FakeAudio.made[1].paused).toBe(true)
    expect(useJournalStore.getState().entries.filter((entry) => entry.kind === "sound").map((entry) => entry.label)).toEqual(["Walk-in"])
  })

  it("does not show the replacement as playing or log it before play resolves", async () => {
    let release!: () => void
    FakeAudio.playResult = () => new Promise<void>((resolve) => { release = resolve })

    const pending = useSoundStore.getState().play({ id: "a", name: "Walk-in" })
    await Promise.resolve()
    await Promise.resolve()

    expect(FakeAudio.made).toHaveLength(1)
    expect(useSoundStore.getState()).toMatchObject({ assetId: null, playing: false })
    expect(FakeAudio.made[0].volume).toBe(0)
    expect(useJournalStore.getState().entries).toEqual([])

    release()
    expect(await pending).toBe(true)
    expect(useSoundStore.getState()).toMatchObject({ assetId: "a", name: "Walk-in", playing: true })
    expect(FakeAudio.made[0].volume).toBe(1)
    expect(useJournalStore.getState().entries.filter((entry) => entry.kind === "sound").map((entry) => entry.label)).toEqual(["Walk-in"])
  })

  it("fades out to silence, then stops, keeping the volume setting", async () => {
    useSoundStore.getState().setVolume(0.8)
    await useSoundStore.getState().play({ id: "a", name: "Walk-in" })
    const el = FakeAudio.made.at(-1)!
    useSoundStore.getState().fadeOut(1000)
    vi.advanceTimersByTime(500)
    expect(el.volume).toBeGreaterThan(0.3)
    expect(el.volume).toBeLessThan(0.5)
    vi.advanceTimersByTime(600)
    expect(useSoundStore.getState()).toMatchObject({ playing: false, assetId: null, volume: 0.8 })
    expect(el.paused).toBe(true)
  })

  it("Stop cancels a play still finding its file; Pause during a fade keeps the sound", async () => {
    let release!: (url: string) => void
    mediaFileUrl.mockImplementation((id: unknown) => String(id) === "slow" ? new Promise<string>((resolve) => { release = resolve }) : Promise.resolve("asset://a.mp3"))
    const pending = useSoundStore.getState().play({ id: "slow", name: "Wrong track" })
    useSoundStore.getState().stop()
    release("asset://slow.mp3")
    expect(await pending).toBe(false)
    expect(FakeAudio.made).toHaveLength(0)
    expect(useSoundStore.getState().assetId).toBeNull()

    useSoundStore.getState().setVolume(1)
    await useSoundStore.getState().play({ id: "a", name: "Walk-in" })
    const el = FakeAudio.made.at(-1)!
    useSoundStore.getState().fadeOut(1000)
    vi.advanceTimersByTime(500)
    useSoundStore.getState().pause()
    vi.advanceTimersByTime(2000)
    expect(useSoundStore.getState()).toMatchObject({ assetId: "a", playing: false, fading: false })
    expect(el.volume).toBe(1)
  })
})
