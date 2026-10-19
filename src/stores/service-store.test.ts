import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ProgramItem, ProgramWithItems, QueueItem } from "@/types"

const mockInvoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

import { useServiceStore, toItemInputs, toQueueItems, rundownSignature } from "./service-store"
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
  ...extra,
})

const stored: ProgramWithItems = {
  program,
  items: [item("i1", "Psalms 23:1", 19, 23, 1), item("i2", "John 3:16", 43, 3, 16)],
}

const queueItem = (ref: string, b: number, c: number, v: number): QueueItem => ({
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

async function openStored() {
  mockInvoke.mockImplementation(async (cmd: string) => (cmd === "content_get_program" ? stored : null))
  expect(await useServiceStore.getState().openProgram("p1")).toBe("ok")
}

beforeEach(() => {
  mockInvoke.mockReset()
  useQueueStore.setState({ items: [], activeIndex: null })
  useBibleStore.setState({ activeTranslationId: 1, translations: [{ id: 1, abbreviation: "KJV", title: "", language: "en", is_copyrighted: false, is_downloaded: true }] })
  useServiceStore.setState({ programs: [], current: null, dirty: false, loading: false, saving: false, error: null, conflict: null, unsupportedItems: [] })
})

describe("conversions", () => {
  it("keeps item ids and resolves translation abbreviations", () => {
    const items = [queueItem("Psalms 23:1", 19, 23, 1)]
    const out = toItemInputs(items, (id) => (id === 1 ? "KJV" : null))
    expect(out[0]).toEqual({ id: items[0].id, kind: "verse", reference: "Psalms 23:1", book_number: 19, chapter: 23, verse: 1, translation: "KJV", secondary_translation: null, notes: null })
  })

  it("stored items become rundown items with the stored id", () => {
    const { items, unsupported } = toQueueItems(stored, 1)
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
    const { items, unsupported } = toQueueItems(data, 1)
    expect(items.map((i) => i.id)).toEqual(["ok"])
    expect(unsupported.map((i) => i.id)).toEqual(["song", "broken"])
  })

  it("signature ignores verse text but not order or identity", () => {
    const a = [queueItem("A 1:1", 1, 1, 1), queueItem("B 2:2", 2, 2, 2)]
    const b = a.map((i) => ({ ...i, verse: { ...i.verse, text: "changed" } }))
    expect(rundownSignature(a)).toBe(rundownSignature(b))
    expect(rundownSignature([a[1], a[0]])).not.toBe(rundownSignature(a))
    expect(rundownSignature([{ ...a[0], id: "other" }, a[1]])).not.toBe(rundownSignature(a))
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
    const q = useQueueStore.getState().items
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
})
