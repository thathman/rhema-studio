import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ProgramItem, ProgramWithItems, QueueItem, VerseQueueItem } from "@/types"

const mockInvoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

import { useServiceStore, toItemInputs, toQueueItems, rundownSignature, cleanName, unsavedScratch, slideLabel } from "./service-store"
import type { Translation } from "@/types"
import { useQueueStore } from "./queue-store"
import { useBibleStore } from "./bible-store"
import type { OutlineHeader } from "@/lib/run-of-show"
import { projectRunOfShowEvents } from "@/lib/run-of-show"

const program = {
  id: "p1",
  title: "Sunday",
  service_date: "2026-10-25",
  revision: 1,
  created_at: "",
  updated_at: "",
  item_count: 2,
}

const item = (id: string, reference: string, b: number, c: number, v: number, extra: Partial<ProgramItem> = {}): ProgramItem => ({
  id,
  program_id: "p1",
  position: 0,
  kind: "verse",
  reference,
  book_number: b,
  chapter: c,
  verse: v,
  translation: null,
  secondary_translation: null,
  notes: null,
  payload: null,
  ...extra,
})

const stored: ProgramWithItems = {
  program,
  items: [item("i1", "Psalms 23:1", 19, 23, 1), item("i2", "John 3:16", 43, 3, 16)],
}

const queueItem = (ref: string, b: number, c: number, v: number): VerseQueueItem => ({
  id: crypto.randomUUID(),
  verse: { id: 0, translation_id: 1, book_number: b, book_name: ref.split(" ")[0], book_abbreviation: "", chapter: c, verse: v, text: "t" },
  reference: ref,
  confidence: 1,
  source: "manual",
  added_at: 0,
})

/** A controllable promise for the replace_items call. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const savedResponse = (revision: number, items: ProgramItem[] = stored.items): ProgramWithItems => ({
  program: { ...program, revision, item_count: items.length },
  items,
})

const KJV: Translation = { id: 1, abbreviation: "KJV", title: "", language: "en", is_copyrighted: false, is_downloaded: true }
const OYCB: Translation = { id: 7, abbreviation: "OYCB", title: "", language: "yo", is_copyrighted: false, is_downloaded: true }

/** A Yoruba service with an English secondary and a note, as saved by the database. */
const bilingual: ProgramWithItems = {
  program,
  items: [
    item("y1", "Johanu 3:16", 43, 3, 16, { translation: "OYCB", secondary_translation: "KJV", notes: "Read slowly" }),
    item("y2", "Orin Dafidi 23:1", 19, 23, 1, { translation: "OYCB", secondary_translation: "KJV" }),
  ],
}

const sentItems = () => {
  const call = mockInvoke.mock.calls.filter((c) => c[0] === "content_replace_items").at(-1)!
  return (call[1] as { items: Array<Record<string, unknown>> }).items
}

async function openStored() {
  mockInvoke.mockImplementation(async (cmd: string) => (cmd === "content_get_program" ? stored : null))
  expect(await useServiceStore.getState().openProgram("p1")).toBe("ok")
}

beforeEach(() => {
  mockInvoke.mockReset()
  useQueueStore.setState({ items: [], activeIndex: null })
  useBibleStore.setState({ activeTranslationId: 1, secondaryTranslationId: null, translations: [KJV] })
  useServiceStore.setState({ programs: [], current: null, dirty: false, loading: false, saving: false, error: null, conflict: null, unsupportedItems: [], missingTranslations: [] })
})

describe("conversions", () => {
  it("keeps item ids and resolves translation abbreviations", () => {
    const items = [queueItem("Psalms 23:1", 19, 23, 1)]
    const out = toItemInputs(items, (id) => (id === 1 ? "KJV" : null))
    expect(out[0]).toEqual({ id: items[0].id, kind: "verse", reference: "Psalms 23:1", book_number: 19, chapter: 23, verse: 1, translation: "KJV", secondary_translation: null, notes: null })
  })

  it("stored items become rundown items with the stored id", () => {
    const { items, unsupported } = toQueueItems(stored, 1, [KJV])
    expect(items.map((i) => i.id)).toEqual(["i1", "i2"])
    expect(items[0].verse).toMatchObject({ book_number: 19, chapter: 23, verse: 1, book_name: "Psalms", text: "" })
    expect(unsupported).toEqual([])
  })

  it("round trips a versioned service event with its moments through the legacy group row", () => {
    const event = {
      schema_version: 1 as const,
      role: "sermon",
      duration_minutes: 40,
      ownership: "Pastor",
    }
    const headers = [{ id: "sermon-event", type: "group", name: "Sermon", at: 0, notes: "Main message", event } as unknown as OutlineHeader]
    const moments = [queueItem("John 3:16", 43, 3, 16), queueItem("Romans 8:28", 45, 8, 28)]
    const saved = toItemInputs(moments, undefined, undefined, headers)
    expect(saved[0]).toMatchObject({
      id: "sermon-event",
      kind: "group",
      payload: JSON.stringify({ run_of_show_event: event }),
    })

    const storedEvent = item("sermon-event", "Sermon", 0, 0, 0, {
      kind: "group",
      book_number: null,
      chapter: null,
      verse: null,
      notes: "Main message",
      // Older versions wrote event-level approval. It is ignored and removed
      // on the next save because approval belongs to the service revision.
      payload: JSON.stringify({ run_of_show_event: { ...event, approval: "approved" } }),
    })
    const storedMoments = moments.map((moment, position) => {
      const input = toItemInputs([moment])[0]
      return item(moment.id, input.reference, input.book_number!, input.chapter!, input.verse!, { position: position + 1 })
    })
    const { items: loadedMoments, headers: loadedHeaders, unsupported } = toQueueItems({ program, items: [storedEvent, ...storedMoments] }, 1, [KJV])
    expect(unsupported).toEqual([])
    expect(loadedMoments.map((moment) => moment.id)).toEqual(moments.map((moment) => moment.id))
    expect(loadedHeaders).toEqual(headers)
    expect(toItemInputs(loadedMoments, undefined, undefined, loadedHeaders)[0]).toMatchObject(saved[0])
  })

  it("unknown kinds and malformed verses are set aside, never converted", () => {
    const data: ProgramWithItems = {
      program,
      items: [
        item("ok", "John 3:16", 43, 3, 16),
        item("song", "Amazing Grace", 0, 0, 0, { kind: "song", book_number: null, chapter: null, verse: null }),
        item("broken", "Nowhere 1:1", 0, 0, 0, { book_number: null }),
      ],
    }
    const { items, unsupported } = toQueueItems(data, 1, [KJV])
    expect(items.map((i) => i.id)).toEqual(["ok"])
    expect(unsupported.map((i) => i.id)).toEqual(["song", "broken"])
  })

  it("stored translation, secondary and notes ride on the rundown item and come back out unchanged", () => {
    const { items: loaded, missingTranslations } = toQueueItems(bilingual, 1, [KJV, OYCB])
    const items = loaded as VerseQueueItem[]
    expect(missingTranslations).toEqual([])
    expect(items[0]).toMatchObject({ translation: "OYCB", secondary_translation: "KJV", notes: "Read slowly" })
    expect(items[0].verse.translation_id).toBe(OYCB.id) // text lookups use the pinned translation
    // The operator is presenting KJV with no secondary: the service's own choice still wins.
    const out = toItemInputs(items, (id) => (id === 1 ? "KJV" : id === 7 ? "OYCB" : null), { primary: "KJV", secondary: null })
    expect(out.map((o) => [o.translation, o.secondary_translation, o.notes])).toEqual([
      ["OYCB", "KJV", "Read slowly"],
      ["OYCB", "KJV", null],
    ])
  })

  it("a stored null translation stays null (follow active) rather than being pinned on re-save", () => {
    const { items } = toQueueItems(stored, 1, [KJV])
    const out = toItemInputs(items, () => "KJV", { primary: "KJV", secondary: null })
    expect(out.map((o) => o.translation)).toEqual([null, null])
  })

  it("never-saved items take the translation they were added with and the current secondary", () => {
    const out = toItemInputs([queueItem("John 3:16", 43, 3, 16)], (id) => (id === 1 ? "KJV" : null), { primary: "KJV", secondary: "OYCB" })
    expect(out[0]).toMatchObject({ translation: "KJV", secondary_translation: "OYCB", notes: null })
  })

  it("a pinned translation that is not installed is reported, text falls back, and the pin survives", () => {
    const { items: loaded, missingTranslations } = toQueueItems(bilingual, 1, [KJV])
    const items = loaded as VerseQueueItem[]
    expect(missingTranslations).toEqual(["OYCB"])
    expect(items[0].verse.translation_id).toBe(1)
    expect(items[0].translation).toBe("OYCB")
    const out = toItemInputs(items, () => "KJV", { primary: "KJV", secondary: null })
    expect(out[0]).toMatchObject({ translation: "OYCB", secondary_translation: "KJV" })
  })

  it("signature ignores verse text but not order or identity", () => {
    const a = [queueItem("A 1:1", 1, 1, 1), queueItem("B 2:2", 2, 2, 2)]
    const b = a.map((i) => ({ ...i, verse: { ...i.verse, text: "changed" } }))
    expect(rundownSignature(a)).toBe(rundownSignature(b))
    expect(rundownSignature([a[1], a[0]])).not.toBe(rundownSignature(a))
    expect(rundownSignature([{ ...a[0], id: "other" }, a[1]])).not.toBe(rundownSignature(a))
  })
})

describe("bilingual service round trip", () => {
  it("open → save under a different active translation → reopen keeps OYCB, KJV secondary and notes", async () => {
    useBibleStore.setState({ activeTranslationId: 1, secondaryTranslationId: null, translations: [KJV, OYCB] })
    let db: ProgramWithItems = bilingual
    mockInvoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "content_get_program") return db
      if (cmd === "content_replace_items") {
        const sent = args.items as Array<Omit<ProgramItem, "program_id" | "position">>
        db = { program: { ...db.program, revision: db.program.revision + 1, item_count: sent.length }, items: sent.map((it, position) => ({ ...it, program_id: "p1", position })) }
        return db
      }
      return null
    })
    expect(await useServiceStore.getState().openProgram("p1")).toBe("ok")
    expect(useServiceStore.getState().missingTranslations).toEqual([])
    expect(mockInvoke.mock.calls.filter((c) => c[0] === "get_verse").every((c) => (c[1] as { translationId: number }).translationId === OYCB.id)).toBe(true)

    // Operator switches the live translation to KJV and adds an English verse, then saves.
    useBibleStore.getState().setActiveTranslation(1)
    useQueueStore.getState().addItem(queueItem("Romans 8:28", 45, 8, 28))
    expect(await useServiceStore.getState().saveCurrent()).toBe("saved")
    const sent = sentItems()
    expect(sent.slice(1).map((i) => [i.id, i.translation, i.secondary_translation, i.notes])).toEqual([
      ["y1", "OYCB", "KJV", "Read slowly"],
      ["y2", "OYCB", "KJV", null],
    ])
    expect(sent[0]).toMatchObject({ reference: "Romans 8:28", translation: "KJV", secondary_translation: null })

    // Reopen after a "restart": the store is cleared, the database is the source.
    useServiceStore.setState({ current: null, dirty: false })
    useQueueStore.setState({ items: [] })
    expect(await useServiceStore.getState().openProgram("p1")).toBe("ok")
    const q = useQueueStore.getState().items as VerseQueueItem[]
    expect(q.map((i) => [i.id, i.translation, i.secondary_translation, i.notes])).toEqual([
      [sent[0].id, "KJV", null, null],
      ["y1", "OYCB", "KJV", "Read slowly"],
      ["y2", "OYCB", "KJV", null],
    ])
    expect(useServiceStore.getState().dirty).toBe(false)
  })

  it("a service naming an uninstalled translation opens with a warning and re-saves without losing it", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => (cmd === "content_get_program" ? bilingual : cmd === "content_replace_items" ? savedResponse(2, bilingual.items) : null))
    expect(await useServiceStore.getState().openProgram("p1")).toBe("ok")
    expect(useServiceStore.getState().missingTranslations).toEqual(["OYCB"])
    expect((useQueueStore.getState().items[0] as VerseQueueItem).verse.translation_id).toBe(1)
    useQueueStore.getState().addItem(queueItem("Romans 8:28", 45, 8, 28))
    expect(await useServiceStore.getState().saveCurrent()).toBe("saved")
    expect(sentItems().find((i) => i.id === "y1")).toMatchObject({ translation: "OYCB", secondary_translation: "KJV", notes: "Read slowly" })
  })

  it("changing an item's notes or translation marks the service dirty", async () => {
    await openStored()
    useQueueStore.setState((s) => ({ items: s.items.map((i, n) => (n === 0 ? { ...i, notes: "Pause here" } : i)) }))
    expect(useServiceStore.getState().dirty).toBe(true)
  })
})

describe("five-event Run of Show round trip (#444)", () => {
  it("saves and reopens stable event, moment, timing and audience intent data without changing live playback", async () => {
    let db: ProgramWithItems = { program: { ...program, item_count: 0 }, items: [] }
    mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "content_get_program") return db
      if (cmd === "content_replace_items") {
        const rows = args?.items as ProgramItem[]
        db = {
          program: { ...db.program, revision: db.program.revision + 1, item_count: rows.length },
          items: rows.map((row, position) => ({ ...row, program_id: "p1", position })),
        }
        return db
      }
      return null
    })
    expect(await useServiceStore.getState().openProgram("p1")).toBe("ok")

    const verse = (id: string, reference: string, book: number, chapter: number, number: number): QueueItem => ({
      ...queueItem(reference, book, chapter, number), id, translation: "KJV", secondary_translation: null, notes: `${id} note`,
    })
    const slide = (id: string, title: string, body: string): QueueItem => ({
      id, kind: "slide", slide: { title, body }, reference: title, confidence: 1, source: "manual", added_at: 0,
    }) as unknown as QueueItem
    const items = [
      verse("prayer-scripture", "Psalms 23:1", 19, 23, 1),
      slide("prayer-cue", "Prayer", "Pray for the church"),
      slide("worship-lyrics", "Worship", "Holy, holy, holy"),
      verse("sermon-john", "John 3:16", 43, 3, 16),
      verse("sermon-romans", "Romans 8:28", 45, 8, 28),
      verse("sermon-psalm", "Psalms 46:1", 19, 46, 1),
      slide("response-slide", "Response", "Come forward"),
      slide("quiz-question", "Post-service quiz", "Who built the ark?"),
    ]
    const headers: OutlineHeader[] = [
      { id: "phase-warmup", type: "phase", name: "Warm-up", at: 0, notes: null, rule: "auto_once", role: "warmup", starts_at: "09:45" },
      { id: "phase-main", type: "phase", name: "Main service", at: 0, notes: null, rule: "manual", role: "main", starts_at: "10:00" },
      {
        id: "event-prayer", type: "group", name: "Opening Prayer", at: 0, notes: "Lead with care",
        event: {
          schema_version: 1, role: "Prayer", duration_minutes: 15, ownership: "Pastor",
          payload_extra: { scene_intentions: { congregation: "camera-plus-scripture", obs: "scripture-lower-third", stage: "private-timer" }, lower_third: "Pastor A" },
        },
      },
      { id: "prayer-moments", type: "group", name: "Prayer moments", at: 1, notes: null },
      { id: "event-worship", type: "group", name: "Worship", at: 2, notes: null, event: { schema_version: 1, role: "Worship", duration_minutes: 20, ownership: "Worship leader" } },
      { id: "event-sermon", type: "group", name: "Sermon", at: 3, notes: "Three Scripture moments", event: { schema_version: 1, role: "Sermon", duration_minutes: 40, ownership: "Pastor" } },
      { id: "sermon-scripture", type: "group", name: "Scripture moments", at: 4, notes: null },
      { id: "sermon-response", type: "group", name: "Response", at: 6, notes: null },
      { id: "event-closing", type: "group", name: "Closing prayer", at: 6, notes: null, event: { schema_version: 1, role: "Prayer", duration_minutes: 5, ownership: "Prayer lead" } },
      { id: "event-quiz", type: "group", name: "Post-service quiz", at: 7, notes: null, event: { schema_version: 1, role: "Quiz", duration_minutes: 10, ownership: "Host" } },
      { id: "phase-post", type: "phase", name: "Post-service loop", at: 8, notes: null, rule: "loop", role: "post", advance_seconds: 30 },
    ]
    useQueueStore.setState({ items, headers, activeIndex: 3 })
    const { useBroadcastStore } = await import("./broadcast-store")
    useBroadcastStore.setState({ isLive: true, liveItemId: "currently-on-air", liveSlide: null, liveVerse: null })
    const liveBefore = useBroadcastStore.getState()
    const planBefore = structuredClone({ items, headers })

    expect(await useServiceStore.getState().saveCurrent()).toBe("saved")
    expect(useServiceStore.getState().dirty).toBe(false)
    expect(await useServiceStore.getState().openProgram("p1")).toBe("ok")

    const reopened = useQueueStore.getState()
    expect(reopened.items.map((item) => item.id)).toEqual(planBefore.items.map((item) => item.id))
    expect(reopened.headers).toEqual(planBefore.headers)
    expect(projectRunOfShowEvents(reopened.items, reopened.headers).map((event) => [event.id, event.duration_minutes, event.moments.map((moment) => moment.id)])).toEqual([
      ["event-prayer", 15, ["prayer-scripture", "prayer-cue"]],
      ["event-worship", 20, ["worship-lyrics"]],
      ["event-sermon", 40, ["sermon-john", "sermon-romans", "sermon-psalm"]],
      ["event-closing", 5, ["response-slide"]],
      ["event-quiz", 10, ["quiz-question"]],
    ])
    expect(reopened.headers.find((header) => header.id === "event-prayer")?.event?.payload_extra).toEqual({
      scene_intentions: { congregation: "camera-plus-scripture", obs: "scripture-lower-third", stage: "private-timer" },
      lower_third: "Pastor A",
    })
    expect(db.items.map((row) => row.id)).toContain("event-prayer")
    expect(useBroadcastStore.getState()).toEqual(liveBefore)
    useBroadcastStore.setState({ isLive: false, liveItemId: null, liveSlide: null, liveVerse: null })
  })
})

describe("open and dirty tracking", () => {
  it("openProgram loads the rundown, backfills text and stays clean", async () => {
    mockInvoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "content_get_program") return stored
      if (cmd === "get_verse") return { id: 1, translation_id: 1, book_number: args.bookNumber, book_name: "x", book_abbreviation: "", chapter: args.chapter, verse: args.verse, text: `text ${args.verse}` }
      return null
    })
    expect(await useServiceStore.getState().openProgram("p1")).toBe("ok")
    const q = useQueueStore.getState().items as VerseQueueItem[]
    expect(q.map((i) => i.id)).toEqual(["i1", "i2"])
    expect(q[1].verse.text).toBe("text 16")
    expect(useServiceStore.getState()).toMatchObject({ dirty: false, conflict: null })
  })

  it("editing marks dirty; undoing the edit makes it clean again", async () => {
    await openStored()
    const extra = queueItem("Romans 8:28", 45, 8, 28)
    useQueueStore.getState().addItem(extra)
    expect(useServiceStore.getState().dirty).toBe(true)
    useQueueStore.getState().removeItem(extra.id)
    expect(useServiceStore.getState().dirty).toBe(false)
    useQueueStore.getState().reorderItems(0, 1)
    expect(useServiceStore.getState().dirty).toBe(true)
  })

  it("a missing service reports instead of throwing", async () => {
    mockInvoke.mockResolvedValue(null)
    expect(await useServiceStore.getState().openProgram("gone")).toBe("missing")
    expect(useServiceStore.getState().error).toMatch(/no longer exists/)
  })

  it("backend failure surfaces the command error message", async () => {
    mockInvoke.mockRejectedValue({ kind: "unavailable", message: "Content database is not available" })
    expect(await useServiceStore.getState().loadPrograms()).toBe(false)
    expect(useServiceStore.getState().error).toMatch(/not available/)
  })
})

describe("unsaved-change protection lives in the store", () => {
  it("open, close, create and delete refuse while dirty unless discard is explicit", async () => {
    await openStored()
    useQueueStore.getState().addItem(queueItem("Romans 8:28", 45, 8, 28))
    const s = useServiceStore.getState()
    expect(await s.openProgram("p2")).toBe("unsaved")
    expect(s.closeProgram()).toBe("unsaved")
    expect(await s.createProgram("Other", null)).toBeNull()
    expect(await s.createFromRundown("Other", null)).toBe("unsaved")
    expect(await s.deleteProgram("p1")).toBe("unsaved")
    expect(useServiceStore.getState().current?.id).toBe("p1")
    expect(useQueueStore.getState().items).toHaveLength(3)
    // Nothing was sent to the backend for those refusals.
    expect(mockInvoke.mock.calls.filter((c) => c[0] !== "content_get_program" && c[0] !== "get_verse")).toHaveLength(0)

    expect(useServiceStore.getState().closeProgram({ discard: true })).toBe("closed")
    expect(useServiceStore.getState().current).toBeNull()
  })
})

describe("saving", () => {
  it("New service from the items on screen gives them new ids (ids are unique across services), and the live marker follows", async () => {
    await openStored()
    const { useBroadcastStore } = await import("./broadcast-store")
    useBroadcastStore.setState({ liveItemId: "i1" })
    useServiceStore.getState().closeProgram()
    mockInvoke.mockImplementation(async (cmd: string, a?: { items?: ProgramItem[] }) =>
      cmd === "content_create_program" ? { ...program, id: "p2", revision: 1 } : cmd === "content_replace_items" ? { program: { ...program, id: "p2", revision: 2 }, items: a?.items ?? [] } : null)
    await useServiceStore.getState().createFromRundown("Evening", null, { discard: true })
    const ids = sentItems().map((i) => String(i.id))
    expect(ids).toHaveLength(2)
    expect(ids).not.toContain("i1")
    expect(useBroadcastStore.getState().liveItemId).toBe(ids[0])
    useBroadcastStore.setState({ liveItemId: null })
  })

  it("Duplicate moves the live marker, the preview selection and the service log to the copies", async () => {
    await openStored()
    const { useBroadcastStore } = await import("./broadcast-store")
    const { useJournalStore } = await import("./journal-store")
    const { useBibleStore } = await import("./bible-store")
    useBroadcastStore.setState({ liveItemId: "i2" })
    useJournalStore.setState({ entries: [{ kind: "live", label: "John 3:16", itemId: "i2", at: 0, mono: 0 }] })
    const slideItem = { ...useQueueStore.getState().items[0], kind: "slide", slide: { title: "Hi", body: "" } }
    useBibleStore.setState({ selectedSlide: { item: slideItem as never, index: 0 } })
    mockInvoke.mockImplementation(async (cmd: string, a?: { items?: ProgramItem[] }) =>
      cmd === "content_create_program" ? { ...program, id: "p3", revision: 1 } : cmd === "content_replace_items" ? { program: { ...program, id: "p3", revision: 2 }, items: a?.items ?? [] } : null)
    expect(await useServiceStore.getState().duplicateCurrent("Copy", null)).toBe("created")
    const ids = sentItems().map((i) => String(i.id))
    expect(ids).not.toContain("i2")
    expect(useBroadcastStore.getState().liveItemId).toBe(ids[1])
    expect(useJournalStore.getState().entries[0].itemId).toBe(ids[1])
    expect(useBibleStore.getState().selectedSlide?.item.id).toBe(ids[0])
    // The original service is never written with the new ids.
    expect(mockInvoke.mock.calls.filter((c) => c[0] === "content_replace_items").every((c) => (c[1] as { programId: string }).programId !== program.id)).toBe(true)
    useBroadcastStore.setState({ liveItemId: null })
    useBibleStore.setState({ selectedSlide: null })
    useJournalStore.getState().clear()
  })

  it("a long slide line is shortened for the label only", () => {
    const words = "x".repeat(250)
    const out = toItemInputs([{ id: "s1", kind: "slide", slide: { title: "", body: words }, reference: words, confidence: 1, source: "manual", added_at: 0 } as never], () => "KJV")
    expect([...out[0].reference].length).toBe(200)
    expect(JSON.parse(out[0].payload!).body).toBe(words)
  })

  it("sends ids and the expected revision; a clean save clears dirty", async () => {
    await openStored()
    useQueueStore.getState().addItem(queueItem("Romans 8:28", 45, 8, 28))
    mockInvoke.mockImplementation(async (cmd: string) => (cmd === "content_replace_items" ? savedResponse(2) : null))
    expect(await useServiceStore.getState().saveCurrent()).toBe("saved")
    const call = mockInvoke.mock.calls.find((c) => c[0] === "content_replace_items")!
    const args = call[1] as { expectedRevision: number; items: Array<{ id: string }> }
    expect(args.expectedRevision).toBe(1)
    expect(args.items.map((i) => i.id)).toContain("i1")
    expect(args.items).toHaveLength(3)
    expect(useServiceStore.getState()).toMatchObject({ dirty: false, saving: false })
    expect(useServiceStore.getState().current?.revision).toBe(2)
  })

  it("an edit made while a save is in flight is not marked as saved", async () => {
    await openStored()
    useQueueStore.getState().addItem(queueItem("Romans 8:28", 45, 8, 28))
    const d = deferred<ProgramWithItems>()
    mockInvoke.mockImplementation((cmd: string) => (cmd === "content_replace_items" ? d.promise : Promise.resolve(null)))
    const saving = useServiceStore.getState().saveCurrent()
    expect(useServiceStore.getState().saving).toBe(true)
    // The operator keeps editing while the save runs.
    useQueueStore.getState().addItem(queueItem("Hebrews 11:1", 58, 11, 1))
    d.resolve(savedResponse(2))
    expect(await saving).toBe("saved")
    expect(useServiceStore.getState().current?.revision).toBe(2)
    expect(useServiceStore.getState().dirty).toBe(true)
    // Saving again persists the late edit and comes back clean.
    mockInvoke.mockImplementation(async (cmd: string) => (cmd === "content_replace_items" ? savedResponse(3) : null))
    expect(await useServiceStore.getState().saveCurrent()).toBe("saved")
    expect(useServiceStore.getState().dirty).toBe(false)
  })

  it("a revision conflict keeps the work dirty and records the conflict", async () => {
    await openStored()
    useQueueStore.getState().addItem(queueItem("Romans 8:28", 45, 8, 28))
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "content_replace_items") throw { kind: "conflict", message: "conflict", expected: 1, actual: 4 }
      return null
    })
    expect(await useServiceStore.getState().saveCurrent()).toBe("conflict")
    const s = useServiceStore.getState()
    expect(s.dirty).toBe(true)
    expect(s.conflict).toEqual({ expected: 1, actual: 4 })
    expect(s.current?.revision).toBe(1)
    expect(useQueueStore.getState().items).toHaveLength(3)
  })

  it("refuses to save a service that holds items this build cannot edit", async () => {
    const data: ProgramWithItems = {
      program,
      items: [item("ok", "John 3:16", 43, 3, 16), item("song", "Amazing Grace", 0, 0, 0, { kind: "song", book_number: null, chapter: null, verse: null })],
    }
    mockInvoke.mockImplementation(async (cmd: string) => (cmd === "content_get_program" ? data : null))
    expect(await useServiceStore.getState().openProgram("p1")).toBe("ok")
    expect(useServiceStore.getState().unsupportedItems).toHaveLength(1)
    useQueueStore.getState().addItem(queueItem("Romans 8:28", 45, 8, 28))
    expect(await useServiceStore.getState().saveCurrent()).toBe("unsupported")
    expect(mockInvoke.mock.calls.some((c) => c[0] === "content_replace_items")).toBe(false)
    expect(useServiceStore.getState().error).toMatch(/cannot edit/)
  })
})

describe("createFromRundown", () => {
  it("saves a zero-moment event when creating a service from an event-only rundown", async () => {
    useQueueStore.setState({
      items: [],
      headers: [{ id: "prayer", type: "group", name: "Opening Prayer", at: 0, event: { schema_version: 1, role: "Prayer" } }],
    })
    mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "content_create_program") return { ...program, id: "new", revision: 1, item_count: 0 }
      if (cmd === "content_replace_items") {
        const rows = args?.items as ProgramItem[]
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({ kind: "group", reference: "Opening Prayer" })
        expect(rows[0].id).not.toBe("prayer") // a new service receives its own event-row id
        expect(JSON.parse(String(rows[0].payload))).toMatchObject({ run_of_show_event: { schema_version: 1, role: "Prayer" } })
        return { ...savedResponse(2, []), program: { ...program, id: "new", revision: 2, item_count: 1 } }
      }
      return null
    })

    expect(await useServiceStore.getState().createFromRundown("Service draft", "2026-10-26")).toBe("created")
    expect(mockInvoke.mock.calls.some(([cmd]) => cmd === "content_replace_items")).toBe(true)
    expect(useServiceStore.getState()).toMatchObject({ current: { id: "new", revision: 2 }, dirty: false })
  })

  it("reports created_unsaved when the initial save fails, and stays dirty", async () => {
    useQueueStore.setState({ items: [queueItem("John 3:16", 43, 3, 16)] })
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "content_create_program") return { ...program, id: "new", revision: 1, item_count: 0 }
      if (cmd === "content_replace_items") throw { kind: "database", message: "disk full" }
      return null
    })
    expect(await useServiceStore.getState().createFromRundown("Sunday", null)).toBe("created_unsaved")
    const s = useServiceStore.getState()
    expect(s.current?.id).toBe("new")
    expect(s.dirty).toBe(true)
    expect(s.error).toMatch(/disk full/)
  })

  it("reports created when the rundown is saved", async () => {
    useQueueStore.setState({ items: [queueItem("John 3:16", 43, 3, 16)] })
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "content_create_program") return { ...program, id: "new", revision: 1, item_count: 0 }
      if (cmd === "content_replace_items") return { ...savedResponse(2), program: { ...program, id: "new", revision: 2, item_count: 1 } }
      return null
    })
    expect(await useServiceStore.getState().createFromRundown("Sunday", null)).toBe("created")
    expect(useServiceStore.getState()).toMatchObject({ dirty: false })
    expect(useServiceStore.getState().current?.revision).toBe(2)
  })

  it("renames and re-dates the open service without touching unsaved edits; a stale revision is a conflict", async () => {
    useServiceStore.setState({ current: { ...program }, dirty: true, programs: [] } as never)
    mockInvoke.mockImplementation(async (cmd: string, a: Record<string, unknown>) => {
      if (cmd === "content_update_program") return { ...program, title: a.title, service_date: a.serviceDate, revision: 2 }
      if (cmd === "content_list_programs") return []
      return null
    })
    expect(await useServiceStore.getState().updateDetails("Sunday 9 am", "2026-11-01")).toBe("ok")
    expect(mockInvoke).toHaveBeenCalledWith("content_update_program", { id: "p1", expectedRevision: 1, title: "Sunday 9 am", serviceDate: "2026-11-01" })
    expect(useServiceStore.getState().current).toMatchObject({ title: "Sunday 9 am", service_date: "2026-11-01", revision: 2 })
    expect(useServiceStore.getState().dirty).toBe(true)

    mockInvoke.mockImplementation(async () => { throw { kind: "conflict", message: "revision 3, expected 2" } })
    expect(await useServiceStore.getState().updateDetails("Other", null)).toBe("conflict")
    expect(useServiceStore.getState().current?.title).toBe("Sunday 9 am")
  })

  it("starts a new service from a template: the template's items with fresh ids, the template untouched", async () => {
    const template: ProgramWithItems = { program: { ...program, id: "tpl", title: "9 am", is_template: true }, items: [item("i1", "John 3:16", 43, 3, 16)] }
    const calls: Array<[string, Record<string, unknown>]> = []
    mockInvoke.mockImplementation(async (cmd: string, a: Record<string, unknown>) => {
      calls.push([cmd, a])
      if (cmd === "content_get_program") return a.id === "tpl" ? template : { program: { ...program, id: "new", revision: 2 }, items: [item("n1", "John 3:16", 43, 3, 16, { program_id: "new" })] }
      if (cmd === "content_create_program") return { ...program, id: "new", title: a.title, service_date: a.serviceDate, revision: 1 }
      if (cmd === "content_replace_items") return { program: { ...program, id: "new", revision: 2 }, items: (a.items as Array<{ id: string }>).map((x, n) => item(x.id, "John 3:16", 43, 3, 16, { program_id: "new", position: n })) }
      if (cmd === "content_list_programs") return []
      return null
    })
    useServiceStore.setState({ current: null, dirty: false } as never)
    expect(await useServiceStore.getState().newFromTemplate("tpl", "Sunday 25th", "2026-10-25")).toBe("created")
    const saved = calls.find(([c]) => c === "content_replace_items")!
    expect(saved[1].programId).toBe("new")
    expect((saved[1].items as Array<{ id: string }>)[0].id).not.toBe("i1")
    expect(calls.some(([c, a]) => c === "content_replace_items" && a.programId === "tpl")).toBe(false)
    expect(useServiceStore.getState().current?.id).toBe("new")
  })

  it("a template that cannot be fully copied, or a failed create, leaves the template and the screen alone", async () => {
    const template: ProgramWithItems = { program: { ...program, id: "tpl", is_template: true }, items: [item("i1", "John 3:16", 43, 3, 16), item("x", "?", 0, 0, 0, { kind: "future_kind" })] }
    const writes: string[] = []
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "content_get_program") return template
      if (cmd === "content_create_program" || cmd === "content_replace_items") { writes.push(cmd); throw { kind: "database", message: "disk full" } }
      return null
    })
    useQueueStore.setState({ items: [], activeIndex: null })
    useServiceStore.setState({ current: null, dirty: false } as never)
    expect(await useServiceStore.getState().newFromTemplate("tpl", "New", null)).toBe("failed")
    expect(useServiceStore.getState().error).toContain("cannot copy")
    expect(writes).toEqual([])

    template.items = [item("i1", "John 3:16", 43, 3, 16)]
    expect(await useServiceStore.getState().newFromTemplate("tpl", "New", null)).toBe("failed")
    expect(useQueueStore.getState().items).toEqual([])
    expect(useServiceStore.getState().current).toBeNull()
    expect(writes).toEqual(["content_create_program"])
  })

  it("saves and reopens an item's end-by time; a bad one is dropped", () => {
    const v: VerseQueueItem = { id: "e1", verse: { id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 3, verse: 16, text: "" }, reference: "John 3:16", confidence: 1, source: "manual", added_at: 0, end_by: "12:15", planned_minutes: 20 }
    const [input] = toItemInputs([v, { ...v, id: "e2", end_by: "9:99" }])
    expect(JSON.parse(input.payload ?? "{}")).toMatchObject({ end_by: "12:15", planned_minutes: 20 })
    expect(JSON.parse(toItemInputs([{ ...v, end_by: "9:99" }])[0].payload ?? "{}").end_by).toBeUndefined()
    const reopened = toQueueItems({ program, items: [item("e1", "John 3:16", 43, 3, 16, { payload: input.payload ?? null })] }, 1, [])
    expect(reopened.items[0].end_by).toBe("12:15")
    expect(rundownSignature([v])).not.toBe(rundownSignature([{ ...v, end_by: "12:30" }]))
  })

  it("saves and reopens a fixed start and a pause before (#196 R3); bad ones are dropped, old items unchanged", () => {
    const v: VerseQueueItem = { id: "f1", verse: { id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 3, verse: 16, text: "" }, reference: "John 3:16", confidence: 1, source: "manual", added_at: 0, starts_at: "10:30", gap_minutes: 5 }
    const [input] = toItemInputs([v])
    expect(JSON.parse(input.payload ?? "{}")).toMatchObject({ starts_at: "10:30", gap_minutes: 5 })
    expect(JSON.parse(toItemInputs([{ ...v, starts_at: "25:00", gap_minutes: -1 }])[0].payload ?? "{}")).toEqual({})
    const reopened = toQueueItems({ program, items: [item("f1", "John 3:16", 43, 3, 16, { payload: input.payload ?? null })] }, 1, [])
    expect(reopened.items[0]).toMatchObject({ starts_at: "10:30", gap_minutes: 5 })
    expect(reopened.items[0].payload_extra).toBeUndefined()
    const old = toQueueItems({ program, items: [item("f2", "John 3:16", 43, 3, 16, { payload: '{"planned_minutes":5}' })] }, 1, [])
    expect("starts_at" in old.items[0] || "gap_minutes" in old.items[0]).toBe(false)
    expect(rundownSignature([v])).not.toBe(rundownSignature([{ ...v, starts_at: null }]))
    expect(rundownSignature([v])).not.toBe(rundownSignature([{ ...v, gap_minutes: 2 }]))
  })

  it("saves and reopens who prepares an item (CL-007), and it counts as an unsaved change", () => {
    const v: VerseQueueItem = { id: "o1", verse: { id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 3, verse: 16, text: "" }, reference: "John 3:16", confidence: 1, source: "manual", added_at: 0, prepared_by: "  Tolu (music)  " }
    const [input] = toItemInputs([v])
    expect(JSON.parse(input.payload ?? "{}").prepared_by).toBe("Tolu (music)")
    const reopened = toQueueItems({ program, items: [item("o1", "John 3:16", 43, 3, 16, { payload: input.payload ?? null })] }, 1, [])
    expect(reopened.items[0].prepared_by).toBe("Tolu (music)")
    expect(rundownSignature([v])).not.toBe(rundownSignature([{ ...v, prepared_by: "Ade" }]))
    expect(cleanName("Tolu\tMusic\n")).toBe("Tolu Music")
    expect(Array.from(cleanName("a" + "😀".repeat(80)))).toHaveLength(60)
  })

  it("saves and reopens an item's people (#299 6.10), with the joined names as 'prepared by' for older builds", () => {
    const v: VerseQueueItem = { id: "a1", verse: { id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 3, verse: 16, text: "" }, reference: "John 3:16", confidence: 1, source: "manual", added_at: 0, assignees: ["Tolu", " Ade ", "tolu"], prepared_by: "Tolu, Ade" }
    const [input] = toItemInputs([v])
    const payload = JSON.parse(input.payload ?? "{}")
    expect(payload).toMatchObject({ assignees: ["Tolu", "Ade"], prepared_by: "Tolu, Ade" })
    const reopened = toQueueItems({ program, items: [item("a1", "John 3:16", 43, 3, 16, { payload: input.payload ?? null })] }, 1, [])
    expect(reopened.items[0]).toMatchObject({ assignees: ["Tolu", "Ade"], prepared_by: "Tolu, Ade" })
    expect(reopened.items[0].payload_extra).toBeUndefined()
    expect(rundownSignature([v])).not.toBe(rundownSignature([{ ...v, assignees: ["Tolu"] }]))
    // An item from before assignees saves as it always did: no list is added.
    const [legacy] = toItemInputs([{ ...v, assignees: null, prepared_by: "Tolu (music)" }])
    expect(JSON.parse(legacy.payload ?? "{}")).toEqual({ prepared_by: "Tolu (music)" })
    // An older build changed only the "prepared by" line (and kept the list as it was): the line wins.
    const edited = JSON.stringify({ assignees: ["Tolu", "Ade"], prepared_by: "Bisi" })
    const fromOld = toQueueItems({ program, items: [item("a1", "John 3:16", 43, 3, 16, { payload: edited })] }, 1, [])
    expect(fromOld.items[0].prepared_by).toBe("Bisi")
    expect(fromOld.items[0].assignees).toBeUndefined()
    // Many names still give a "prepared by" line an older build can save (60 characters).
    const many = toItemInputs([{ ...v, assignees: Array.from({ length: 9 }, (_, n) => `Volunteer number ${n + 1}`) }])[0]
    const line = JSON.parse(many.payload ?? "{}").prepared_by as string
    expect(Array.from(line).length).toBeLessThanOrEqual(60)
    expect(line).toMatch(/^Volunteer number 1, Volunteer number 2 \+7$/)
  })

  it("saves and reopens team comments (CL-007), and a new comment counts as an unsaved change", () => {
    const v: VerseQueueItem = { id: "c1", verse: { id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 3, verse: 16, text: "" }, reference: "John 3:16", confidence: 1, source: "manual", added_at: 0, comments: [{ by: "Ade", at: "2026-10-21T10:00:00Z", text: "Read slowly\nthen pause" }] }
    const [input] = toItemInputs([v])
    expect(JSON.parse(input.payload ?? "{}").comments).toEqual([{ by: "Ade", at: "2026-10-21T10:00:00Z", text: "Read slowly\nthen pause" }])
    const reopened = toQueueItems({ program, items: [item("c1", "John 3:16", 43, 3, 16, { payload: input.payload ?? null })] }, 1, [])
    expect(reopened.items[0].comments).toEqual(v.comments)
    expect(rundownSignature([v])).not.toBe(rundownSignature([{ ...v, comments: [...(v.comments ?? []), { by: "Tolu", at: "2026-10-21T11:00:00Z", text: "ok" }] }]))
  })

  it("counts every saved field as a change (video loop/sound, slide link) and keeps payload fields it does not know (FR-03)", () => {
    const pic = { id: "m1", kind: "image", image: { media_id: "a".repeat(64), name: "Clip", fit: "cover" }, reference: "Clip", confidence: 1, source: "manual", added_at: 0, notes: null } as unknown as QueueItem
    expect(rundownSignature([pic])).not.toBe(rundownSignature([{ ...pic, image: { ...(pic as never as { image: object }).image, loop: true } } as unknown as QueueItem]))
    expect(rundownSignature([pic])).not.toBe(rundownSignature([{ ...pic, image: { ...(pic as never as { image: object }).image, sound: false } } as unknown as QueueItem]))
    const slide = { id: "s1", kind: "slide", slide: { title: "Give", body: "online", link: "https://example.org/give" }, reference: "Give", confidence: 1, source: "manual", added_at: 0, notes: null } as unknown as QueueItem
    expect(rundownSignature([slide])).not.toBe(rundownSignature([{ ...slide, slide: { title: "Give", body: "online" } } as unknown as QueueItem]))

    const payload = JSON.stringify({ title: "Hi", body: "There", transition: "fade", future: { x: 1 } })
    const reopened = toQueueItems({ program, items: [item("s2", "Hi", 0, 0, 0, { kind: "slide", book_number: null, chapter: null, verse: null, payload })] }, 1, [])
    const [input] = toItemInputs(reopened.items)
    expect(JSON.parse(input.payload ?? "{}")).toMatchObject({ title: "Hi", body: "There", transition: "fade", future: { x: 1 } })
  })

  it("an edit made while a load is running still counts as unsaved once the load ends", async () => {
    await openStored()
    useServiceStore.setState({ loading: true })
    useQueueStore.getState().removeItem(useQueueStore.getState().items[0].id)
    expect(useServiceStore.getState().dirty).toBe(false)
    useServiceStore.setState({ loading: false })
    expect(useServiceStore.getState().dirty).toBe(true)
  })

  it("a rundown kept after closing its service is not unsaved work; changing it, or building one with no service, is", async () => {
    await openStored()
    useServiceStore.getState().closeProgram()
    const current = useServiceStore.getState().current
    expect(unsavedScratch(useQueueStore.getState().items, current)).toBe(false)
    // Heard verses collected with no service open do not count.
    useQueueStore.getState().addItem({ ...(useQueueStore.getState().items[0] as VerseQueueItem), id: "heard", source: "ai-direct", verse: { ...(useQueueStore.getState().items[0] as VerseQueueItem).verse, verse: 99 } })
    expect(unsavedScratch(useQueueStore.getState().items, current)).toBe(false)
    useQueueStore.getState().removeItem(useQueueStore.getState().items[1].id)
    expect(unsavedScratch(useQueueStore.getState().items, current)).toBe(true)
    useQueueStore.getState().clearQueue()
    expect(unsavedScratch(useQueueStore.getState().items, current)).toBe(false) // nothing on screen, nothing to lose
  })

  it("a verse added and saved is pinned on screen too, so a later translation change does not move it (RG-06)", async () => {
    await openStored()
    const fresh: VerseQueueItem = { id: "new-v", verse: { id: 0, translation_id: 1, book_number: 66, book_name: "Revelation", book_abbreviation: "", chapter: 22, verse: 20, text: "" }, reference: "Revelation 22:20", confidence: 1, source: "manual", added_at: 0 }
    useQueueStore.getState().addItem(fresh)
    mockInvoke.mockImplementation(async (cmd: string, a: { items?: unknown[] }) => (cmd === "content_replace_items" ? { program: { ...stored.program, revision: 2 }, items: a.items } : null))
    expect(await useServiceStore.getState().saveCurrent()).toBe("saved")
    const onScreen = useQueueStore.getState().items.find((i) => i.id === "new-v") as VerseQueueItem
    expect(onScreen.translation).toBe("KJV")
    expect(useServiceStore.getState().dirty).toBe(false)
  })
})

describe("slideLabel", () => {
  it("keeps a page mark through saving, labelled by the page's own text", () => {
    expect(slideLabel({ title: "", body: "Notice line 7\nNotice line 8" }, " (3/4)")).toBe("Notice line 7 (3/4)")
    expect(slideLabel({ title: "Notices", body: "x" }, "Notices (2/4)")).toBe("Notices (2/4)")
    expect(slideLabel({ title: "Plan (1/2)", body: "" }, "Plan (1/2)")).toBe("Plan (1/2)")
    expect(slideLabel({ title: "", body: "" })).toBe("Slide")
    expect(slideLabel({ title: "", body: "", link: "https://church.example/give/" })).toBe("church.example/give")
    expect([...slideLabel({ title: "a".repeat(300), body: "" }, " (1/2)")].length).toBe(200)
    expect(slideLabel({ title: "a".repeat(300), body: "" }, " (1/2)").endsWith(" (1/2)")).toBe(true)
  })
})
