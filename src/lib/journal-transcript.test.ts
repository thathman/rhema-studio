import { describe, expect, it } from "vitest"
import type { TranscriptSegment } from "@/types"
import { transcriptSection } from "./journal-transcript"

const seg = (text: string, is_final = true, t = 0): TranscriptSegment => ({ id: text, text, is_final, confidence: 0.9, words: [], timestamp: t })

describe("transcript in a service log (AR-004)", () => {
  it("adds final passages with a heading that says they are unchecked; nothing when there is nothing", () => {
    const s = transcriptSection([seg("Turn with me to John 3:16"), seg("partial", false), seg("  "), seg("For God so loved the world")], "Whisper (on this computer)")
    expect(s).toContain("Transcript (recognised speech by Whisper (on this computer); not checked, may contain mistakes)")
    expect(s).toContain("Turn with me to John 3:16")
    expect(s).not.toContain("partial")
    expect(transcriptSection([seg("x", false)], "Deepgram")).toBe("")
  })

  it("keeps the end of a long transcript and says how much was left out", () => {
    const s = transcriptSection([seg("a".repeat(50)), seg("b".repeat(50)), seg("c".repeat(50))], "Deepgram", 130)
    expect(s).toContain("(1 earlier passage left out for length)")
    expect(s).not.toContain("a".repeat(50))
    expect(s).toContain("c".repeat(50))
  })
})
