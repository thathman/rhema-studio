import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BroadcastOutput, CountdownFrame, QueueItem, StagePayload } from "@/types"
import type { OutlineHeader } from "@/lib/run-of-show"

const invoke = vi.fn<(...args: unknown[]) => Promise<null>>(async () => null)
const emitTo = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo }))

const { updateStageFinish } = await import("./stage-finish")
const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useQueueStore } = await import("@/stores/queue-store")
const { useJournalStore } = await import("@/stores/journal-store")
const { useEventClock } = await import("@/stores/event-clock-store")
const { useTimerStore } = await import("@/stores/timer-store")
const { useAuxTimers } = await import("@/stores/aux-timers-store")
const { DEFAULT_COUNTDOWN_LOOK } = await import("@/lib/countdown-display")
const { readyMadeFeed, FEED_PRESETS } = await import("@/lib/feed-presets")
const { BUILTIN_THEMES } = await import("@/lib/builtin-themes")

/**
 * The countdown display (owner request 2026-10-24): a stage output with the countdown layout is
 * sent a frame it can count from by itself; the full stage view is untouched.
 */
const slide = (id: string, planned_minutes: number, extra: object = {}): QueueItem =>
  ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0, planned_minutes, ...extra }) as unknown as QueueItem
const at = (h: number, m: number, s = 0) => new Date(2026, 9, 25, h, m, s).getTime()
const ndi = { sourceName: "x", resolution: "r1080p", frameRate: "fps24", alphaMode: "noneOpaque" } as const
const countdownOut: BroadcastOutput = { id: "cd", name: "Back wall", role: "stage", stageLayout: "countdown", type: "display", themeId: "", monitorIndex: 1, ndi }
const stageOut: BroadcastOutput = { id: "stage", name: "Stage", role: "stage", type: "display", themeId: "", monitorIndex: 2, ndi }
const sent = (id: string) => emitTo.mock.calls.filter((c) => c[0] === `broadcast-${id}`).map((c) => (c[2] as { stage?: StagePayload }).stage)
const lastCountdown = (): CountdownFrame => sent("cd").at(-1)!.countdown!

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "setInterval", "clearTimeout", "clearInterval"] })
  vi.setSystemTime(at(10, 22, 50))
  useQueueStore.setState({ items: [slide("Welcome", 5, { timing: { warn_minutes: 1 } }), slide("Sermon", 30)], activeIndex: 0, headers: [{ id: "m", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main", starts_at: "10:00" }] })
  useEventClock.setState({ mode: "own", currentId: "Welcome" })
  useJournalStore.setState({ entries: [{ at: at(10, 20), mono: 0, kind: "event", label: "Welcome", itemId: "Welcome" }] })
  useBroadcastStore.getState().loadThemes()
  useBroadcastStore.setState({ outputs: [countdownOut, stageOut], rehearsal: false, stageMessage: "", outputStatus: {} })
  useBroadcastStore.getState().saveCountdownLook(DEFAULT_COUNTDOWN_LOOK)
  useTimerStore.getState().reset()
  useTimerStore.getState().setDurationMinutes(0)
  useAuxTimers.setState({ timers: [] })
  updateStageFinish()
  emitTo.mockClear()
  invoke.mockClear()
})
afterEach(() => {
  useTimerStore.getState().reset()
  vi.useRealTimers()
})

describe("the countdown display on the host", () => {
  it("counts the service timer: the frame says when it ends; the full stage view gets no countdown", () => {
    useTimerStore.getState().setDurationMinutes(10)
    useTimerStore.getState().start()
    const c = lastCountdown()
    expect(c).toMatchObject({ label: "Service timer", totalMs: 600_000, item: "Welcome", next: "Sermon", look: DEFAULT_COUNTDOWN_LOOK })
    expect(Math.abs(c.endsAt! - (at(10, 22, 50) + 600_000))).toBeLessThan(50)
    // The item on now has its own warning (1 minute): the first step comes on then.
    expect(c.warnMs).toBe(60_000)
    expect(sent("stage").at(-1)?.countdown).toBeUndefined()
    useTimerStore.getState().pause()
    expect(lastCountdown()).toMatchObject({ endsAt: null })
    expect(lastCountdown().leftMs).toBeGreaterThan(599_000)
  })

  it("before the timer is set it says so instead of counting", () => {
    useBroadcastStore.getState().syncBroadcastOutputFor("cd")
    expect(lastCountdown()).toMatchObject({ idle: "Set the service timer in Present", endsAt: null })
  })

  it("counts the item on now from when it went on air, for its planned minutes", () => {
    useBroadcastStore.getState().saveCountdownLook({ ...DEFAULT_COUNTDOWN_LOOK, counts: "item" })
    expect(lastCountdown()).toMatchObject({ label: "Welcome", totalMs: 5 * 60_000, endsAt: at(10, 25), warnMs: 60_000 })
  })

  it("counts to the service start from the run of show", () => {
    useBroadcastStore.getState().saveCountdownLook({ ...DEFAULT_COUNTDOWN_LOOK, counts: "start", leadMinutes: 15 })
    expect(lastCountdown()).toMatchObject({ totalMs: 15 * 60_000, endsAt: at(10, 0) })
    expect(lastCountdown().label).toMatch(/^Service starts /)
  })

  it("counts a named extra timer, and is sent again when it starts or pauses (not every tick)", () => {
    useBroadcastStore.getState().saveCountdownLook({ ...DEFAULT_COUNTDOWN_LOOK, counts: "aux", auxLabel: "Communion prep" })
    expect(lastCountdown().idle).toMatch(/Communion prep/)
    useAuxTimers.getState().add("Communion prep", 3)
    expect(lastCountdown()).toMatchObject({ label: "Communion prep", totalMs: 180_000, endsAt: null, leftMs: 180_000 })
    const id = useAuxTimers.getState().timers[0].id
    useAuxTimers.getState().toggle(id)
    expect(lastCountdown().endsAt).not.toBeNull()
    const before = sent("cd").length
    vi.advanceTimersByTime(2000)
    expect(sent("cd").length).toBe(before)
  })

  it("carries the stage message under the time; a design change reaches the screens at once", () => {
    useBroadcastStore.getState().setStageMessage("Mic 2 is off")
    expect(sent("cd").at(-1)?.message).toBe("Mic 2 is off")
    useBroadcastStore.getState().saveCountdownLook({ ...DEFAULT_COUNTDOWN_LOOK, background: "#112233" })
    expect(lastCountdown().look.background).toBe("#112233")
  })

  it("a browser feed (a Google TV) is sent the same frame, with the host's clock to count by", () => {
    useBroadcastStore.setState({ outputs: [{ ...countdownOut, type: "browser", feedToken: "k" }], outputStatus: { cd: { feedActive: true } as never } })
    useTimerStore.getState().setDurationMinutes(10)
    useTimerStore.getState().start()
    const published = invoke.mock.calls.filter((c) => c[0] === "feed_publish").map((c) => JSON.parse((c[1] as { json: string }).json))
    const f = published.at(-1)
    expect(f).toMatchObject({ role: "stage", stage: { countdown: { label: "Service timer", totalMs: 600_000, look: DEFAULT_COUNTDOWN_LOOK } } })
    expect(typeof f.hostNow).toBe("number")
    expect(typeof f.stage.countdown.endsAt).toBe("number")
    expect(typeof f.stage.countdown.zone).toBe("string")
  })

  it("the ready-made feed Rhema Countdown is a stage output with the countdown layout, opaque, starting off", () => {
    const r = readyMadeFeed(FEED_PRESETS.find((p) => p.id === "countdown")!, "browser", [], BUILTIN_THEMES, () => "rc")
    if (!("output" in r)) throw new Error("not added")
    expect(r.output).toMatchObject({ id: "rc", name: "Rhema Countdown", role: "stage", stageLayout: "countdown", type: "browser", ndi: { sourceName: "Rhema Countdown", alphaMode: "noneOpaque" } })
    expect(r.output.feedToken).toBeTruthy()
    expect(r.scene).toBeUndefined()
  })

  it("keeps stage and countdown next-up aligned when a phase is disabled", () => {
    const items = [slide("Live", 5), slide("Hidden", 5, { hidden: true }), slide("Disabled phase item", 5), slide("Following phase item", 5)]
    const headers: OutlineHeader[] = [
      { id: "main", type: "phase", name: "Main", at: 0, rule: "manual" },
      { id: "disabled", type: "phase", name: "Disabled", at: 2, rule: "manual" },
      { id: "following", type: "phase", name: "Following", at: 3, rule: "manual" },
    ]
    useQueueStore.setState({ items, headers, activeIndex: 0 })

    expect(sent("stage").at(-1)?.next).toBe("Disabled phase item")
    expect(lastCountdown().next).toBe("Disabled phase item")

    useQueueStore.setState({ headers: headers.map((header) => header.id === "disabled" ? { ...header, disabled: true } : header) })

    expect(sent("stage").at(-1)?.next).toBe("Following phase item")
    expect(lastCountdown().next).toBe("Following phase item")
  })

  it("keeps the last public stage frame frozen while rehearsal changes skipped phases", () => {
    const items = [slide("Live", 5), slide("Skipped", 5)]
    const headers: OutlineHeader[] = [
      { id: "main", type: "phase", name: "Main", at: 0, rule: "manual" },
      { id: "later", type: "phase", name: "Later", at: 1, rule: "manual" },
    ]
    useQueueStore.setState({ items, headers, activeIndex: 0 })
    expect(sent("stage").at(-1)?.next).toBe("Skipped")
    useBroadcastStore.setState({ rehearsal: true })
    emitTo.mockClear()

    useQueueStore.setState({ headers: headers.map((header) => header.id === "later" ? { ...header, disabled: true } : header) })

    expect(sent("stage")).toHaveLength(0)
    expect(sent("cd")).toHaveLength(0)
  })
})
