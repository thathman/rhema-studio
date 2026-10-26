import { describe, expect, it, vi } from "vitest"
import type { ProgramItem, ProgramWithItems, QueueItem, VerseQueueItem } from "@/types"
import type { OutlineHeader } from "@/lib/run-of-show"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }))

import { projectRunOfShowEvents } from "@/lib/run-of-show"
import { rundownSignature, toItemInputs, toQueueItems } from "@/stores/service-store"
import { useQueueStore } from "@/stores/queue-store"

const row = (id: string, kind: string, reference: string, payload: string | null = null): ProgramItem => ({
  id, program_id: "p", position: 0, kind, reference, book_number: kind === "verse" ? 43 : null, chapter: kind === "verse" ? 3 : null, verse: kind === "verse" ? 16 : null,
  translation: null, secondary_translation: null, notes: null, payload,
})
const program = (items: ProgramItem[]): ProgramWithItems => ({
  program: { id: "p", title: "Sunday", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 2 },
  items: items.map((i, position) => ({ ...i, position })),
})
const verse = (id: string): VerseQueueItem => ({
  id, verse: { id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 3, verse: 16, text: "" }, reference: "John 3:16", confidence: 1, source: "manual", added_at: 0,
})

describe("a service's phases and groups", () => {
  const saved = program([
    row("h1", "phase", "Warm-up", JSON.stringify({ rule: "auto_once", role: "warmup", later: 1, advance_seconds: 12 })),
    row("a", "verse", "John 3:16"),
    row("h2", "phase", "Main service", JSON.stringify({ rule: "manual", role: "main", starts_at: "10:00" })),
    row("h3", "group", "Word"),
    row("b", "verse", "John 3:16"),
  ])

  it("open as headers between the items and save back exactly in place", () => {
    const { items, headers, unsupported } = toQueueItems(saved, 1, [])
    expect(unsupported).toEqual([])
    expect(items.map((i) => i.id)).toEqual(["a", "b"])
    expect(headers.map((h) => [h.id, h.type, h.name, h.at])).toEqual([["h1", "phase", "Warm-up", 0], ["h2", "phase", "Main service", 1], ["h3", "group", "Word", 1]])
    expect(headers[1]).toMatchObject({ rule: "manual", role: "main", starts_at: "10:00" })
    expect(headers[0].advance_seconds).toBe(12)
    const back = toItemInputs(items, undefined, undefined, headers)
    expect(back.map((i) => [i.id, i.kind])).toEqual([["h1", "phase"], ["a", "verse"], ["h2", "phase"], ["h3", "group"], ["b", "verse"]])
    // A key from a newer build is kept.
    expect(JSON.parse(back[0].payload!)).toEqual({ later: 1, rule: "auto_once", role: "warmup", advance_seconds: 12 })
  })

  it("a plain service has no headers and saves as before", () => {
    const { headers } = toQueueItems(program([row("a", "verse", "John 3:16")]), 1, [])
    expect(headers).toEqual([])
    expect(rundownSignature([verse("a")], [])).toBe(rundownSignature([verse("a")]))
  })

  it("moving a header changes what is saved (unsaved changes)", () => {
    const { items, headers } = toQueueItems(saved, 1, [])
    const moved = headers.map((h) => (h.id === "h2" ? { ...h, at: 0 } : h))
    expect(rundownSignature(items, moved)).not.toBe(rundownSignature(items, headers))
  })

  it("the rundown's edits keep headers in place", () => {
    const { items, headers } = toQueueItems(saved, 1, [])
    useQueueStore.setState({ items, headers, activeIndex: null })
    useQueueStore.getState().addItem({ ...verse("c"), verse: { ...verse("c").verse, verse: 17 } })
    // New items go to the top: inside the first phase; the others move down.
    expect(useQueueStore.getState().headers.map((h) => h.at)).toEqual([0, 2, 2])
    useQueueStore.getState().removeItem("a")
    expect(useQueueStore.getState().headers.map((h) => h.at)).toEqual([0, 1, 1])
    useQueueStore.getState().reorderItems(1, 0) // b to the top: into Warm-up
    expect(useQueueStore.getState().items.map((i) => i.id)).toEqual(["b", "c"])
    expect(useQueueStore.getState().headers.map((h) => h.at)).toEqual([0, 2, 2])
    useQueueStore.getState().clearQueue()
    expect(useQueueStore.getState().headers).toEqual([])
  })

  it("adding to a section puts items at its end, in order", () => {
    const { items, headers } = toQueueItems(saved, 1, [])
    useQueueStore.setState({ items, headers, activeIndex: null, addTarget: "h1" })
    useQueueStore.getState().addItem({ ...verse("x"), verse: { ...verse("x").verse, verse: 18 } })
    useQueueStore.getState().addItem({ ...verse("y"), verse: { ...verse("y").verse, verse: 19 } })
    expect(useQueueStore.getState().items.map((i) => i.id)).toEqual(["a", "x", "y", "b"])
    expect(useQueueStore.getState().headers.map((h) => h.at)).toEqual([0, 3, 3])
    useQueueStore.getState().setAddTarget(null)
  })

  it("adds a moment to the end of an event without moving its nested group", () => {
    const items = [verse("a"), verse("b"), verse("c"), verse("d")]
    const headers: OutlineHeader[] = [
      { id: "sermon", type: "group", name: "Sermon", at: 0, event: { schema_version: 1, duration_minutes: 40, approval: "draft" } },
      { id: "scripture", type: "group", name: "Scripture", at: 2 },
      { id: "response", type: "group", name: "Response", at: 3, event: { schema_version: 1, approval: "draft" } },
    ]
    useQueueStore.setState({ items, headers, activeIndex: null, addTarget: "sermon" })
    const moment: QueueItem = { id: "x", kind: "cue", reference: "Prayer cue", confidence: 1, source: "manual", added_at: 0 }
    useQueueStore.getState().addItem(moment)
    expect(useQueueStore.getState().items.map((item) => item.id)).toEqual(["a", "b", "c", "x", "d"])
    expect(useQueueStore.getState().headers.map(({ id, at }) => [id, at])).toEqual([["sermon", 0], ["scripture", 2], ["response", 4]])
    expect(projectRunOfShowEvents(useQueueStore.getState().items, useQueueStore.getState().headers)[0].moments.map((item) => item.id)).toEqual(["a", "b", "c", "x"])
    useQueueStore.getState().setAddTarget(null)
  })

  it("an item's go-live message and cue are saved cleaned and come back; an unknown cue is dropped", () => {
    const saved = program([row("a", "verse", "John 3:16", JSON.stringify({ on_live: { stage_message: "  Wrap   up ", cue: "timer.fresh" } })), row("b", "verse", "John 3:16", JSON.stringify({ on_live: { cue: "quick.black" } }))])
    const { items, headers } = toQueueItems(saved, 1, [])
    expect(items[0].on_live).toEqual({ stage_message: "Wrap up", cue: "timer.fresh" })
    expect(items[1].on_live).toBeNull()
    const back = toItemInputs(items, undefined, undefined, headers)
    expect(JSON.parse(back[0].payload!).on_live).toEqual({ stage_message: "Wrap up", cue: "timer.fresh" })
  })

  it("an item that moves on by itself keeps the mark through a save", () => {
    const saved = program([row("a", "verse", "John 3:16", JSON.stringify({ planned_minutes: 2, auto_advance: true })), row("b", "verse", "John 3:16", JSON.stringify({ auto_advance: "yes" }))])
    const { items, headers } = toQueueItems(saved, 1, [])
    expect(items.map((i) => i.auto_advance)).toEqual([true, null])
    expect(JSON.parse(toItemInputs(items, undefined, undefined, headers)[0].payload!)).toMatchObject({ planned_minutes: 2, auto_advance: true })
  })

  it("an item's scene, look, camera and Take steps are saved and come back (#243 RS.3, RS.4)", () => {
    const plan = { scene_id: "scene-1", look_id: "classic-dark", camera: "pulpit", on_take: ["obs.scene:Sermon", "scene.take:scene-1@main", "quick.black", "source.only"] }
    const saved = program([row("a", "verse", "John 3:16", JSON.stringify(plan)), row("b", "slide", "Welcome", JSON.stringify({ title: "Welcome", body: "", scene_id: "", camera: 7, on_take: "obs.scene:x" }))])
    const { items, headers } = toQueueItems(saved, 1, [])
    // Steps in the order they run; one this build does not know is dropped.
    expect(items[0]).toMatchObject({ scene_id: "scene-1", look_id: "classic-dark", camera: "pulpit", on_take: ["source.only", "scene.take:scene-1@main", "obs.scene:Sermon"] })
    expect(items[0].payload_extra).toBeUndefined()
    // Broken values are left out, not guessed.
    expect(["scene_id", "look_id", "camera", "on_take"].filter((k) => k in items[1])).toEqual([])
    const back = toItemInputs(items, undefined, undefined, headers)
    expect(JSON.parse(back[0].payload!)).toEqual({ scene_id: "scene-1", look_id: "classic-dark", camera: "pulpit", on_take: ["source.only", "scene.take:scene-1@main", "obs.scene:Sermon"] })
    expect(JSON.parse(back[1].payload!)).toEqual({ title: "Welcome", body: "" })
  })

  it("an AI suggestion mark stays through a save until someone accepts it (#252)", () => {
    const saved = program([row("a", "slide", "Welcome", JSON.stringify({ title: "Welcome", body: "Words an assistant wrote", ai_suggestion: "Claude" })), row("b", "slide", "Notices", JSON.stringify({ title: "Notices", body: "", ai_suggestion: 7 }))])
    const { items, headers } = toQueueItems(saved, 1, [])
    expect(items[0].ai_suggestion).toBe("Claude")
    expect(items[0].payload_extra).toBeUndefined()
    expect("ai_suggestion" in items[1]).toBe(false)
    expect(JSON.parse(toItemInputs(items, undefined, undefined, headers)[0].payload!)).toEqual({ title: "Welcome", body: "Words an assistant wrote", ai_suggestion: "Claude" })
    const accepted = items.map((i) => ({ ...i, ai_suggestion: null }))
    expect(JSON.parse(toItemInputs(accepted, undefined, undefined, headers)[0].payload!)).toEqual({ title: "Welcome", body: "Words an assistant wrote" })
  })

  it("a service saved before items had a plan opens and saves exactly as before", () => {
    const saved = program([row("a", "verse", "John 3:16"), row("b", "slide", "Welcome", JSON.stringify({ title: "Welcome", body: "Tea", planned_minutes: 3 }))])
    const { items, headers } = toQueueItems(saved, 1, [])
    expect(items.every((i) => !("scene_id" in i) && !("on_take" in i))).toBe(true)
    const back = toItemInputs(items, undefined, undefined, headers)
    expect(back[0].payload).toBeUndefined()
    expect(JSON.parse(back[1].payload!)).toEqual({ title: "Welcome", body: "Tea", planned_minutes: 3 })
  })
})
