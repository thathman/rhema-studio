import { beforeEach, describe, expect, it, vi } from "vitest"
import type { QueueItem, Verse } from "@/types"

const mockInvoke = vi.fn()

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))

import { presentQueueItem, remoteActions } from "./remote-actions"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { useTakeAttemptStore } from "@/stores/take-attempt-store"
import { useJournalStore } from "@/stores/journal-store"
import { useEventClock } from "@/stores/event-clock-store"

const johnThreeSixteen: Verse = {
  id: 26137,
  translation_id: 1,
  book_number: 43,
  book_name: "John",
  book_abbreviation: "Jn",
  chapter: 3,
  verse: 16,
  text: "For God so loved the world",
}

const genesisOneOne: Verse = {
  id: 1,
  translation_id: 1,
  book_number: 1,
  book_name: "Genesis",
  book_abbreviation: "Gen",
  chapter: 1,
  verse: 1,
  text: "In the beginning",
}

function queueItemFor(verse: Verse) {
  return {
    id: crypto.randomUUID(),
    verse,
    reference: `${verse.book_name} ${verse.chapter}:${verse.verse}`,
    confidence: 1,
    source: "manual" as const,
    added_at: Date.now(),
  }
}

beforeEach(() => {
  mockInvoke.mockReset()
  mockInvoke.mockResolvedValue(null)
  useBibleStore.setState({
    selectedVerse: null,
    selectedSlide: null,
    pendingNavigation: null,
    activeTranslationId: 1,
    translations: [
      {
        id: 1,
        abbreviation: "KJV",
        title: "King James Version",
        language: "en",
        is_copyrighted: false,
        is_downloaded: true,
      },
    ],
  })
  useBroadcastStore.setState({ isLive: false, liveVerse: null, liveSourceVerse: null, liveItem: null, presentWarning: null })
  useQueueStore.setState({ items: [], activeIndex: null })
  useTakeAttemptStore.setState({ attempts: [] })
  useJournalStore.setState({ entries: [], startItemIds: null, added: 0, keptAt: 0 })
  useEventClock.setState({ mode: "screens", currentId: null })
})

describe("remote next/prev/send_to_live go on air atomically (same semantics as the desktop buttons)", () => {
  it("next: off air until the verse arrives, then on air with it", async () => {
    useQueueStore.setState({ items: [queueItemFor(genesisOneOne)] })
    let resolve: (v: Verse | null) => void = () => {}
    mockInvoke.mockImplementation((cmd: unknown) =>
      cmd === "get_verse" ? new Promise<Verse | null>((r) => (resolve = r)) : Promise.resolve(null),
    )
    remoteActions.queueNext()
    expect(useBroadcastStore.getState().isLive).toBe(false)
    resolve(genesisOneOne)
    await vi.waitFor(() => expect(useBroadcastStore.getState().isLive).toBe(true))
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Genesis 1:1 (KJV)")
  })

  it("hide cancels a present that is still loading", async () => {
    useQueueStore.setState({ items: [queueItemFor(genesisOneOne)] })
    let resolve: (v: Verse | null) => void = () => {}
    mockInvoke.mockImplementation((cmd: unknown) =>
      cmd === "get_verse" ? new Promise<Verse | null>((r) => (resolve = r)) : Promise.resolve(null),
    )
    remoteActions.queueNext()
    remoteActions.toggleOnAir(false)
    resolve(genesisOneOne)
    await Promise.resolve()
    await Promise.resolve()
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(useBroadcastStore.getState().liveVerse).toBeNull()
  })

  it("send_to_live goes on air with the previewed verse", async () => {
    mockInvoke.mockImplementation(async (cmd: unknown) => (cmd === "get_verse" ? johnThreeSixteen : null))
    useBibleStore.setState({ selectedVerse: johnThreeSixteen })
    remoteActions.sendToLive()
    await vi.waitFor(() => expect(useBroadcastStore.getState().isLive).toBe(true))
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("John 3:16 (KJV)")
  })
})

describe("remoteActions.sendToLive", () => {
  it("presents the previewed verse on the live output", async () => {
    useBibleStore.setState({ selectedVerse: johnThreeSixteen })

    remoteActions.sendToLive()
    await vi.waitFor(() =>
      expect(useBroadcastStore.getState().liveVerse).not.toBeNull(),
    )

    expect(useBroadcastStore.getState().liveVerse?.reference).toBe(
      "John 3:16 (KJV)",
    )
  })

  it("does nothing when no verse is previewed", async () => {
    remoteActions.sendToLive()
    await Promise.resolve()

    expect(useBroadcastStore.getState().liveVerse).toBeNull()
    expect(mockInvoke).not.toHaveBeenCalledWith("get_verse", expect.anything())
  })
})

describe("remoteActions.addToQueue", () => {
  it("queues the previewed verse with the panel's payload", () => {
    useBibleStore.setState({ selectedVerse: johnThreeSixteen })

    remoteActions.addToQueue()

    const { items } = useQueueStore.getState()
    expect(items).toHaveLength(1)
    expect(items[0].reference).toBe("John 3:16")
    expect(items[0].source).toBe("manual")
    expect(items[0].confidence).toBe(1)
    expect(items[0].verse).toEqual(johnThreeSixteen)
  })

  it("is safe to press twice — the second press adds nothing", () => {
    useBibleStore.setState({ selectedVerse: johnThreeSixteen })

    remoteActions.addToQueue()
    remoteActions.addToQueue()

    expect(useQueueStore.getState().items).toHaveLength(1)
  })

  it("does nothing when no verse is previewed", () => {
    remoteActions.addToQueue()

    expect(useQueueStore.getState().items).toHaveLength(0)
  })
})

describe("remoteActions queue navigation", () => {
  it("clamps at the end of the queue", () => {
    useQueueStore.setState({
      items: [queueItemFor(genesisOneOne), queueItemFor(johnThreeSixteen)],
      activeIndex: 1,
    })

    remoteActions.queueNext()

    expect(useQueueStore.getState().activeIndex).toBe(1)
  })

  it("clamps at the start of the queue", () => {
    useQueueStore.setState({
      items: [queueItemFor(genesisOneOne), queueItemFor(johnThreeSixteen)],
      activeIndex: 0,
    })

    remoteActions.queuePrev()

    expect(useQueueStore.getState().activeIndex).toBe(0)
  })

  it("advances through the queue after its content is presented", async () => {
    useQueueStore.setState({
      items: [queueItemFor(genesisOneOne), queueItemFor(johnThreeSixteen)],
      activeIndex: 0,
    })

    await remoteActions.queueNext()

    expect(useQueueStore.getState().activeIndex).toBe(1)
  })

  it("remote Next skips hidden items and a disabled phase after presentation", async () => {
    const items = [
      queueItemFor(genesisOneOne),
      { ...queueItemFor(johnThreeSixteen), id: "hidden", hidden: true },
      { ...queueItemFor(johnThreeSixteen), id: "disabled-phase" },
      { ...queueItemFor(genesisOneOne), id: "following-phase" },
    ]
    useQueueStore.setState({
      items,
      activeIndex: 0,
      headers: [
        { id: "main", type: "phase", name: "Main", at: 0, rule: "manual" },
        { id: "disabled", type: "phase", name: "Disabled", at: 2, rule: "manual", disabled: true },
        { id: "following", type: "phase", name: "Following", at: 3, rule: "manual" },
      ],
    })

    await remoteActions.queueNext()

    expect(useQueueStore.getState().activeIndex).toBe(3)
  })

  it("does nothing on an empty queue", () => {
    remoteActions.queueNext()

    expect(useQueueStore.getState().activeIndex).toBeNull()
  })
})

describe("queue position follows successful Takes", () => {
  it("keeps the previous item active while a verse Take is pending, then commits it on success", async () => {
    const previous = queueItemFor(genesisOneOne)
    const next = queueItemFor(johnThreeSixteen)
    useQueueStore.setState({ items: [previous, next], activeIndex: 0 })

    let resolveVerse!: (verse: Verse | null) => void
    mockInvoke.mockImplementation((cmd: unknown) =>
      cmd === "get_verse" ? new Promise<Verse | null>((resolve) => { resolveVerse = resolve }) : Promise.resolve(null),
    )

    const taking = presentQueueItem(1)

    expect(useQueueStore.getState().activeIndex).toBe(0)
    resolveVerse(johnThreeSixteen)
    await taking

    expect(useQueueStore.getState().activeIndex).toBe(1)
    expect(useBroadcastStore.getState().liveItemId).toBe(next.id)
  })

  it("does not advance the active item when the requested verse has no displayable text", async () => {
    const previous = queueItemFor(genesisOneOne)
    const emptyVerse = { ...johnThreeSixteen, text: "" }
    useQueueStore.setState({ items: [previous, queueItemFor(emptyVerse)], activeIndex: 0 })
    mockInvoke.mockResolvedValue(null)

    await presentQueueItem(1)

    expect(useQueueStore.getState().activeIndex).toBe(0)
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(useBroadcastStore.getState().presentWarning).toContain("not shown")
    const { buildLiveState } = await import("@/lib/live-state")
    const snapshot = buildLiveState() as ReturnType<typeof buildLiveState> & { takeAttempts?: { itemId: string | null; status: string }[] }
    expect(snapshot.takeAttempts?.at(-1)).toMatchObject({ itemId: expect.any(String), status: "failed" })
  })

  it("publishes pending and completed Take status separately from the program and event clock", async () => {
    const { buildLiveState } = await import("@/lib/live-state")
    const { useEventClock } = await import("@/stores/event-clock-store")
    const previous = queueItemFor(genesisOneOne)
    const next = queueItemFor(johnThreeSixteen)
    useQueueStore.setState({ items: [previous, next], activeIndex: 0 })
    useEventClock.setState({ mode: "own", currentId: previous.id })

    let resolveVerse!: (verse: Verse | null) => void
    mockInvoke.mockImplementation((cmd: unknown) =>
      cmd === "get_verse" ? new Promise<Verse | null>((resolve) => { resolveVerse = resolve }) : Promise.resolve(null),
    )

    const taking = presentQueueItem(1)
    const pending = buildLiveState() as ReturnType<typeof buildLiveState> & { takeAttempts?: { itemId: string; status: string }[] }

    expect(pending.takeAttempts?.at(-1)).toMatchObject({ itemId: next.id, status: "pending" })
    expect(pending.program.onAir).toBe(false)
    expect(pending.event.currentId).toBe(previous.id)

    resolveVerse(johnThreeSixteen)
    await taking

    const completed = buildLiveState() as ReturnType<typeof buildLiveState> & { takeAttempts?: { itemId: string; status: string }[] }
    expect(completed.takeAttempts?.at(-1)).toMatchObject({ itemId: next.id, status: "succeeded" })
    expect(completed.program.reference).toBe("John 3:16 (KJV)")
    expect(completed.event.currentId).toBe(previous.id)
  })

  it("commits only the latest successful Take when an earlier verse lookup finishes late", async () => {
    const previous = queueItemFor(genesisOneOne)
    const first = queueItemFor(johnThreeSixteen)
    const nextVerse = { ...johnThreeSixteen, verse: 17, text: "For God sent not his Son" }
    const latest = queueItemFor(nextVerse)
    useQueueStore.setState({ items: [previous, first, latest], activeIndex: 0 })

    const pending = new Map<number, (verse: Verse | null) => void>()
    mockInvoke.mockImplementation((cmd: unknown, args: { verse?: number }) => {
      if (cmd !== "get_verse") return Promise.resolve(null)
      return new Promise<Verse | null>((resolve) => pending.set(args.verse ?? 0, resolve))
    })

    const firstTake = presentQueueItem(1)
    const latestTake = presentQueueItem(2)

    expect(useQueueStore.getState().activeIndex).toBe(0)
    pending.get(17)?.(nextVerse)
    await latestTake
    expect(useQueueStore.getState().activeIndex).toBe(2)
    expect(useBroadcastStore.getState().liveItemId).toBe(latest.id)

    pending.get(16)?.(johnThreeSixteen)
    await firstTake
    expect(useQueueStore.getState().activeIndex).toBe(2)
    expect(useBroadcastStore.getState().liveItemId).toBe(latest.id)
    const { buildLiveState } = await import("@/lib/live-state")
    const attempts = (buildLiveState() as ReturnType<typeof buildLiveState> & { takeAttempts?: { itemId: string; status: string }[] }).takeAttempts
    expect(attempts?.map((attempt) => [attempt.itemId, attempt.status])).toEqual([[first.id, "superseded"], [latest.id, "succeeded"]])
  })

  it("waits for a nonvisual audio Take and keeps the active item when playback fails", async () => {
    const { useMediaStore } = await import("@/stores/media-store")
    const { useSoundStore } = await import("@/stores/sound-store")
    const previous = queueItemFor(genesisOneOne)
    const soundItem = {
      id: "walk-in",
      kind: "image",
      image: { media_id: "audio-walk-in", name: "Walk-in", fit: "cover" },
      reference: "Walk-in",
      confidence: 1,
      source: "manual",
      added_at: 0,
    } as QueueItem
    const asset = { id: "audio-walk-in", kind: "audio", name: "Walk-in", file: "walk-in.mp3", hash: "a".repeat(64), size: 12, mime: "audio/mpeg", width: null, height: null, duration_ms: null, source: "local", source_ref: "", original_path: "", created_at: "", path: "/media/walk-in.mp3", present: true }
    useMediaStore.setState({ assets: [asset] as never, loaded: true })
    let failPlayback!: () => void
    useSoundStore.setState({
      assetId: null,
      playing: false,
      error: null,
      play: () => new Promise<void>((resolve) => {
        failPlayback = () => {
          useSoundStore.setState({ assetId: null, playing: false, error: "Walk-in could not play" })
          resolve()
        }
      }),
    } as never)
    useQueueStore.setState({ items: [previous, soundItem], activeIndex: 0 })

    const taking = presentQueueItem(1)

    expect(useQueueStore.getState().activeIndex).toBe(0)
    expect(useBroadcastStore.getState().isLive).toBe(false)
    failPlayback()
    await taking

    expect(useQueueStore.getState().activeIndex).toBe(0)
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })
})

it("Send to Live leaves the active rundown item alone when its selected verse cannot be shown", async () => {
  const previous = queueItemFor(genesisOneOne)
  const selected = { ...johnThreeSixteen, text: "" }
  useQueueStore.setState({ items: [previous, queueItemFor(selected)], activeIndex: 0 })
  useBibleStore.setState({ selectedVerse: selected })
  mockInvoke.mockResolvedValue(null)

  await remoteActions.sendToLive()

  expect(useQueueStore.getState().activeIndex).toBe(0)
  expect(useBroadcastStore.getState().isLive).toBe(false)
  expect(useBroadcastStore.getState().presentWarning).toContain("not shown")
  const { buildLiveState } = await import("@/lib/live-state")
  const snapshot = buildLiveState() as ReturnType<typeof buildLiveState> & { takeAttempts?: { itemId: string | null; status: string }[] }
  expect(snapshot.takeAttempts?.at(-1)).toMatchObject({ itemId: expect.any(String), status: "failed" })
})

describe("remoteActions bible navigation", () => {
  const johnThree = Array.from({ length: 10 }, (_, i) => ({
    ...johnThreeSixteen,
    id: 1000 + i,
    verse: i + 1,
  }))

  beforeEach(() => {
    useBibleStore.setState({
      currentChapter: johnThree,
      selectedVerse: johnThree[4], // John 3:5
      pendingNavigation: null,
      revealRequest: 0,
    })
  })

  it("steps the Bible panel forward one verse", async () => {
    await remoteActions.bibleNext()

    expect(useBibleStore.getState().selectedVerse?.verse).toBe(6)
  })

  it("steps the Bible panel back one verse", async () => {
    await remoteActions.biblePrev()

    expect(useBibleStore.getState().selectedVerse?.verse).toBe(4)
  })

  it("does not move the queue — that is the whole point of RC-04", async () => {
    useQueueStore.setState({
      items: [queueItemFor(genesisOneOne), queueItemFor(johnThreeSixteen)],
      activeIndex: 0,
    })

    await remoteActions.bibleNext()
    await remoteActions.biblePrev()

    expect(useQueueStore.getState().activeIndex).toBe(0)
    expect(useQueueStore.getState().items).toHaveLength(2)
  })

  it("does nothing with no chapter loaded and nothing selected", async () => {
    useBibleStore.setState({ currentChapter: [], selectedVerse: null })

    await remoteActions.bibleNext()

    expect(useBibleStore.getState().selectedVerse).toBeNull()
    expect(useBibleStore.getState().pendingNavigation).toBeNull()
  })
})

describe("remoteActions.toggleOnAir", () => {
  it("sets the live flag to the value it is given", () => {
    remoteActions.toggleOnAir(true)
    expect(useBroadcastStore.getState().isLive).toBe(true)

    remoteActions.toggleOnAir(false)
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })
})
