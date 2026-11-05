import { describe, expect, it, vi } from "vitest"
import { LISTEN_START_VOLUME, listenReadiness, startListening } from "./audition"

const ready = { supported: true, deviceId: "hp", label: "Desk headphones", confirmed: true, present: true }

describe("Library Listen only on a private, confirmed output (#447)", () => {
  it("is off, saying why, unless every condition holds", () => {
    expect(listenReadiness(ready)).toEqual({ ok: true, target: "Desk headphones" })
    expect(listenReadiness({ ...ready, supported: false })).toMatchObject({ ok: false, reason: expect.stringContaining("never plays on the default output") })
    expect(listenReadiness({ ...ready, deviceId: "" })).toMatchObject({ ok: false, reason: expect.stringContaining("Choose a private listening output") })
    expect(listenReadiness({ ...ready, confirmed: false })).toMatchObject({ ok: false, reason: expect.stringContaining("is not connected to the PA") })
    expect(listenReadiness({ ...ready, present: false })).toMatchObject({ ok: false, reason: expect.stringContaining("not connected now") })
  })

  it("sets the output before loading the file, starts quietly, and Stop tears it down", async () => {
    const calls: string[] = []
    const el = {
      volume: 1, src: "",
      setSinkId: vi.fn(async (id: string) => { calls.push(`sink:${id}`) }),
      play: vi.fn(async () => { calls.push(`play:${el.src}`) }),
      pause: vi.fn(() => calls.push("pause")),
      removeAttribute: vi.fn(() => { el.src = "" }), load: vi.fn(),
    }
    const listening = await startListening("asset://walk-in.mp3", "hp", undefined, () => el as unknown as HTMLAudioElement)
    expect(calls).toEqual(["sink:hp", "play:asset://walk-in.mp3"])
    expect(el.volume).toBe(LISTEN_START_VOLUME)
    listening.stop()
    expect(el.pause).toHaveBeenCalled()
    expect(el.src).toBe("")
    listening.stop() // twice is fine
  })

  it("plays nothing when the output cannot be set, when none is chosen, or the app cannot choose one", async () => {
    const play = vi.fn(async () => {})
    const refusing = { setSinkId: vi.fn(async () => { throw new Error("NotFoundError") }), play, pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn(), volume: 1, src: "" }
    await expect(startListening("x.mp3", "gone", 0.3, () => refusing as unknown as HTMLAudioElement)).rejects.toThrow("NotFoundError")
    await expect(startListening("x.mp3", "", 0.3, () => refusing as unknown as HTMLAudioElement)).rejects.toThrow("No private listening output")
    const noSink = { play, pause: vi.fn(), volume: 1, src: "" }
    await expect(startListening("x.mp3", "hp", 0.3, () => noSink as unknown as HTMLAudioElement)).rejects.toThrow("cannot send a sound to a chosen output")
    expect(play).not.toHaveBeenCalled()
  })
})
