import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ImageQueueItem, QueueItem, SlideQueueItem, Verse } from "@/types"

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
import { useApprovalGateStore } from "@/stores/approval-gate-store"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useMediaStore } from "@/stores/media-store"
import { useSoundStore } from "@/stores/sound-store"

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
    secondaryTranslationId: null,
    overrideServiceTranslations: false,
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
  useBroadcastStore.setState({
    outputs: useBroadcastStore.getState().outputs.map((output) => ({ ...output, language: "both" })),
  })
  useBroadcastStore.setState({ isLive: false, liveVerse: null, liveSourceVerse: null, liveItem: null, presentWarning: null })
  useQueueStore.setState({ items: [], activeIndex: null })
  useTakeAttemptStore.setState({ attempts: [] })
  useJournalStore.setState({ entries: [], startItemIds: null, added: 0, keptAt: 0 })
  useEventClock.setState({ mode: "screens", currentId: null })
  useApprovalGateStore.setState({ held: null, retry: null, acknowledged: [] })
  useServiceStore.setState({ current: null, dirty: false })
  useSettingsStore.setState({ requireApproval: false })
  useMediaStore.setState({ assets: [], loaded: false })
  useSoundStore.setState({ assetId: null, playing: false })
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

  it("does not require approval to Send to Live for a sound item", async () => {
    const audio: ImageQueueItem = {
      id: "audio",
      kind: "image",
      image: { media_id: "walkin", name: "Walk-in", fit: "cover" },
      reference: "Walk-in",
      confidence: 1,
      source: "manual",
      added_at: 0,
    }
    useServiceStore.setState({ current: { id: "sunday", title: "Sunday", revision: 1, approved_revision: null } as never })
    useSettingsStore.setState({ requireApproval: true })
    useQueueStore.setState({ items: [audio], activeIndex: null })
    useMediaStore.setState({ assets: [{ id: "walkin", kind: "audio", name: "Walk-in", present: true }] as never, loaded: true })
    useBibleStore.setState({ selectedSlide: { item: audio, index: 0 } })
    let playCalls = 0
    useSoundStore.setState({
      play: async () => {
        playCalls += 1
        return true
      },
    } as never)

    await remoteActions.sendToLive()

    expect(playCalls).toBe(1)
    expect(useApprovalGateStore.getState().held).toBeNull()
    expect(useQueueStore.getState().activeIndex).toBe(0)
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(useTakeAttemptStore.getState().attempts.at(-1)).toMatchObject({ itemId: "audio", status: "succeeded" })
  })

  it("does not require approval to Send to Live for a Bible-feed-only reading", async () => {
    const item: QueueItem = { ...queueItemFor(johnThreeSixteen), on_take: ["source.only"] }
    useServiceStore.setState({ current: { id: "sunday", title: "Sunday", revision: 1, approved_revision: null } as never })
    useSettingsStore.setState({ requireApproval: true })
    useQueueStore.setState({ items: [item], activeIndex: null })
    useBibleStore.setState({ selectedVerse: johnThreeSixteen })
    mockInvoke.mockImplementation(async (cmd: unknown) => (cmd === "get_verse" ? johnThreeSixteen : null))

    await remoteActions.sendToLive()

    expect(useApprovalGateStore.getState().held).toBeNull()
    expect(useQueueStore.getState().activeIndex).toBe(0)
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(useBroadcastStore.getState().sources.bible).toMatchObject({ on: true, itemId: item.id })
    expect(useTakeAttemptStore.getState().attempts.at(-1)).toMatchObject({ itemId: item.id, status: "succeeded" })
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
    useEventClock.setState({ mode: "screens", currentId: previous.id })

    let resolveVerse!: (verse: Verse | null) => void
    mockInvoke.mockImplementation((cmd: unknown) =>
      cmd === "get_verse" ? new Promise<Verse | null>((resolve) => { resolveVerse = resolve }) : Promise.resolve(null),
    )

    const taking = presentQueueItem(1)

    expect(useQueueStore.getState().activeIndex).toBe(0)
    expect(useEventClock.getState().currentId).toBe(previous.id)
    resolveVerse(johnThreeSixteen)
    await taking

    expect(useQueueStore.getState().activeIndex).toBe(1)
    expect(useEventClock.getState().currentId).toBe(next.id)
    expect(useBroadcastStore.getState().liveItemId).toBe(next.id)
  })

  it("does not advance the active item when the requested verse has no displayable text", async () => {
    const previous = queueItemFor(genesisOneOne)
    const emptyVerse = { ...johnThreeSixteen, text: "" }
    useQueueStore.setState({ items: [previous, queueItemFor(emptyVerse)], activeIndex: 0 })
    useEventClock.setState({ mode: "screens", currentId: previous.id })
    mockInvoke.mockResolvedValue(null)

    await presentQueueItem(1)

    expect(useQueueStore.getState().activeIndex).toBe(0)
    expect(useEventClock.getState().currentId).toBe(previous.id)
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(useBroadcastStore.getState().presentWarning).toContain("not shown")
    const { buildLiveState } = await import("@/lib/live-state")
    const snapshot = buildLiveState() as ReturnType<typeof buildLiveState> & { takeAttempts?: { itemId: string | null; status: string }[] }
    expect(snapshot.takeAttempts?.at(-1)).toMatchObject({ itemId: expect.any(String), status: "failed" })
  })

  it("holds an unapproved Take without moving the rundown or event clock until the operator retries", async () => {
    const previous = queueItemFor(genesisOneOne)
    const next = queueItemFor(johnThreeSixteen)
    useQueueStore.setState({ items: [previous, next], activeIndex: 0 })
    useServiceStore.setState({ current: { id: "sunday", title: "Sunday", revision: 1, approved_revision: null } as never })
    useEventClock.setState({ mode: "screens", currentId: previous.id })
    useSettingsStore.setState({ requireApproval: true })

    await presentQueueItem(1)

    expect(useQueueStore.getState().activeIndex).toBe(0)
    expect(useEventClock.getState().currentId).toBe(previous.id)
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(useTakeAttemptStore.getState().attempts.at(-1)).toMatchObject({ itemId: next.id, status: "awaiting_approval" })

    useApprovalGateStore.getState().presentAnyway()
    await vi.waitFor(() => expect(useQueueStore.getState().activeIndex).toBe(1))
    expect(useBroadcastStore.getState().liveItemId).toBe(next.id)
  })

  it("does not replay a held rundown Take after its item changes", async () => {
    const heldItem = queueItemFor(genesisOneOne)
    useQueueStore.setState({ items: [heldItem], activeIndex: null })
    useServiceStore.setState({ current: { id: "sunday", title: "Sunday", revision: 1, approved_revision: null } as never })
    useSettingsStore.setState({ requireApproval: true })

    await presentQueueItem(0)
    expect(useApprovalGateStore.getState().held?.id).toBe("sunday")
    useQueueStore.setState({
      items: [{ ...heldItem, verse: johnThreeSixteen, reference: "John 3:16" }],
    })

    useApprovalGateStore.getState().presentAnyway()
    await vi.waitFor(() => expect(useTakeAttemptStore.getState().attempts.at(-1)?.status).toBe("superseded"))

    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(useBroadcastStore.getState().liveVerse).toBeNull()
    expect(useQueueStore.getState().activeIndex).toBeNull()
  })

  it("requires approval again when the held service revision changes before retry", async () => {
    const heldItem = queueItemFor(genesisOneOne)
    useQueueStore.setState({ items: [heldItem], activeIndex: null })
    useServiceStore.setState({ current: { id: "sunday", title: "Sunday", revision: 1, approved_revision: null } as never })
    useSettingsStore.setState({ requireApproval: true })

    await presentQueueItem(0)
    expect(useApprovalGateStore.getState().held).toMatchObject({ id: "sunday", revision: 1 })

    useServiceStore.setState({ current: { id: "sunday", title: "Sunday", revision: 2, approved_revision: null } as never })
    useApprovalGateStore.getState().presentAnyway()
    await vi.waitFor(() => expect(useTakeAttemptStore.getState().attempts.at(-1)?.status).toBe("superseded"))

    expect(useApprovalGateStore.getState().acknowledged).not.toContain("sunday")
    mockInvoke.mockImplementation(async (cmd: unknown) => (cmd === "get_verse" ? genesisOneOne : null))

    await presentQueueItem(0)

    expect(useApprovalGateStore.getState().held).toMatchObject({ id: "sunday", revision: 2 })
    expect(useTakeAttemptStore.getState().attempts.at(-1)).toMatchObject({ itemId: heldItem.id, status: "awaiting_approval" })
    expect(useQueueStore.getState().activeIndex).toBeNull()
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })

  it("does not replay a held Take after the active Bible translation override changes", async () => {
    const heldItem = { ...queueItemFor(genesisOneOne), translation: "KJV", secondary_translation: "OYCB" }
    useQueueStore.setState({ items: [heldItem], activeIndex: null })
    useServiceStore.setState({ current: { id: "sunday", title: "Sunday", revision: 1, approved_revision: null } as never })
    useSettingsStore.setState({ requireApproval: true })
    useBibleStore.setState({
      selectedVerse: genesisOneOne,
      activeTranslationId: 2,
      secondaryTranslationId: null,
      overrideServiceTranslations: false,
      translations: [
        ...useBibleStore.getState().translations,
        { ...useBibleStore.getState().translations[0]!, id: 2, abbreviation: "OYCB", title: "Yoruba Bible", language: "yo" },
      ],
    })

    await remoteActions.sendToLive()
    expect(useApprovalGateStore.getState().held?.id).toBe("sunday")

    useBibleStore.setState({ overrideServiceTranslations: true })
    useApprovalGateStore.getState().presentAnyway()
    await vi.waitFor(() => expect(useTakeAttemptStore.getState().attempts.at(-1)?.status).toBe("superseded"))

    expect(useApprovalGateStore.getState().acknowledged).not.toContain("sunday")
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("does not replay a held Take after an output's bilingual language policy changes", async () => {
    const heldItem = { ...queueItemFor(genesisOneOne), translation: "KJV", secondary_translation: "OYCB" }
    useQueueStore.setState({ items: [heldItem], activeIndex: null })
    useServiceStore.setState({ current: { id: "sunday", title: "Sunday", revision: 1, approved_revision: null } as never })
    useSettingsStore.setState({ requireApproval: true })
    useBibleStore.setState({
      selectedVerse: genesisOneOne,
      translations: [
        ...useBibleStore.getState().translations,
        { ...useBibleStore.getState().translations[0]!, id: 2, abbreviation: "OYCB", title: "Yoruba Bible", language: "yo" },
      ],
    })
    const output = useBroadcastStore.getState().outputs[0]!
    useBroadcastStore.setState({ outputs: [{ ...output, language: "first" }] })

    await remoteActions.sendToLive()
    expect(useApprovalGateStore.getState().held?.id).toBe("sunday")

    useBroadcastStore.setState({ outputs: [{ ...output, language: "second" }] })
    useApprovalGateStore.getState().presentAnyway()
    await vi.waitFor(() => expect(useTakeAttemptStore.getState().attempts.at(-1)?.status).toBe("superseded"))

    expect(useApprovalGateStore.getState().acknowledged).not.toContain("sunday")
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it.each([
    ["active translation", () => useBibleStore.setState({ activeTranslationId: 2 })],
    ["secondary translation", () => useBibleStore.setState({ secondaryTranslationId: null })],
  ])("does not replay a held Take after the %s changes", async (_name, changePolicy) => {
    useServiceStore.setState({ current: { id: "sunday", title: "Sunday", revision: 1, approved_revision: null } as never })
    useSettingsStore.setState({ requireApproval: true })
    useBibleStore.setState({
      selectedVerse: genesisOneOne,
      activeTranslationId: 1,
      secondaryTranslationId: 2,
      translations: [
        ...useBibleStore.getState().translations,
        { ...useBibleStore.getState().translations[0]!, id: 2, abbreviation: "OYCB", title: "Yoruba Bible", language: "yo" },
      ],
    })

    await remoteActions.sendToLive()
    expect(useApprovalGateStore.getState().held?.id).toBe("sunday")

    changePolicy()
    useApprovalGateStore.getState().presentAnyway()
    await vi.waitFor(() => expect(useTakeAttemptStore.getState().attempts.at(-1)?.status).toBe("superseded"))

    expect(useApprovalGateStore.getState().acknowledged).not.toContain("sunday")
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("does not replay a held Take after a Bible translation becomes unavailable", async () => {
    useServiceStore.setState({ current: { id: "sunday", title: "Sunday", revision: 1, approved_revision: null } as never })
    useSettingsStore.setState({ requireApproval: true })
    useBibleStore.setState({
      selectedVerse: genesisOneOne,
      activeTranslationId: 1,
      secondaryTranslationId: 2,
      translations: [
        ...useBibleStore.getState().translations,
        { ...useBibleStore.getState().translations[0]!, id: 2, abbreviation: "OYCB", title: "Yoruba Bible", language: "yo" },
      ],
    })

    await remoteActions.sendToLive()
    expect(useApprovalGateStore.getState().held?.id).toBe("sunday")

    useBibleStore.setState({
      translations: useBibleStore.getState().translations.map((translation) =>
        translation.id === 2 ? { ...translation, is_downloaded: false } : translation,
      ),
    })
    useApprovalGateStore.getState().presentAnyway()
    await vi.waitFor(() => expect(useTakeAttemptStore.getState().attempts.at(-1)?.status).toBe("superseded"))

    expect(useApprovalGateStore.getState().acknowledged).not.toContain("sunday")
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("does not replay a held Take after its rundown item is removed", async () => {
    const heldItem = queueItemFor(genesisOneOne)
    useQueueStore.setState({ items: [heldItem], activeIndex: null })
    useServiceStore.setState({ current: { id: "sunday", title: "Sunday", revision: 1, approved_revision: null } as never })
    useSettingsStore.setState({ requireApproval: true })

    await presentQueueItem(0)
    useQueueStore.setState({ items: [], activeIndex: null })

    useApprovalGateStore.getState().presentAnyway()
    await vi.waitFor(() => expect(useTakeAttemptStore.getState().attempts.at(-1)?.status).toBe("superseded"))

    expect(useApprovalGateStore.getState().acknowledged).not.toContain("sunday")
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(useQueueStore.getState().activeIndex).toBeNull()
  })

  it("retries the same held rundown item at its new position after a reorder", async () => {
    const previous = queueItemFor(genesisOneOne)
    const heldItem = queueItemFor(johnThreeSixteen)
    useQueueStore.setState({ items: [previous, heldItem], activeIndex: null })
    useServiceStore.setState({ current: { id: "sunday", title: "Sunday", revision: 1, approved_revision: null } as never })
    useSettingsStore.setState({ requireApproval: true })

    await presentQueueItem(1)
    useQueueStore.setState({ items: [heldItem, previous], activeIndex: null })
    useApprovalGateStore.getState().presentAnyway()

    await vi.waitFor(() => expect(useQueueStore.getState().activeIndex).toBe(0))
    expect(useBroadcastStore.getState().liveItemId).toBe(heldItem.id)
  })

  it("does not replay a held verse after Preview changes while approval is pending", async () => {
    const heldItem = queueItemFor(genesisOneOne)
    const laterPreview = queueItemFor(johnThreeSixteen)
    useQueueStore.setState({ items: [heldItem, laterPreview], activeIndex: null })
    useServiceStore.setState({ current: { id: "sunday", title: "Sunday", revision: 1, approved_revision: null } as never })
    useSettingsStore.setState({ requireApproval: true })
    useBibleStore.getState().selectVerse(genesisOneOne)
    mockInvoke.mockImplementation(async (cmd: unknown, args: { verse?: number }) => {
      if (cmd !== "get_verse") return null
      return args.verse === genesisOneOne.verse ? genesisOneOne : johnThreeSixteen
    })

    await remoteActions.sendToLive()
    expect(useApprovalGateStore.getState().held?.id).toBe("sunday")
    useBibleStore.getState().selectVerse(johnThreeSixteen)

    useApprovalGateStore.getState().presentAnyway()
    await vi.waitFor(() => expect(useTakeAttemptStore.getState().attempts.at(-1)?.status).toBe("superseded"))

    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(useBroadcastStore.getState().liveVerse).toBeNull()
    expect(useQueueStore.getState().activeIndex).toBeNull()
  })

  it("does not replay a held Take after its queue routing changes", async () => {
    const heldItem: QueueItem = { ...queueItemFor(genesisOneOne), on_take: [] }
    useQueueStore.setState({ items: [heldItem], activeIndex: null })
    useServiceStore.setState({ current: { id: "sunday", title: "Sunday", revision: 1, approved_revision: null } as never })
    useSettingsStore.setState({ requireApproval: true })
    useBibleStore.setState({ selectedVerse: genesisOneOne })
    mockInvoke.mockImplementation(async (cmd: unknown) => (cmd === "get_verse" ? genesisOneOne : null))

    await remoteActions.sendToLive()
    expect(useApprovalGateStore.getState().held?.id).toBe("sunday")
    useQueueStore.setState({
      items: [{ ...heldItem, on_take: ["source.only"] }],
    })

    useApprovalGateStore.getState().presentAnyway()
    await vi.waitFor(() => expect(useTakeAttemptStore.getState().attempts.at(-1)?.status).toBe("superseded"))

    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(useBroadcastStore.getState().liveVerse).toBeNull()
    expect(useQueueStore.getState().activeIndex).toBeNull()
  })

  it("does not replay a held slide after Preview changes while approval is pending", async () => {
    const heldSlide: SlideQueueItem = {
      id: "held-slide",
      kind: "slide",
      slide: { title: "Welcome", body: "Original preview" },
      reference: "Welcome",
      confidence: 1,
      source: "manual",
      added_at: 0,
    }
    const laterPreview: SlideQueueItem = {
      id: "later-slide",
      kind: "slide",
      slide: { title: "Announcements", body: "Later preview" },
      reference: "Announcements",
      confidence: 1,
      source: "manual",
      added_at: 1,
    }
    useQueueStore.setState({ items: [heldSlide, laterPreview], activeIndex: null })
    useServiceStore.setState({ current: { id: "sunday", title: "Sunday", revision: 1, approved_revision: null } as never })
    useSettingsStore.setState({ requireApproval: true })
    useBibleStore.setState({ selectedSlide: { item: heldSlide, index: 0 } })

    await remoteActions.sendToLive()
    expect(useApprovalGateStore.getState().held?.id).toBe("sunday")
    useBibleStore.setState({ selectedSlide: { item: laterPreview, index: 0 } })

    useApprovalGateStore.getState().presentAnyway()
    await vi.waitFor(() => expect(useTakeAttemptStore.getState().attempts.at(-1)?.status).toBe("superseded"))

    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(useQueueStore.getState().activeIndex).toBeNull()
  })

  it("does not let an older pending Take commit after the latest Take fails", async () => {
    const previous = queueItemFor(genesisOneOne)
    const earlier = queueItemFor(johnThreeSixteen)
    const empty = queueItemFor({ ...johnThreeSixteen, verse: 17, text: "" })
    useQueueStore.setState({ items: [previous, earlier, empty], activeIndex: 0 })
    const pending = new Map<number, (verse: Verse | null) => void>()
    mockInvoke.mockImplementation((cmd: unknown, args: { verse?: number }) => {
      if (cmd !== "get_verse") return Promise.resolve(null)
      return new Promise<Verse | null>((resolve) => pending.set(args.verse ?? 0, resolve))
    })

    const earlierTake = presentQueueItem(1)
    const latestTake = presentQueueItem(2)
    pending.get(17)?.(null)
    await latestTake
    expect(useQueueStore.getState().activeIndex).toBe(0)
    expect(useTakeAttemptStore.getState().attempts.at(-1)).toMatchObject({ itemId: empty.id, status: "failed" })

    pending.get(16)?.(johnThreeSixteen)
    await earlierTake
    expect(useQueueStore.getState().activeIndex).toBe(0)
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(useTakeAttemptStore.getState().attempts.map((attempt) => attempt.status)).toEqual(["superseded", "failed"])
  })

  it("commits a successful in-flight Take by item ID after the rundown is reordered", async () => {
    const previous = queueItemFor(genesisOneOne)
    const next = queueItemFor(johnThreeSixteen)
    useQueueStore.setState({ items: [previous, next], activeIndex: 0 })
    let resolveVerse!: (verse: Verse | null) => void
    mockInvoke.mockImplementation((cmd: unknown) =>
      cmd === "get_verse" ? new Promise<Verse | null>((resolve) => { resolveVerse = resolve }) : Promise.resolve(null),
    )

    const taking = presentQueueItem(1)
    useQueueStore.setState({ items: [next, previous], activeIndex: 1 })
    resolveVerse(johnThreeSixteen)
    await taking

    expect(useQueueStore.getState().items[useQueueStore.getState().activeIndex ?? -1]?.id).toBe(next.id)
    expect(useQueueStore.getState().activeIndex).toBe(0)
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
