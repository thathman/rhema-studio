import { describe, expect, it, vi } from "vitest"

const invoke = vi.hoisted(() => vi.fn(async () => 2))
vi.mock("@tauri-apps/api/core", () => ({ invoke }))

import type { TranscriptSegment } from "@/types"
import { useSettingsStore } from "@/stores/settings-store"
import { removeOldTranscripts, retentionWords, transcriptSection } from "./journal-transcript"

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

  it("counts bytes, not letters, so Yorùbá text stays within the log limit", () => {
    const yo = "Ọlọ́run fẹ́ aráyé tóbẹ́ẹ̀".repeat(3)
    const s = transcriptSection([seg(yo), seg(yo), seg(yo)], "Whisper", (new TextEncoder().encode(yo).length + 30) * 2)
    expect(s).toContain("(1 earlier passage left out for length)")
  })
})

describe("transcript retention (#246 C17)", () => {
  it("the church's choice removes older transcripts from kept logs; until deleted asks nothing", async () => {
    expect(await removeOldTranscripts(0)).toBe(0)
    expect(invoke).not.toHaveBeenCalled()
    expect(await removeOldTranscripts(30)).toBe(2)
    expect(invoke).toHaveBeenCalledWith("content_remove_old_log_transcripts", { days: 30 })
    // The section the content crate looks for starts as transcriptSection writes it.
    expect(transcriptSection([seg("Amen")], "Whisper")).toContain("\nTranscript (recognised speech by ")
  })

  it("only the offered choices are kept, and each reads plainly", () => {
    useSettingsStore.getState().setTranscriptRetentionDays(90)
    expect(useSettingsStore.getState().transcriptRetentionDays).toBe(90)
    useSettingsStore.getState().setTranscriptRetentionDays(7)
    expect(useSettingsStore.getState().transcriptRetentionDays).toBe(0)
    expect([0, 30, 365].map(retentionWords)).toEqual(["until the log is deleted", "for 30 days", "for a year"])
  })
})
