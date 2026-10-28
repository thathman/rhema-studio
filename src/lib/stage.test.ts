import { describe, expect, it } from "vitest"
import { buildStagePayload, stageFontVh } from "./stage"
import { idleTimer, setDuration, start } from "./timer"
import type { VerseQueueItem } from "@/types"

const item = (id: string, ref: string, notes: string | null = null): VerseQueueItem => ({
  id, verse: { id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 3, verse: 16, text: "" }, reference: ref, confidence: 1, source: "manual", added_at: 0, notes,
})

describe("stage payload", () => {
  it("shows the live words, the next item, the operator's note and the timer", () => {
    const items = [item("a", "John 3:16", "read slowly"), item("b", "Amazing Grace"), item("c", "Offering")]
    const timer = start(setDuration(idleTimer(), 10 * 60_000), 0)
    const p = buildStagePayload({ isLive: true, liveVerse: { reference: "John 3:16 (KJV)", segments: [{ verseNumber: 16, text: "For God so loved" }] }, items, activeIndex: 0, timer, now: 60_000 })
    expect(p).toEqual({ current: { title: "John 3:16 (KJV)", lines: ["For God so loved"] }, next: "Amazing Grace", note: "read slowly", timer: { label: "9:00", tone: "ok" }, message: null, band: null })
    expect(buildStagePayload({ isLive: true, liveVerse: null, items, activeIndex: null, timer: idleTimer(), now: 0, song: { key: "G", tempo: 72 } }).band).toBe("Key G · 72 bpm")
    expect(buildStagePayload({ isLive: true, liveVerse: null, items, activeIndex: null, timer: idleTimer(), now: 0, song: { key: "", tempo: null } }).band).toBeNull()
    expect(buildStagePayload({ isLive: false, liveVerse: null, items, activeIndex: null, timer: idleTimer(), now: 0, message: "  wrap up  " }).message).toBe("wrap up")
    // Lyrics come through as lines, both languages.
    const lyric = buildStagePayload({ isLive: true, liveVerse: { kind: "lyric", reference: "Amazing Grace · Verse 1", segments: [], lines: ["Amazing grace", "how sweet"], secondaryLines: ["Oore-ọ̀fẹ́"] }, items, activeIndex: 1, timer: idleTimer(), now: 0 })
    expect(lyric.current?.lines).toEqual(["Amazing grace", "how sweet", "Oore-ọ̀fẹ́"])
    expect(lyric.next).toBe("Offering")
    expect(lyric.timer).toBeNull()
  })

  it("is empty when off air, and names the first item as next before anything is live", () => {
    const p = buildStagePayload({ isLive: false, liveVerse: { reference: "x", segments: [] }, items: [item("a", "Psalm 23")], activeIndex: null, timer: idleTimer(), now: 0 })
    expect(p.current).toBeNull()
    expect(p.next).toBe("Psalm 23")
    expect(buildStagePayload({ isLive: true, liveVerse: null, items: [], activeIndex: null, timer: idleTimer(), now: 0 })).toEqual({ current: null, next: null, note: null, timer: null, message: null, band: null })
  })

  it("shows the next visible item after hidden entries and a disabled phase", () => {
    const items = [item("a", "Live"), item("b", "Hidden one"), item("c", "Hidden two"), item("d", "Skipped phase"), item("e", "Next")]
    items[1].hidden = true
    items[2].hidden = true
    const headers = [
      { id: "main", type: "phase" as const, name: "Main", at: 0, rule: "manual" as const },
      { id: "skip", type: "phase" as const, name: "Disabled", at: 3, rule: "manual" as const, disabled: true },
      { id: "following", type: "phase" as const, name: "Following", at: 4, rule: "manual" as const },
    ]
    const payload = buildStagePayload({ isLive: false, liveVerse: null, items, activeIndex: 0, headers, timer: idleTimer(), now: 0 })

    expect(payload.next).toBe("Next")
  })

  it("distinguishes a cue moment from the next service item", () => {
    const moment = { id: "moment", kind: "cue" as const, reference: "Prayer begins", confidence: 1, source: "manual" as const, added_at: 0 }
    const payload = buildStagePayload({ isLive: false, liveVerse: null, items: [item("a", "Welcome"), moment], activeIndex: 0, timer: idleTimer(), now: 0 })

    expect(payload.next).toBe("Moment · Prayer begins")
  })

  it("stage words get smaller for long lines, not only for many lines", () => {
    expect(stageFontVh(["Amazing grace"])).toBe(9)
    const long = stageFontVh(["For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life. ".repeat(3)])
    expect(long).toBeLessThan(6)
    expect(long).toBeGreaterThanOrEqual(3)
  })
})

