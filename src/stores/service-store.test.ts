import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ProgramItem, ProgramWithItems, VerseQueueItem } from "@/types"

const mockInvoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

import { useServiceStore, toItemInputs, toQueueItems, rundownSignature } from "./service-store"
import type { Translation } from "@/types"
import { useQueueStore } from "./queue-store"
import { useBibleStore } from "./bible-store"

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
      if (cmd === "content_get_program") return template
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
})
