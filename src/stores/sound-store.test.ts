import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => `asset://${p}` }))

class FakeAudio {
  static made: FakeAudio[] = []
  loop = false
  volume = 1
  currentTime = 0
  duration = 180
  paused = true
  listeners: Record<string, Array<() => void>> = {}
  src: string
  constructor(src: string) { this.src = src; FakeAudio.made.push(this) }
  addEventListener(t: string, f: () => void) { (this.listeners[t] ??= []).push(f) }
  emit(t: string) { for (const f of this.listeners[t] ?? []) f() }
  play() { this.paused = false; return Promise.resolve() }
  pause() { this.paused = true }
  removeAttribute() {}
  load() {}
}

beforeEach(() => {
  FakeAudio.made = []
  vi.stubGlobal("Audio", FakeAudio)
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("sound player", () => {
  it("plays one sound at a time, logs it, and a missing file is reported", async () => {
    const { useMediaStore } = await import("@/stores/media-store")
    const { useSoundStore } = await import("@/stores/sound-store")
    const { useJournalStore } = await import("@/stores/journal-store")
    useJournalStore.setState({ entries: [] })
    const urls: Record<string, string | null> = { a: "asset://a.mp3", b: "asset://b.mp3", gone: null }
    useMediaStore.setState({ fileUrl: async (id: string) => urls[id] ?? null } as never)

    await useSoundStore.getState().play({ id: "a", name: "Walk-in" })
    await useSoundStore.getState().play({ id: "b", name: "Offering" })
    expect(FakeAudio.made).toHaveLength(2)
    expect(FakeAudio.made[0].paused).toBe(true)
    expect(useSoundStore.getState()).toMatchObject({ assetId: "b", name: "Offering", playing: true })
    expect(useJournalStore.getState().entries.map((e) => [e.kind, e.label])).toEqual([["sound", "Walk-in"], ["sound", "Offering"]])

    await useSoundStore.getState().play({ id: "gone", name: "Old track" })
    expect(useSoundStore.getState().error).toContain("missing")
    expect(useSoundStore.getState().name).toBe("Offering")
  })

  it("fades out to silence, then stops, keeping the volume setting", async () => {
    const { useMediaStore } = await import("@/stores/media-store")
    const { useSoundStore } = await import("@/stores/sound-store")
    useMediaStore.setState({ fileUrl: async () => "asset://a.mp3" } as never)
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
    const { useMediaStore } = await import("@/stores/media-store")
    const { useSoundStore } = await import("@/stores/sound-store")
    let release!: (u: string) => void
    useMediaStore.setState({ fileUrl: () => new Promise<string>((r) => { release = r }) } as never)
    const pending = useSoundStore.getState().play({ id: "slow", name: "Wrong track" })
    useSoundStore.getState().stop()
    release("asset://slow.mp3")
    await pending
    expect(FakeAudio.made).toHaveLength(0)
    expect(useSoundStore.getState().assetId).toBeNull()

    useMediaStore.setState({ fileUrl: async () => "asset://a.mp3" } as never)
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
