import { describe, expect, it } from "vitest"
import { bitrateWords, durationWords, levelWords, meterFill, meterLevels, obsInputList, obsOutput, obsStats, recordWords, statsWords, streamWords } from "./obs-status"

describe("OBS's stream, recording and inputs as it reports them (#197, #213)", () => {
  it("reads a live stream with its duration, dropped frames and a bitrate from two readings", () => {
    const first = obsOutput({ outputActive: true, outputDuration: 61_000, outputBytes: 1_000_000, outputSkippedFrames: 3, outputTotalFrames: 3600 }, null, 1000)
    expect(first.kbps).toBeNull()
    const next = obsOutput({ outputActive: true, outputDuration: 63_000, outputBytes: 1_750_000, outputSkippedFrames: 3, outputTotalFrames: 3720 }, { bytes: 1_000_000, at: 1000 }, 3000)
    expect(next.kbps).toBe(3000)
    expect(streamWords(next)).toEqual({ text: "Live for 1:03 · 3.0 Mbit/s · 3 of 3,720 frames dropped (<0.1%)", tone: "live" })
  })

  it("never makes up figures OBS did not send, and warns on many dropped frames or a reconnect", () => {
    expect(streamWords(null).text).toBe("Not reported")
    expect(streamWords(obsOutput({ outputActive: false }, null, 0))).toEqual({ text: "Not streaming", tone: "off" })
    expect(streamWords(obsOutput({ outputActive: true }, null, 0)).text).toBe("Live")
    expect(streamWords(obsOutput({ outputActive: true, outputReconnecting: true }, null, 0)).tone).toBe("warn")
    expect(streamWords(obsOutput({ outputActive: true, outputSkippedFrames: 100, outputTotalFrames: 1000 }, null, 0)).tone).toBe("warn")
    // A counter that went back (OBS restarted the output) gives no bitrate rather than a negative one.
    expect(obsOutput({ outputActive: true, outputBytes: 10 }, { bytes: 500, at: 0 }, 1000).kbps).toBeNull()
  })

  it("says recording or paused with the time", () => {
    expect(recordWords(obsOutput({ outputActive: true, outputDuration: 3_725_000 }, null, 0)).text).toBe("Recording at 1:02:05")
    expect(recordWords(obsOutput({ outputActive: true, outputPaused: true, outputTimecode: "00:10:00.000" }, null, 0))).toEqual({ text: "Paused at 00:10:00", tone: "warn" })
    expect(recordWords(obsOutput({ outputActive: false }, null, 0)).text).toBe("Not recording")
  })

  it("reads OBS's render figures", () => {
    expect(statsWords(obsStats({ activeFps: 29.97, cpuUsage: 12.4, renderSkippedFrames: 0, renderTotalFrames: 900, outputSkippedFrames: 50, outputTotalFrames: 900 }))).toEqual({ text: "30 fps · CPU 12% · 0 frames missed rendering · 50 missed encoding", tone: "warn" })
    expect(statsWords(obsStats({})).text).toBe("Not reported")
  })

  it("reads inputs and the loudest channel of each meter", () => {
    expect(obsInputList([{ inputName: "Mic", inputKind: "coreaudio_input_capture", unversionedInputKind: "coreaudio_input_capture" }, { nope: 1 }])).toEqual([{ name: "Mic", kind: "coreaudio_input_capture" }])
    const levels = meterLevels({ inputs: [{ inputName: "Mic", inputLevelsMul: [[0.1, 0.5, 0.5], [0.1, 0.25, 0.25]] }, { inputName: "Off", inputLevelsMul: [[0, 0, 0]] }] })
    expect(levels.Mic).toBeCloseTo(-6.02, 1)
    expect(levels.Off).toBe(-Infinity)
    expect(levelWords({ name: "Mic", kind: "", muted: false, levelDb: levels.Mic })).toBe("On · -6 dBFS")
    expect(levelWords({ name: "Mic", kind: "", muted: true, levelDb: -6 })).toBe("Muted")
    expect(levelWords({ name: "Off", kind: "", muted: false, levelDb: -Infinity })).toBe("On · silent")
    expect(levelWords({ name: "Cam", kind: "", muted: null, levelDb: null })).toBe("")
    expect(meterFill(-30)).toBe(0.5)
    expect(meterFill(null)).toBe(0)
  })

  it("formats durations and bitrates", () => {
    expect(durationWords(59_999)).toBe("0:59")
    expect(durationWords(3_600_000)).toBe("1:00:00")
    expect(bitrateWords(800)).toBe("800 kbit/s")
    expect(bitrateWords(6000)).toBe("6.0 Mbit/s")
  })
})
