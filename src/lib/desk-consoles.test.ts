import { describe, expect, it } from "vitest"
import { chorusesOf, chorusTarget, sectionsOf, upcomingGraphicsQueue } from "@/lib/desk-consoles"
import { crewWords, passageFrom } from "@/lib/desk-console-words"
import type { OutlineHeader } from "@/lib/run-of-show"
import type { QueueItem } from "@/types"

const slide = (sectionId: string, sectionLabel: string) => ({ sectionId, sectionLabel })

describe("desk consoles (#197)", () => {
  it("projects event-linked visual moments in service order with planned targets and truthful timing state", () => {
    const item = (id: string, kind: string, extra: Partial<QueueItem> = {}) => ({
      id, kind, reference: id, confidence: 1, source: "manual", added_at: 0,
      ...(kind === "slide" ? { slide: { title: id, body: "" } } : {}),
      ...(kind === "image" ? { image: { media_id: id, name: id, fit: "contain" as const } } : {}),
      ...(kind === "song" ? { song: { song_id: id, title: id, arrangement_id: null, languages: [] } } : {}),
      ...extra,
    }) as QueueItem
    const items = [
      item("welcome", "slide", { on_take: ["scene.take:welcome@main"] }),
      item("audio", "audio"),
      item("scripture", "verse", { on_take: ["scene.take:reading@overflow"] }),
      item("announcement", "slide"),
      item("logo", "image"),
      item("song", "song"),
    ]
    const headers: OutlineHeader[] = [
      { id: "welcome-event", type: "group", name: "Welcome", at: 0, event: { schema_version: 1 } },
      { id: "sermon-event", type: "group", name: "Sermon", at: 2, event: { schema_version: 1 } },
    ]
    const projected = upcomingGraphicsQueue({
      items,
      headers,
      outputs: [{ id: "main", name: "Sanctuary" }, { id: "overflow", name: "Overflow" }],
      service: { revision: 4, approved_revision: 4 },
      dirty: false,
      currentEventId: "sermon-event",
      currentMomentId: "scripture",
      eventStates: { "welcome-event": "done", "sermon-event": "live" },
    })

    expect(projected.planState).toBe("approved")
    expect(projected.items.map((row) => [row.id, row.eventTitle, row.kind, row.state, row.destinations])).toEqual([
      ["welcome", "Welcome", "Slide", "Completed", ["Sanctuary"]],
      ["scripture", "Sermon", "Scripture", "Current moment", ["Overflow"]],
      ["announcement", "Sermon", "Slide", "Upcoming", ["Per output source settings"]],
      ["logo", "Sermon", "Image", "Upcoming", ["Per output source settings"]],
      ["song", "Sermon", "Song", "Upcoming", ["Per output source settings"]],
    ])
  })

  it("marks changed or unapproved services and keeps unsupported moments out of the graphics list", () => {
    const slide = { id: "s", kind: "slide", slide: { title: "s", body: "" }, reference: "s", confidence: 1, source: "manual", added_at: 0 } as QueueItem
    const audio = { id: "a", kind: "audio", audio: { media_id: "a", name: "a" }, reference: "a", confidence: 1, source: "manual", added_at: 0 } as QueueItem
    const headers: OutlineHeader[] = [{ id: "event", type: "group", name: "Event", at: 0, event: { schema_version: 1 } }]
    const base = { items: [slide, audio], headers, outputs: [], currentEventId: null, currentMomentId: null, eventStates: {} }
    expect(upcomingGraphicsQueue({ ...base, service: { revision: 5, approved_revision: 4 }, dirty: false }).planState).toBe("changed")
    expect(upcomingGraphicsQueue({ ...base, service: null, dirty: true }).planState).toBe("draft")
    expect(upcomingGraphicsQueue({ ...base, service: { revision: 5, approved_revision: 5 }, dirty: true }).planState).toBe("changed")
    expect(upcomingGraphicsQueue({ ...base, service: null, dirty: false }).items.map((row) => row.id)).toEqual(["s"])
  })

  it("a song's sections follow its slides: a long verse is one section, a chorus sung twice is two", () => {
    const slides = [slide("v1", "Verse 1"), slide("v1", "Verse 1"), slide("c", "Chorus"), slide("v2", "Verse 2"), slide("c", "Chorus")]
    expect(sectionsOf(slides, 0)).toEqual({ starts: [0, 2, 3, 4], labels: ["Verse 1", "Chorus", "Verse 2", "Chorus"], ids: ["v1", "c", "v2", "c"], at: 0 })
    expect(sectionsOf(slides, 1).at).toBe(0)
    expect(sectionsOf(slides, 2).at).toBe(1)
    expect(sectionsOf(slides, 4).at).toBe(3)
    expect(sectionsOf([], 0)).toEqual({ starts: [], labels: [], ids: [], at: 0 })
  })

  it("repeat chorus goes to the last chorus sung, else the song's first; none without a chorus", () => {
    const song = { sections: [{ id: "v1", kind: "verse" }, { id: "c", kind: "chorus" }, { id: "v2", kind: "verse" }] } as never
    const choruses = chorusesOf(song, ["v1", "c", "v2", "c"])
    expect(choruses).toEqual([1, 3])
    expect(chorusTarget(choruses, 2)).toBe(1)
    expect(chorusTarget(choruses, 3)).toBe(3)
    expect(chorusTarget(choruses, 0)).toBe(1)
    expect(chorusTarget([], 2)).toBeNull()
  })

  it("a passage preview is the verse asked for and the two after it", () => {
    const ch = [1, 2, 3, 4, 5].map((verse) => ({ book: 43, bookName: "John", chapter: 3, verse, text: `v${verse}` }))
    expect(passageFrom(ch, 2).map((v) => v.verse)).toEqual([2, 3, 4])
    expect(passageFrom(ch, 5).map((v) => v.verse)).toEqual([5])
    expect(passageFrom(ch, 9)).toEqual([])
  })

  it("the director's board says who is connected in plain words", () => {
    const now = 10 * 60_000
    expect(crewWords({ name: "A", role: "bible", connected: true, lastSeenMs: now }, now)).toBe("Connected")
    expect(crewWords({ name: "A", role: "bible", connected: false, lastSeenMs: null }, now)).toBe("Not connected")
    expect(crewWords({ name: "A", role: "bible", connected: false, lastSeenMs: now - 20_000 }, now)).toBe("Seen just now")
    expect(crewWords({ name: "A", role: "bible", connected: false, lastSeenMs: now - 4 * 60_000 }, now)).toBe("Seen 4 min ago")
  })
})
