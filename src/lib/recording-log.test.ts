import { describe, expect, it } from "vitest"
import { recordingLogEntries, type RecorderLogStatus } from "./recording-log"

const at = (state: RecorderLogStatus["state"], over: Partial<RecorderLogStatus> = {}): RecorderLogStatus => ({ state, outputId: "overflow", problem: null, sessionId: "s1", ...over })
const name = (id: string) => (id === "overflow" ? "Overflow" : id)
/** The one entry a change gives, or null. */
const one = (...args: Parameters<typeof recordingLogEntries>) => recordingLogEntries(...args)[0] ?? null

describe("the service log follows Rhema's recording (#411)", () => {
  it("logs a start, a stop with its length and dropped frames, from the recorder's own state", () => {
    const seen = new Set<string>()
    expect(one(at("preparing"), at("recording"), name, seen)).toEqual({ phase: "started", label: "Recording started: Overflow" })
    expect(one(at("recording"), at("finalizing"), name, seen)).toBeNull()
    expect(one(at("finalizing"), at("saved", { elapsedMs: 3_600_400, video: { framesDropped: 12 } }), name, seen)).toEqual({ phase: "stopped", label: "Recording stopped after 3600 s · 12 frames dropped" })
    expect(one(at("recording"), at("saved", { elapsedMs: 5_000, video: { framesDropped: 0 } }), name, seen)?.label).toBe("Recording stopped after 5 s")
  })

  it("logs a failure once per recording, with its reason", () => {
    const seen = new Set<string>()
    const failed = at("failed", { problem: { message: "The disk is full." } })
    expect(one(at("recording"), failed, name, seen)).toEqual({ phase: "failed", label: "Recording failed: The disk is full." })
    expect(one(at("idle"), failed, name, seen)).toBeNull()
    expect(one(at("recording", { sessionId: "s2" }), { ...failed, sessionId: "s2" }, name, seen)).not.toBeNull()
  })

  it("a stop whose file needs recovery is a stop, so a later run does not carry it as still recording", () => {
    expect(one(at("finalizing"), at("recoverable", { problem: { message: "Not closed" } }), name, new Set())).toEqual({ phase: "stopped", label: "Recording stopped; its file did not close properly and can be recovered in History (Not closed)" })
  })

  it("a stop and a new start inside one status poll are both logged", () => {
    expect(recordingLogEntries(at("recording", { sessionId: "s1" }), at("recording", { sessionId: "s2" }), name, new Set()).map((e) => e.phase)).toEqual(["stopped", "started"])
  })

  it("claims nothing about the first state it sees, or a state that did not change", () => {
    const seen = new Set<string>()
    expect(one(null, at("recording"), name, seen)).toBeNull()
    expect(one(at("recording"), at("recording"), name, seen)).toBeNull()
  })
})
