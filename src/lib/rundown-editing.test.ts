import { describe, expect, it, vi } from "vitest"
import type { ProgramItem, QueueItem, SongWithSections } from "@/types"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))

const { cleanCues, cuesFor, hasCues } = await import("@/lib/item-cues")
const { isSkipped, nextInPhase, nextVisibleItem, previousVisibleItem, newPhase, planTimeline, sectionSummaries, timedItems } = await import("@/lib/run-of-show")
const { songSlides } = await import("@/lib/lyrics")
const { toItemInputs, toQueueItems, rundownSignature } = await import("@/stores/service-store")

const slide = (id: string, extra: Partial<QueueItem> = {}): QueueItem =>
  ({ id, kind: "slide", slide: { title: id, body: "words" }, reference: id, confidence: 1, source: "manual", added_at: 0, ...extra }) as QueueItem

describe("an item's cue list (#193, #196 R6)", () => {
  it("keeps known moments and actions, words where they belong, at most 12", () => {
    const raw = [
      { on: "live", do: "obs.mark", text: "  Sermon\tstarts " },
      { on: "finish", do: "stage.message", text: "Time is up" },
      { on: "end", do: "timer.pause", text: "dropped" },
      { on: "later", do: "timer.pause" },
      { on: "live", do: "next" },
      { on: "live", do: "stage.message", text: "  " },
    ] as never
    expect(cleanCues(raw)).toEqual([
      { on: "live", do: "obs.mark", text: "Sermon starts" },
      { on: "finish", do: "stage.message", text: "Time is up" },
      { on: "end", do: "timer.pause" },
    ])
    expect(cleanCues(Array(20).fill({ on: "end", do: "timer.pause" }))).toHaveLength(12)
    expect(cleanCues(null)).toEqual([])
  })

  it("runs the go-live message and cue first, then the list, for its moment", () => {
    const item = slide("s", { on_live: { stage_message: "Wrap up", cue: "timer.fresh" }, cues: [{ on: "live", do: "obs.mark" }, { on: "end", do: "timer.pause" }] })
    expect(cuesFor(item, "live")).toEqual([{ on: "live", do: "stage.message", text: "Wrap up" }, { on: "live", do: "timer.fresh" }, { on: "live", do: "obs.mark" }])
    expect(cuesFor(item, "end")).toEqual([{ on: "end", do: "timer.pause" }])
    expect(cuesFor(item, "pause")).toEqual([])
    expect(hasCues(slide("x"))).toBe(false)
  })
})

describe("hidden items and skipped phases (#193)", () => {
  const items = [slide("a", { planned_minutes: 5 }), slide("b", { planned_minutes: 10, hidden: true }), slide("c", { planned_minutes: 15 }), slide("d", { planned_minutes: 20 })]
  const headers = [
    { id: "main", type: "phase" as const, name: "Main service", at: 0, rule: "manual" as const, role: "main" as const, starts_at: "10:00" },
    { id: "post", type: "phase" as const, name: "Post", at: 3, rule: "loop" as const, role: "post" as const, disabled: true },
  ]

  it("knows what Present passes over and takes no planned time", () => {
    expect([0, 1, 2, 3].map((i) => isSkipped(items, headers, i))).toEqual([false, true, false, true])
    expect(timedItems(items, headers).map((i) => i.planned_minutes ?? 0)).toEqual([5, 0, 15, 0])
    expect(sectionSummaries(items, headers).main).toEqual({ count: 3, minutes: 20 })
    const plan = planTimeline(items, headers)!
    expect(plan.rows.filter((r) => r.kind === "item").map((r) => [r.label, r.time])).toEqual([["a", "10:00"], ["c", "10:05"]])
    expect(plan.finish).toBe("10:20")
  })

  it("a running phase steps over skipped items, and stops when nothing is left", () => {
    const skip = (i: number) => i === 1 || i === 3
    expect(nextInPhase("loop", 0, 4, 0, skip)).toBe(2)
    expect(nextInPhase("loop", 0, 4, 2, skip)).toBe(0)
    expect(nextInPhase("auto_once", 0, 4, 2, skip)).toBeNull()
    expect(nextInPhase("loop", 0, 4, -1, () => true)).toBeNull()
    expect(nextInPhase("loop", 0, 4, -1, (i) => i === 0)).toBe(1)
    // As before without a skip: a loop of one keeps its item up.
    expect(nextInPhase("loop", 2, 3, 2)).toBe(2)
  })

  it("finds the next visible item across hidden items and a disabled phase", () => {
    const items = [slide("Live"), slide("Hidden one", { hidden: true }), slide("Hidden two", { hidden: true }), slide("Skipped phase"), slide("Next")]
    const headers = [
      { id: "active", type: "phase" as const, name: "Main", at: 0, rule: "manual" as const },
      { id: "disabled", type: "phase" as const, name: "Skipped", at: 3, rule: "manual" as const, disabled: true },
      { id: "following", type: "phase" as const, name: "Following", at: 4, rule: "manual" as const },
    ]

    expect(nextVisibleItem(items, headers, 0)).toMatchObject({ index: 4, item: items[4], kind: "item", label: "Next" })
    expect(nextVisibleItem(items, headers, 4)).toBeNull()
  })

  it("labels a cue as a moment and supports finding the previous visible entry", () => {
    const cue: QueueItem = { id: "cue", kind: "cue", reference: "Prayer begins", confidence: 1, source: "manual", added_at: 0 }
    const items = [slide("Opening"), cue, slide("Hidden", { hidden: true }), slide("Sermon")]

    expect(nextVisibleItem(items, [], 0)).toMatchObject({ index: 1, kind: "moment", label: "Moment · Prayer begins" })
    expect(nextVisibleItem(items, [], null)?.index).toBe(0)
    expect(nextVisibleItem(items, [], 3)).toBeNull()
    expect(previousVisibleItem(items, [], 3)?.index).toBe(1)
  })

  it("a church's own phase runs by hand", () => {
    expect(newPhase(3, "Baptism", () => "x")).toEqual({ id: "x", type: "phase", name: "Baptism", at: 3, rule: "manual", role: "custom" })
  })
})

describe("a song's title slide (#193)", () => {
  const song = {
    song: { id: "s", title: "Amazing Grace", authors: "John Newton", primary_language: "en", revision: 1 },
    sections: [{ id: "v1", kind: "verse", label: "Verse 1", texts: { en: "Amazing grace" } }],
    arrangements: [],
  } as unknown as SongWithSections
  it("comes first when the item asks for it", () => {
    expect(songSlides(song, { arrangement_id: null, languages: ["en"] }).map((s) => s.lines)).toEqual([["Amazing grace"]])
    const slides = songSlides(song, { arrangement_id: null, languages: ["en"], title_slide: true })
    expect(slides.map((s) => [s.sectionLabel, s.lines, s.index, s.total])).toEqual([["Title", ["Amazing Grace", "John Newton"], 0, 2], ["Verse 1", ["Amazing grace"], 1, 2]])
  })
})

describe("saving and opening the new parts (#193)", () => {
  const roundTrip = (items: QueueItem[], headers: Parameters<typeof toItemInputs>[3] = []) => {
    const rows: ProgramItem[] = toItemInputs(items, () => "KJV", { primary: "KJV", secondary: null }, headers).map((r, position) => ({ ...r, id: r.id!, program_id: "p", position, payload: r.payload ?? null }) as ProgramItem)
    return { rows, back: toQueueItems({ program: { id: "p" } as never, items: rows }, 1, []) }
  }

  it("keeps cue items, cue lists, hidden items, title slides and skipped phases", () => {
    const cue: QueueItem = { id: "c", kind: "cue", reference: "Sermon begins", confidence: 1, source: "manual", added_at: 0, cues: [{ on: "live", do: "obs.mark", text: "Sermon" }] }
    const song = { id: "g", kind: "song", song: { song_id: "s1", title: "Grace", arrangement_id: null, languages: ["en"], title_slide: true }, reference: "Grace", confidence: 1, source: "manual", added_at: 0, hidden: true, cues: [{ on: "end", do: "timer.pause" }] } as QueueItem
    const headers = [{ id: "h", type: "phase" as const, name: "Pre-service loop", at: 0, rule: "loop" as const, role: "pre" as const, disabled: true }]
    const { rows, back } = roundTrip([cue, song], headers)
    expect(rows.map((r) => r.kind)).toEqual(["phase", "cue", "song"])
    expect(JSON.parse(rows[0].payload!)).toMatchObject({ disabled: true })
    expect(back.unsupported).toEqual([])
    expect(back.headers[0]).toMatchObject({ disabled: true })
    expect(back.items[0]).toMatchObject({ kind: "cue", reference: "Sermon begins", cues: [{ on: "live", do: "obs.mark", text: "Sermon" }] })
    expect(back.items[1]).toMatchObject({ hidden: true, cues: [{ on: "end", do: "timer.pause" }], song: { title_slide: true } })
    expect(back.items[0].payload_extra).toBeUndefined()
    expect(back.items[1].payload_extra).toBeUndefined()
  })

  it("leaves an item without any of them saved exactly as before", () => {
    const plain = slide("p", { on_live: { cue: "timer.start" }, planned_minutes: 3 })
    expect(JSON.parse(toItemInputs([plain])[0].payload!)).toEqual({ title: "p", body: "words", planned_minutes: 3, on_live: { cue: "timer.start" } })
    expect(rundownSignature([plain])).toBe(rundownSignature([{ ...plain, hidden: null, cues: null }]))
  })
})
