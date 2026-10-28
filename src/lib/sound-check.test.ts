import { afterEach, describe, expect, it, vi } from "vitest"
import { CLAP_DBFS, clapWords, peakDbfs, startTestTone, toneGain } from "./sound-check"

class FakeParam {
  value = 0
  setValueAtTime(v: number) { this.value = v }
  linearRampToValueAtTime(v: number) { this.value = v }
}
const made: { osc: { frequency: FakeParam; type: string; started: boolean; stopped: boolean }; gain: { gain: FakeParam } }[] = []
class FakeContext {
  currentTime = 0
  destination = {}
  sink: string | null = null
  closed = false
  async resume() {}
  async close() { this.closed = true }
  async setSinkId(id: string) { this.sink = id }
  createOscillator() {
    const osc = { frequency: new FakeParam(), type: "", started: false, stopped: false, connect: (n: unknown) => n, start() { this.started = true }, stop() { this.stopped = true } }
    made.push({ osc, gain: null as never })
    return osc
  }
  createGain() {
    const g = { gain: new FakeParam(), connect: (n: unknown) => n }
    made[made.length - 1].gain = g
    return g
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  made.length = 0
})

describe("sound checks (#213)", () => {
  it("plays a 1 kHz sine at −18 dBFS on the chosen output until stopped", async () => {
    vi.stubGlobal("AudioContext", FakeContext)
    const t = await startTestTone("usb-desk")
    expect(t.where).toBe("chosen")
    const { osc, gain } = made[0]
    expect([osc.type, osc.frequency.value, osc.started]).toEqual(["sine", 1000, true])
    expect(gain.gain.value).toBeCloseTo(0.1259, 4)
    expect(20 * Math.log10(toneGain())).toBeCloseTo(-18, 6)
    t.stop()
    expect(osc.stopped).toBe(true)
  })

  it("says it plays on the system's output when none is chosen", async () => {
    vi.stubGlobal("AudioContext", FakeContext)
    expect((await startTestTone("")).where).toBe("system")
  })

  it("measures a clap's peak and words the result", () => {
    expect(peakDbfs(new Float32Array([0, 0.5, -1]))).toBe(0)
    expect(peakDbfs(new Float32Array(8))).toBe(-Infinity)
    expect(clapWords({ heard: true, peakDb: -12.4 })).toBe("Heard the clap (loudest -12 dBFS). The microphone works.")
    expect(clapWords({ heard: false, peakDb: -Infinity })).toContain("Nothing loud enough heard (silence)")
    expect(CLAP_DBFS).toBe(-30)
  })
})
