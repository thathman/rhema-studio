import { describe, expect, it, vi } from "vitest"
import type { ProgramItem, ProgramWithItems, SongQueueItem, VerseQueueItem } from "@/types"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }))

import { parseSongPayload, rundownSignature, toItemInputs, toQueueItems } from "./service-store"

const program = { id: "p1", title: "Sunday", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 2 }
const stored = (id: string, extra: Partial<ProgramItem>): ProgramItem => ({
  id, program_id: "p1", position: 0, kind: "verse", reference: "", book_number: null, chapter: null, verse: null,
  translation: null, secondary_translation: null, notes: null, payload: null, ...extra,
})
const songItem: SongQueueItem = {
  id: "s1", kind: "song", song: { song_id: "song-1", title: "Amazing Grace", arrangement_id: "a1", languages: ["en", "yo"] },
  reference: "Amazing Grace", confidence: 1, source: "manual", added_at: 0, notes: "Opening hymn",
}
const verseItem: VerseQueueItem = {
  id: "v1", verse: { id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 3, verse: 16, text: "" },
  reference: "John 3:16", confidence: 1, source: "manual", added_at: 0,
}

describe("song items in a saved service", () => {
  it("round-trips the payload through save and open", () => {
    const out = toItemInputs([verseItem, songItem], () => "KJV")
    expect(out[1]).toEqual({
      id: "s1", kind: "song", reference: "Amazing Grace", book_number: null, chapter: null, verse: null,
      translation: null, secondary_translation: null, notes: "Opening hymn",
      payload: JSON.stringify({ song_id: "song-1", arrangement_id: "a1", languages: ["en", "yo"] }),
    })
    const data: ProgramWithItems = {
      program,
      items: [
        stored("v1", { reference: "John 3:16", book_number: 43, chapter: 3, verse: 16 }),
        stored("s1", { kind: "song", reference: "Amazing Grace", notes: "Opening hymn", payload: out[1].payload }),
      ],
    }
    const { items, unsupported } = toQueueItems(data, 1, [])
    expect(unsupported).toEqual([])
    expect(items[1]).toMatchObject({ id: "s1", kind: "song", reference: "Amazing Grace", notes: "Opening hymn", song: songItem.song })
    expect(rundownSignature(items)).toBe(rundownSignature([verseItem, songItem]))
  })

  it("sets aside a song item whose payload is unreadable instead of dropping it", () => {
    const data: ProgramWithItems = {
      program,
      items: [stored("bad", { kind: "song", reference: "???", payload: "{not json" }), stored("none", { kind: "song", reference: "x", payload: null })],
    }
    const { items, unsupported } = toQueueItems(data, 1, [])
    expect(items).toEqual([])
    expect(unsupported.map((u) => u.id)).toEqual(["bad", "none"])
    expect(parseSongPayload('{"song_id":""}')).toBeNull()
    expect(parseSongPayload('{"song_id":"x","languages":["en",3]}')).toEqual({ song_id: "x", arrangement_id: null, languages: ["en"] })
  })

  it("signature changes when the arrangement or languages change", () => {
    const base = rundownSignature([songItem])
    expect(rundownSignature([{ ...songItem, song: { ...songItem.song, arrangement_id: "a2" } }])).not.toBe(base)
    expect(rundownSignature([{ ...songItem, song: { ...songItem.song, languages: ["en"] } }])).not.toBe(base)
    expect(rundownSignature([{ ...songItem, added_at: 99 }])).toBe(base)
  })
})
