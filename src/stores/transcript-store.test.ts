import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

const { MAX_TRANSCRIPT_CHARS, useTranscriptStore } = await import("@/stores/transcript-store")
const { startNewJournal } = await import("@/stores/journal-store")

const passage = (id: string, text: string) => ({ id, text, is_final: true, confidence: 1, timestamp: 0 }) as never

describe("the transcript stays bounded and belongs to one log (#411 listening hunt)", () => {
  it("drops the oldest passages past the limit, keeping the newest", () => {
    useTranscriptStore.getState().clearTranscript()
    const big = "x".repeat(MAX_TRANSCRIPT_CHARS / 2)
    useTranscriptStore.getState().addSegment(passage("a", big))
    useTranscriptStore.getState().addSegment(passage("b", big))
    useTranscriptStore.getState().addSegment(passage("c", "the newest"))
    const s = useTranscriptStore.getState()
    expect(s.segments.map((x) => x.id)).toEqual(["b", "c"])
    expect(s.chars).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHARS)
  })

  it("a new log starts with an empty transcript", async () => {
    useTranscriptStore.getState().addSegment(passage("morning", "said this morning"))
    await startNewJournal()
    expect(useTranscriptStore.getState().segments).toEqual([])
  })
})
