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
import { useBroadcastStore } from "./broadcast-store"
import type { OutlineHeader } from "@/lib/run-of-show"
import { useMediaStore } from "./media-store"

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
  const call = mockInvoke.mock.calls.filter((c) => c[0] === "content_replace_items" || c[0] === "content_replace_items_with_history").at(-1)!
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
  useBroadcastStore.setState({ isLive: false, liveVerse: null, liveItemId: null, liveSlide: null } as never)
  useServiceStore.setState({ programs: [], current: null, dirty: false, loading: false, saving: false, error: null, conflict: null, unsupportedItems: [], corruptItems: [], missingTranslations: [], approvedDesigns: null, approvedDesignRevision: null, approvedDesignsError: null })
  useMediaStore.setState({ assets: [], loading: false, loaded: true, error: null })
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

  it("round trips a zero-moment event with its stable id and metadata", () => {
    const event = {
      schema_version: 1 as const,
      role: "Prayer",
      duration_minutes: 15,
      ownership: "Pastor",
    }
    const headers = [{ id: "prayer-event", type: "group" as const, name: "Opening Prayer", at: 0, notes: "Start the stage countdown", event }]
    const saved = toItemInputs([], undefined, undefined, headers)
    expect(saved).toHaveLength(1)
    expect(saved[0].id).toBe(headers[0].id)

    const storedEvent = item(headers[0].id, saved[0].reference, 0, 0, 0, {
      kind: "group",
      book_number: null,
      chapter: null,
      verse: null,
      notes: saved[0].notes,
      payload: saved[0].payload,
      position: 0,
    })
    const reopened = toQueueItems({ program, items: [storedEvent] }, 1, [KJV])
    expect(reopened.unsupported).toEqual([])
    expect(reopened.items).toEqual([])
    expect(reopened.headers).toMatchObject(headers)
    expect(toItemInputs(reopened.items, undefined, undefined, reopened.headers)).toEqual(saved)
  })

  it("separates future item kinds from malformed known items and unreadable headers", () => {
    const data: ProgramWithItems = {
      program,
      items: [
        item("ok", "John 3:16", 43, 3, 16),
        item("song", "Amazing Grace", 0, 0, 0, { kind: "song", book_number: null, chapter: null, verse: null }),
        item("broken", "Nowhere 1:1", 0, 0, 0, { book_number: null }),
        item("future", "Future content", 0, 0, 0, { kind: "interactive_scene" }),
        item("broken-header", "Sermon", 0, 0, 0, { kind: "group", payload: "{not-json" }),
      ],
    }
    const { items, headers, unsupported, corrupt } = toQueueItems(data, 1, [KJV])
    expect(items.map((i) => i.id)).toEqual(["ok"])
    expect(unsupported.map((i) => i.id)).toEqual(["future"])
    expect(corrupt.map((i) => i.id)).toEqual(["song", "broken", "broken-header"])
    expect(headers).toMatchObject([{ id: "broken-header", name: "Sermon", type: "group" }])
  })

  it("preserves valid JSON header fields this version cannot interpret", () => {
    const phasePayload = {
      rule: "future_rule",
      role: "future_role",
      starts_at: "26:17",
      advance_seconds: -1,
      disabled: "yes",
      phase_extension: { preserve: true },
    }
    const groupPayload = {
      rule: "group_rule",
      starts_at: { mode: "custom" },
      advance_seconds: "custom",
      disabled: 1,
      group_extension: "preserve",
    }
    const data: ProgramWithItems = {
      program,
      items: [
        item("phase", "Pre-service", 0, 0, 0, { kind: "phase", book_number: null, chapter: null, verse: null, payload: JSON.stringify(phasePayload) }),
        item("verse", "John 3:16", 43, 3, 16),
        item("group", "Sermon", 0, 0, 0, { kind: "group", book_number: null, chapter: null, verse: null, payload: JSON.stringify(groupPayload) }),
      ],
    }

    const { items, headers, unsupported, corrupt } = toQueueItems(data, 1, [KJV])
    expect(unsupported).toEqual([])
    expect(corrupt).toEqual([])

    const savedHeaders = toItemInputs(items, undefined, undefined, headers).filter((saved) => saved.kind === "phase" || saved.kind === "group")
    expect(savedHeaders.map((saved) => saved.id)).toEqual(["phase", "group"])
    expect(savedHeaders.map((saved) => JSON.parse(saved.payload!))).toEqual([phasePayload, groupPayload])
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

describe("per-output scene assignments in saved services", () => {
  it("saves, closes and reopens a service with its shared scene and multiple screen overrides", async () => {
    const { sceneStep } = await import("@/lib/item-intent")
    const planned = {
      id: "sermon-moment",
      kind: "slide",
      slide: { title: "Sermon", body: "" },
      reference: "Sermon",
      confidence: 1,
      source: "manual",
      added_at: 0,
      on_take: [
        sceneStep("shared-scene"),
        sceneStep("sanctuary-scene", "main"),
        sceneStep("overflow-scene", "overflow"),
      ],
    } as QueueItem
    const current = { ...program, item_count: 1 }
    let persisted: ProgramWithItems | null = null
    useServiceStore.setState({ current, dirty: true })
    useQueueStore.setState({ items: [planned], headers: [], activeIndex: null })
    mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "content_replace_items") {
        const rows = args?.items as Array<Record<string, unknown>>
        const savedItems = rows.map((row, position): ProgramItem => ({
          id: String(row.id),
          program_id: current.id,
          position,
          kind: String(row.kind),
          reference: String(row.reference),
          book_number: typeof row.book_number === "number" ? row.book_number : null,
          chapter: typeof row.chapter === "number" ? row.chapter : null,
          verse: typeof row.verse === "number" ? row.verse : null,
          translation: typeof row.translation === "string" ? row.translation : null,
          secondary_translation: typeof row.secondary_translation === "string" ? row.secondary_translation : null,
          notes: typeof row.notes === "string" ? row.notes : null,
          payload: typeof row.payload === "string" ? row.payload : null,
        }))
        persisted = { program: { ...current, revision: 2 }, items: savedItems }
        return structuredClone(persisted)
      }
      if (cmd === "content_get_program") return persisted ? structuredClone(persisted) : null
      return null
    })

    expect(await useServiceStore.getState().saveCurrent()).toBe("saved")
    const payload = JSON.parse(String(sentItems()[0].payload)) as { on_take: string[] }
    expect(payload.on_take).toEqual([
      "scene.take:shared-scene",
      "scene.take:sanctuary-scene@main",
      "scene.take:overflow-scene@overflow",
    ])
    expect(useServiceStore.getState().closeProgram()).toBe("closed")
    expect(await useServiceStore.getState().openProgram(current.id)).toBe("ok")
    expect(useQueueStore.getState().items[0]).toMatchObject({ id: "sermon-moment", on_take: payload.on_take })
  })
})

describe("legacy audio service reopening", () => {
  it("checks local media metadata before decoding an older image row as an audio cue", async () => {
    const oldService: ProgramWithItems = {
      ...stored,
      items: [item("legacy-audio", "Walk-in", 0, 0, 0, { kind: "image", payload: '{"media_id":"walkin","fit":"cover"}' })],
    }
    useMediaStore.setState({ assets: [], loaded: false, loading: false, error: null })
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "content_get_program") return oldService
      if (command === "media_list") return [{ id: "walkin", kind: "audio", name: "Walk-in", file: "walk-in.mp3", hash: "hash", size: 10, mime: "audio/mpeg", width: null, height: null, duration_ms: null, source: "local", source_ref: "", original_path: "", created_at: "", path: "/media/walk-in.mp3", present: true }]
      return null
    })

    expect(await useServiceStore.getState().openProgram("p1")).toBe("ok")
    expect(mockInvoke).toHaveBeenCalledWith("media_list")
    expect(useQueueStore.getState().items[0]).toMatchObject({ kind: "audio", audio: { media_id: "walkin", name: "Walk-in" } })
  })

  it("refuses to guess at an old image row when the local media catalog cannot be checked", async () => {
    const oldService: ProgramWithItems = {
      ...stored,
      items: [item("legacy-audio", "Walk-in", 0, 0, 0, { kind: "image", payload: '{"media_id":"walkin","fit":"cover"}' })],
    }
    useMediaStore.setState({ assets: [], loaded: false, loading: false, error: null })
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "content_get_program") return oldService
      if (command === "media_list") throw new Error("media database unavailable")
      return null
    })

    expect(await useServiceStore.getState().openProgram("p1")).toBe("error")
    expect(useQueueStore.getState().items).toEqual([])
    expect(useServiceStore.getState().error).toContain("Could not check the local media library")
  })
})

describe("audio cue service saves", () => {
  it("saves, closes and reopens the cue with its stable id and local playback settings", async () => {
    const current = { ...program, item_count: 1, approved_revision: null }
    const cue: QueueItem = {
      id: "walkin-cue",
      kind: "audio",
      audio: { media_id: "walkin", name: "Walk-in", output_device_id: "usb-output", volume: 0.6, loop: true, fade_in_ms: 1500, fade_out_ms: 2500 },
      reference: "Walk-in",
      confidence: 1,
      source: "manual",
      added_at: 0,
      planned_minutes: 5,
    }
    let persisted: ProgramWithItems | null = null
    useServiceStore.setState({ current, dirty: true })
    useQueueStore.setState({ items: [cue], headers: [], activeIndex: null })
    mockInvoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "content_replace_items" || command === "content_replace_items_with_history") {
        const rows = args?.items as Array<Record<string, unknown>>
        persisted = {
          program: { ...current, revision: 2 },
          items: rows.map((row, position) => item(String(row.id), String(row.reference), 0, 0, 0, {
            position,
            kind: String(row.kind),
            book_number: null,
            chapter: null,
            verse: null,
            translation: null,
            secondary_translation: null,
            notes: typeof row.notes === "string" ? row.notes : null,
            payload: typeof row.payload === "string" ? row.payload : null,
          })),
        }
        return structuredClone(persisted)
      }
      if (command === "content_get_program") return persisted ? structuredClone(persisted) : null
      return null
    })

    expect(await useServiceStore.getState().saveCurrent()).toBe("saved")
    expect(JSON.parse(String(sentItems()[0].payload))).toMatchObject({ media_id: "walkin", output_device_id: "usb-output", volume: 0.6, loop: true, fade_in_ms: 1500, fade_out_ms: 2500, planned_minutes: 5 })
    expect(useServiceStore.getState().closeProgram()).toBe("closed")
    expect(await useServiceStore.getState().openProgram(current.id)).toBe("ok")
    expect(useQueueStore.getState().items[0]).toMatchObject({
      id: "walkin-cue",
      kind: "audio",
      audio: { media_id: "walkin", output_device_id: "usb-output", volume: 0.6, loop: true, fade_in_ms: 1500, fade_out_ms: 2500 },
      planned_minutes: 5,
    })
  })
})

describe("approved design revisions", () => {
  it("captures the scene and look revisions with the saved service approval", async () => {
    const [{ useBroadcastStore }, { newScene, SCENE_PRESETS }] = await Promise.all([
      import("@/stores/broadcast-store"),
      import("@/lib/scenes"),
    ])
    const broadcast = useBroadcastStore.getState()
    const theme = broadcast.themes[0]
    const scene = newScene("Sermon", SCENE_PRESETS[0])
    scene.layers[0] = { ...scene.layers[0], themeId: theme.id }
    useBroadcastStore.setState({ scenes: [scene] })
    const planned = { ...queueItem("John 3:16", 43, 3, 16), scene_id: scene.id, look_id: theme.id }
    useQueueStore.setState({ items: [planned], activeIndex: null })
    useServiceStore.setState({ current: { ...program, revision: 4 }, dirty: false })
    mockInvoke.mockImplementation(async (cmd: string) => cmd === "content_approve_program_with_designs" ? { ...program, revision: 4, approved_revision: 4 } : cmd === "media_list" ? [] : null)

    expect(await useServiceStore.getState().approve()).toBe("ok")

    const [, args] = mockInvoke.mock.calls.find(([cmd]) => cmd === "content_approve_program_with_designs")!
    const designs = (args as { designs: { scenes: Record<string, { scene: { updatedAt: number }; outputs: Record<string, { themes: Record<string, { id: string }> }> }>; looks: Record<string, { id: string }> } }).designs
    expect(designs.scenes[scene.id].scene.updatedAt).toBe(scene.updatedAt)
    expect(designs.scenes[scene.id].outputs.main.themes[theme.id].id).toBe(theme.id)
    expect(designs.looks[theme.id].id).toBe(theme.id)
    expect(useServiceStore.getState().approvedDesignRevision).toBe(4)
  })

  it("refuses to approve a service that names a scene missing from this computer", async () => {
    useQueueStore.setState({ items: [{ ...queueItem("John 3:16", 43, 3, 16), scene_id: "missing-scene" }], activeIndex: null })
    useServiceStore.setState({ current: { ...program, revision: 4 }, dirty: false })
    mockInvoke.mockImplementation(async (cmd: string) => cmd === "media_list" ? [] : null)

    expect(await useServiceStore.getState().approve()).toBe("error")
    expect(mockInvoke).not.toHaveBeenCalledWith("content_approve_program_with_designs", expect.anything())
    expect(useServiceStore.getState().error).toMatch(/Scene missing-scene is not on this computer/)
  })

  it("loads the approved scene/look manifest when reopening its service", async () => {
    const approvedProgram = { ...program, approved_revision: 2 }
    const manifest = { version: 1 as const, scenes: {}, looks: {}, media_ids: [] }
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "content_get_program") return { ...stored, program: approvedProgram }
      if (cmd === "content_approved_designs") return manifest
      if (cmd === "get_verse") return null
      return null
    })

    expect(await useServiceStore.getState().openProgram("p1")).toBe("ok")
    expect(useServiceStore.getState().approvedDesigns).toEqual(manifest)
    expect(useServiceStore.getState().approvedDesignRevision).toBe(2)
    expect(useServiceStore.getState().approvedDesignsError).toBeNull()
  })

  it("marks approvals made before scene/look snapshots as legacy", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "content_get_program") return { ...stored, program: { ...program, approved_revision: 2 } }
      if (cmd === "content_approved_designs") return null
      if (cmd === "get_verse") return null
      return null
    })

    expect(await useServiceStore.getState().openProgram("p1")).toBe("ok")
    expect(useServiceStore.getState().approvedDesigns).toBeNull()
    expect(useServiceStore.getState().approvedDesignsError).toMatch(/predates saved scene and look snapshots/)
  })
})

describe("approval refresh boundaries", () => {
  it("does not change active outputs when approval is refreshed", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const { newScene } = await import("@/lib/scenes")
    const scene = newScene("Synthetic release")
    const b = useBroadcastStore.getState()
    b.saveScene(scene)
    b.takeScene("main", scene.id)
    const taken = structuredClone(useBroadcastStore.getState().outputs)
    b.saveScene({ ...scene, background: "#112233" })
    useQueueStore.setState({ items: [{ ...queueItem("John 3:16", 43, 3, 16), scene_id: scene.id }] })
    useServiceStore.setState({ current: { ...program, approved_revision: 1 }, dirty: false })
    mockInvoke.mockImplementation(async (cmd: string) => cmd === "media_list" ? [] : cmd === "content_approve_program_with_designs" ? { ...program, revision: 2, approved_revision: 2 } : null)
    expect(await useServiceStore.getState().approve()).toBe("ok")
    expect(useBroadcastStore.getState().outputs).toEqual(taken)
    expect(useServiceStore.getState().approvedDesigns?.scenes[scene.id].scene.background).toBe("#112233")
    b.saveScene({ ...scene, background: "#ffffff" })
    expect(useServiceStore.getState().approvedDesigns?.scenes[scene.id].scene.background).toBe("#112233")
  })

  it("loads and saves a legacy approval without inventing a design manifest", async () => {
    const legacy = { ...stored, program: { ...program, approved_revision: 1 } }
    mockInvoke.mockImplementation(async (cmd: string) => cmd === "content_get_program" ? legacy : cmd === "content_replace_items" ? { ...legacy, program: { ...legacy.program, revision: 2 } } : null)
    expect(await useServiceStore.getState().openProgram(program.id)).toBe("ok")
    expect(await useServiceStore.getState().saveCurrent()).toBe("saved")
    expect(useServiceStore.getState().current?.approved_revision).toBe(1)
    expect(useServiceStore.getState().approvedDesigns).toBeNull()
    expect(sentItems()).toHaveLength(2)
  })

  it("does not replace a newer open service with a delayed approval response", async () => {
    const pending = deferred<unknown>()
    useServiceStore.setState({ current: program, dirty: false })
    mockInvoke.mockImplementation(async (cmd: string) => cmd === "media_list" ? [] : cmd === "content_approve_program_with_designs" ? pending.promise : null)
    const approving = useServiceStore.getState().approve()
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("content_approve_program_with_designs", expect.anything()))
    useServiceStore.setState({ current: { ...program, id: "other" } })
    pending.resolve({ ...program, approved_revision: 1 })
    expect(await approving).toBe("ok")
    expect(useServiceStore.getState().current?.id).toBe("other")
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
  it("New service from the items on screen gives them new ids (ids are unique across services), and the live marker follows", async () => {
    await openStored()
    const { useBroadcastStore } = await import("./broadcast-store")
    useBroadcastStore.setState({ liveItemId: "i1" })
    useServiceStore.getState().closeProgram()
    mockInvoke.mockImplementation(async (cmd: string, a?: { items?: ProgramItem[] }) =>
      cmd === "content_create_program" ? { ...program, id: "p2", revision: 1 } : cmd === "content_replace_items_with_history" ? { program: { ...program, id: "p2", revision: 2 }, items: a?.items ?? [] } : null)
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
      cmd === "content_create_program" ? { ...program, id: "p3", revision: 1 } : cmd === "content_replace_items_with_history" ? { program: { ...program, id: "p3", revision: 2 }, items: a?.items ?? [] } : null)
    expect(await useServiceStore.getState().duplicateCurrent("Copy", null)).toBe("created")
    const ids = sentItems().map((i) => String(i.id))
    expect(ids).not.toContain("i2")
    expect(useBroadcastStore.getState().liveItemId).toBe(ids[1])
    expect(useJournalStore.getState().entries[0].itemId).toBe(ids[1])
    expect(useBibleStore.getState().selectedSlide?.item.id).toBe(ids[0])
    // The original service is never written with the new ids.
    expect(mockInvoke.mock.calls.filter((c) => c[0] === "content_replace_items_with_history").every((c) => (c[1] as { programId: string }).programId !== program.id)).toBe(true)
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
      items: [item("ok", "John 3:16", 43, 3, 16), item("song", "Amazing Grace", 0, 0, 0, { kind: "future_song", book_number: null, chapter: null, verse: null })],
    }
    mockInvoke.mockImplementation(async (cmd: string) => (cmd === "content_get_program" ? data : null))
    expect(await useServiceStore.getState().openProgram("p1")).toBe("ok")
    expect(useServiceStore.getState().unsupportedItems).toHaveLength(1)
    useQueueStore.getState().addItem(queueItem("Romans 8:28", 45, 8, 28))
    expect(await useServiceStore.getState().saveCurrent()).toBe("unsupported")
    expect(mockInvoke.mock.calls.some((c) => c[0] === "content_replace_items")).toBe(false)
    expect(useServiceStore.getState().error).toMatch(/cannot edit/)
  })

  it("keeps unreadable saved items distinct and blocks save and copy without writing", async () => {
    const data: ProgramWithItems = {
      program,
      items: [
        item("ok", "John 3:16", 43, 3, 16),
        item("broken", "Welcome slide", 0, 0, 0, { kind: "slide", book_number: null, chapter: null, verse: null, payload: "{not-json" }),
        item("future", "New scene", 0, 0, 0, { kind: "interactive_scene" }),
      ],
    }
    mockInvoke.mockImplementation(async (cmd: string, args?: { id?: string }) => {
      if (cmd === "content_get_program" && args?.id === "p1") return data
      if (cmd === "content_get_program" && args?.id === "template") return { ...data, program: { ...program, id: "template", is_template: true } }
      return null
    })

    expect(await useServiceStore.getState().openProgram("p1")).toBe("ok")
    expect(useServiceStore.getState().corruptItems.map((saved) => saved.id)).toEqual(["broken"])
    expect(useServiceStore.getState().unsupportedItems.map((saved) => saved.id)).toEqual(["future"])

    expect(await useServiceStore.getState().createFromRundown("Partial copy", null, { discard: true })).toBe("failed")
    expect(useServiceStore.getState().error).toMatch(/cannot copy/)
    expect(await useServiceStore.getState().approve()).toBe("error")
    expect(useServiceStore.getState().error).toMatch(/could not read/)
    expect(await useServiceStore.getState().duplicateCurrent("Copy", null)).toBe("failed")
    expect(useServiceStore.getState().error).toMatch(/could not read/)
    expect(await useServiceStore.getState().newFromTemplate("template", "From template", null)).toBe("failed")
    expect(useServiceStore.getState().error).toMatch(/could not read/)
    useServiceStore.setState({ dirty: true })
    expect(await useServiceStore.getState().saveCurrent()).toBe("unsupported")
    expect(useServiceStore.getState().error).toMatch(/could not read/)
    expect(mockInvoke.mock.calls.some(([cmd]) =>
      cmd === "content_replace_items" || cmd === "content_create_program" || cmd === "content_approve_program_with_designs",
    )).toBe(false)
  })

  it("allows a validated template to create a new service beside an unreadable current service", async () => {
    const corruptService: ProgramWithItems = {
      program,
      items: [item("broken", "Welcome slide", 0, 0, 0, { kind: "slide", book_number: null, chapter: null, verse: null, payload: "{not-json" })],
    }
    const template: ProgramWithItems = {
      program: { ...program, id: "template", is_template: true },
      items: [item("template-verse", "John 3:16", 43, 3, 16, { program_id: "template" })],
    }
    const createdProgram = { ...program, id: "new", title: "From template", revision: 1 }
    mockInvoke.mockImplementation(async (cmd: string, args?: { id?: string; items?: ProgramItem[] }) => {
      if (cmd === "content_get_program" && args?.id === "p1") return corruptService
      if (cmd === "content_get_program" && args?.id === "template") return template
      if (cmd === "content_get_program" && args?.id === "new") {
        return { ...template, program: { ...createdProgram, revision: 2 }, items: template.items.map((row) => ({ ...row, id: "copied-verse", program_id: "new" })) }
      }
      if (cmd === "content_create_program") return createdProgram
      if (cmd === "content_replace_items_with_history") {
        return { program: { ...createdProgram, revision: 2, item_count: args?.items?.length ?? 0 }, items: args?.items ?? [] }
      }
      return null
    })

    expect(await useServiceStore.getState().openProgram("p1")).toBe("ok")
    expect(useServiceStore.getState().corruptItems.map((row) => row.id)).toEqual(["broken"])
    expect(await useServiceStore.getState().newFromTemplate("template", "From template", null)).toBe("created")
    expect(useServiceStore.getState().current?.id).toBe("new")
    expect(useServiceStore.getState().corruptItems).toEqual([])
    expect(mockInvoke.mock.calls.filter(([cmd]) => cmd === "content_replace_items_with_history").every(([, args]) => (args as { programId: string }).programId === "new")).toBe(true)
  })

  it("loads an unreadable row without changing the running Program", async () => {
    const data: ProgramWithItems = {
      program,
      items: [item("broken", "Welcome slide", 0, 0, 0, { kind: "slide", book_number: null, chapter: null, verse: null, payload: "{not-json" })],
    }
    const liveVerse = { kind: "slide", reference: "Current Program", lines: ["Keep this live"] }
    useBroadcastStore.setState({ isLive: true, liveItemId: "live-item", liveVerse, liveSlide: null } as never)
    mockInvoke.mockImplementation(async (cmd: string) => (cmd === "content_get_program" ? data : null))

    expect(await useServiceStore.getState().openProgram("p1")).toBe("ok")
    expect(useServiceStore.getState().corruptItems.map((saved) => saved.id)).toEqual(["broken"])
    expect(useBroadcastStore.getState()).toMatchObject({
      isLive: true,
      liveItemId: "live-item",
      liveVerse,
    })
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
      if (cmd === "content_replace_items_with_history") {
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
    expect(mockInvoke.mock.calls.some(([cmd]) => cmd === "content_replace_items_with_history")).toBe(true)
    expect(useServiceStore.getState()).toMatchObject({ current: { id: "new", revision: 2 }, dirty: false })
  })

  it("reports created_unsaved when the initial save fails, and stays dirty", async () => {
    useQueueStore.setState({ items: [queueItem("John 3:16", 43, 3, 16)] })
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "content_create_program") return { ...program, id: "new", revision: 1, item_count: 0 }
      if (cmd === "content_replace_items_with_history") throw { kind: "database", message: "disk full" }
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
      if (cmd === "content_replace_items_with_history") return { ...savedResponse(2), program: { ...program, id: "new", revision: 2, item_count: 1 } }
      return null
    })
    expect(await useServiceStore.getState().createFromRundown("Sunday", null)).toBe("created")
    expect(mockInvoke).toHaveBeenCalledWith("content_replace_items_with_history", expect.objectContaining({ programId: "new" }))
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
      if (cmd === "content_replace_items_with_history") return { program: { ...program, id: "new", revision: 2 }, items: (a.items as Array<{ id: string }>).map((x, n) => item(x.id, "John 3:16", 43, 3, 16, { program_id: "new", position: n })) }
      if (cmd === "content_list_programs") return []
      return null
    })
    useServiceStore.setState({ current: null, dirty: false } as never)
    expect(await useServiceStore.getState().newFromTemplate("tpl", "Sunday 25th", "2026-10-25")).toBe("created")
    const saved = calls.find(([c]) => c === "content_replace_items_with_history")!
    expect(saved[1].programId).toBe("new")
    expect((saved[1].items as Array<{ id: string }>)[0].id).not.toBe("i1")
    expect(calls.some(([c, a]) => c === "content_replace_items_with_history" && a.programId === "tpl")).toBe(false)
    expect(useServiceStore.getState().current?.id).toBe("new")
  })

  it("a template that cannot be fully copied, or a failed create, leaves the template and the screen alone", async () => {
    const template: ProgramWithItems = { program: { ...program, id: "tpl", is_template: true }, items: [item("i1", "John 3:16", 43, 3, 16), item("x", "?", 0, 0, 0, { kind: "future_kind" })] }
    const writes: string[] = []
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "content_get_program") return template
      if (cmd === "content_create_program" || cmd === "content_replace_items_with_history") { writes.push(cmd); throw { kind: "database", message: "disk full" } }
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
    expect(JSON.parse(input.payload ?? "{}").comments).toMatchObject([{ id: expect.stringMatching(/^legacy-/), by: "Ade", at: "2026-10-21T10:00:00Z", text: "Read slowly\nthen pause" }])
    const reopened = toQueueItems({ program, items: [item("c1", "John 3:16", 43, 3, 16, { payload: input.payload ?? null })] }, 1, [])
    expect(reopened.items[0].comments).toMatchObject(JSON.parse(input.payload ?? "{}").comments)
    expect(reopened.items[0].comments?.[0].id).toBe(JSON.parse(input.payload ?? "{}").comments[0].id)
    const tombstone = { id: "comment-1", by: "Ade", at: "2026-10-21T10:00:00Z", text: "Read slowly", deleted_by: "Ade", deleted_at: "2026-10-21T11:00:00Z" }
    const [deletedInput] = toItemInputs([{ ...v, comments: [tombstone] }])
    const deletedReopen = toQueueItems({ program, items: [item("c1", "John 3:16", 43, 3, 16, { payload: deletedInput.payload ?? null })] }, 1, [])
    expect(JSON.parse(deletedInput.payload ?? "{}").comments).toEqual([tombstone])
    expect(deletedReopen.items[0].comments).toEqual([tombstone])
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

  it("preserves reusable slide source identity while keeping service copy edits independent", () => {
    const sourceSlide = { id: "rs1", kind: "slide", slide: { title: "Welcome", body: "Library wording", source_asset_id: "source-1", source_revision: 4 }, reference: "Welcome", confidence: 1, source: "manual", added_at: 0 } as unknown as QueueItem
    const [saved] = toItemInputs([sourceSlide])
    expect(JSON.parse(saved.payload ?? "{}")).toMatchObject({ title: "Welcome", body: "Library wording", source_asset_id: "source-1", source_revision: 4 })

    const reopened = toQueueItems({ program, items: [item("rs1", "Welcome", 0, 0, 0, { kind: "slide", book_number: null, chapter: null, verse: null, payload: saved.payload ?? null })] }, 1, []).items[0]
    expect(reopened).toMatchObject({ slide: { source_asset_id: "source-1", source_revision: 4, body: "Library wording" } })
    if (reopened.kind !== "slide") throw new Error("expected a slide")
    const editedOccurrence = { ...reopened, slide: { ...reopened.slide, body: "This Sunday only" } }
    const [serviceCopy] = toItemInputs([editedOccurrence])
    expect(JSON.parse(serviceCopy.payload ?? "{}")).toMatchObject({ body: "This Sunday only", source_asset_id: "source-1", source_revision: 4 })
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
