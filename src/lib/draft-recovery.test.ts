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
    useServiceStore.setState({ current: { ...program, revision: 4 } as Program })
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
    dismissDraft()
    await vi.advanceTimersByTimeAsync(0)
    expect(useDraftRecovery.getState().offer).toBeNull()
    expect(kept.has("draft")).toBe(false)
  })
})
