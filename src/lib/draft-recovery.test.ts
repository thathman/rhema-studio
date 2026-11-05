import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
const kept = new Map<string, unknown>()
const fakeStore = {
  get: vi.fn(async (k: string) => kept.get(k)),
  set: vi.fn(async (k: string, v: unknown) => void kept.set(k, v)),
  delete: vi.fn(async (k: string) => kept.delete(k)),
  save: vi.fn(async () => {}),
}
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn(async () => fakeStore) }))

import { dismissDraft, parseKeptDraft, restoreDraft, startDraftRecovery, useDraftRecovery, type KeptDraft } from "./draft-recovery"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import type { Program, SlideQueueItem } from "@/types"

/** #411: unsaved Prepare edits survive a crash, offered (never applied) onto the version they were made from. */
const program = { id: "svc", title: "Sunday", revision: 3, approved_revision: null } as unknown as Program
const slide = (id: string): SlideQueueItem => ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0 })
const draft = (over: Partial<KeptDraft> = {}): KeptDraft => ({ v: 1, at: Date.now(), programId: "svc", title: "Sunday", revision: 3, items: [slide("a"), slide("edited")], headers: [], ...over })

let stop: () => void = () => {}
beforeEach(() => {
  vi.useFakeTimers()
  kept.clear()
  useQueueStore.setState({ items: [slide("a")], headers: [], activeIndex: null })
  useServiceStore.setState({ current: program, dirty: false })
  useDraftRecovery.setState({ offer: null, error: null })
})
afterEach(() => {
  stop()
  vi.useRealTimers()
})

describe("unsaved Prepare edits survive a crash (#411)", () => {
  it("keeps the open service's unsaved running order, and drops it once saved", async () => {
    stop = await startDraftRecovery(false)
    useQueueStore.setState({ items: [slide("a"), slide("new")] })
    useServiceStore.setState({ dirty: true })
    await vi.advanceTimersByTimeAsync(2500)
    expect(parseKeptDraft(kept.get("draft"))?.items.map((i) => i.id)).toEqual(["a", "new"])
    useServiceStore.setState({ dirty: false })
    await vi.advanceTimersByTimeAsync(2500)
    expect(kept.has("draft")).toBe(false)
  })

  it("offers the kept edits only after an unclean exit, and drops a stale copy after a clean one", async () => {
    kept.set("draft", draft())
    stop = await startDraftRecovery(false)
    expect(useDraftRecovery.getState().offer).toBeNull()
    expect(kept.has("draft")).toBe(false)
    stop()
    kept.set("draft", draft())
    stop = await startDraftRecovery(true)
    expect(useDraftRecovery.getState().offer?.title).toBe("Sunday")
  })

  it("puts the edits back, unsaved, onto the same version; never onto a newer one", async () => {
    kept.set("draft", draft())
    stop = await startDraftRecovery(true)
    expect(await restoreDraft()).toBe(true)
    expect(useQueueStore.getState().items.map((i) => i.id)).toEqual(["a", "edited"])
    expect(useDraftRecovery.getState().offer).toBeNull()

    useQueueStore.setState({ items: [slide("a")] })
    // Restored edits are unsaved; start the next case from a clean, newer version.
    useServiceStore.setState({ current: { ...program, revision: 4 } as Program, dirty: false })
    useDraftRecovery.setState({ offer: draft() })
    expect(await restoreDraft()).toBe(false)
    expect(useDraftRecovery.getState().error).toContain("saved again since these edits")
    expect(useQueueStore.getState().items.map((i) => i.id)).toEqual(["a"])
  })

  it("ignores a damaged copy, and Discard drops it", async () => {
    expect(parseKeptDraft({ v: 1, programId: "svc", items: "nope" })).toBeNull()
    expect(parseKeptDraft({ ...draft(), items: [{ kind: "slide" }] })).toBeNull()
    kept.set("draft", draft())
    stop = await startDraftRecovery(true)
    expect(kept.has("offered")).toBe(true)
    dismissDraft()
    await vi.advanceTimersByTimeAsync(0)
    expect(useDraftRecovery.getState().offer).toBeNull()
    expect(kept.has("offered")).toBe(false)
  })

  it("keeps a verse item whose kind is left out (search and detection add them that way)", () => {
    const verse = { id: "v", reference: "John 3:16", verse: { book_number: 43, chapter: 3, verse: 16, translation_id: 1 }, confidence: 1, source: "search", added_at: 0 }
    expect(parseKeptDraft({ ...draft(), items: [verse] })?.items).toHaveLength(1)
  })

  it("after a second crash offers the newer edits, and drops an offer a week old", async () => {
    kept.set("offered", draft({ at: Date.now() - 60_000, items: [slide("older")] }))
    kept.set("draft", draft({ at: Date.now(), items: [slide("newer")] }))
    stop = await startDraftRecovery(true)
    expect(useDraftRecovery.getState().offer?.items.map((i) => i.id)).toEqual(["newer"])
    stop()
    kept.clear()
    kept.set("offered", draft({ at: Date.now() - 8 * 24 * 60 * 60 * 1000 }))
    useDraftRecovery.setState({ offer: null })
    stop = await startDraftRecovery(false)
    expect(useDraftRecovery.getState().offer).toBeNull()
    expect(kept.has("offered")).toBe(false)
  })

  it("rejects an item missing what its kind needs", () => {
    expect(parseKeptDraft({ ...draft(), items: [{ id: "v", kind: "verse", reference: "John 3:16" }] })).toBeNull()
    expect(parseKeptDraft({ ...draft(), items: [{ id: "x", kind: "unknown", reference: "x" }] })).toBeNull()
  })

  it("keeps an offered copy while it waits for an answer, through the next start-up and another crash", async () => {
    kept.set("draft", draft())
    stop = await startDraftRecovery(true)
    // Start-up reopens the last service (clean): the working copy goes, the offered one stays.
    useServiceStore.setState({ current: { ...program } as Program, dirty: false })
    await vi.advanceTimersByTimeAsync(2500)
    expect(parseKeptDraft(kept.get("offered"))?.items.map((i) => i.id)).toEqual(["a", "edited"])
    stop()
    // Crashed again before answering: the same edits are offered again.
    useDraftRecovery.setState({ offer: null })
    stop = await startDraftRecovery(true)
    expect(useDraftRecovery.getState().offer?.items.map((i) => i.id)).toEqual(["a", "edited"])
  })

  it("never replaces unsaved changes made since start-up without asking", async () => {
    kept.set("draft", draft())
    stop = await startDraftRecovery(true)
    useQueueStore.setState({ items: [slide("a"), slide("made-since")] })
    useServiceStore.setState({ dirty: true })
    expect(await restoreDraft()).toBe(false)
    expect(useDraftRecovery.getState().error).toContain("Save or discard")
    expect(useQueueStore.getState().items.map((i) => i.id)).toEqual(["a", "made-since"])
  })
})
