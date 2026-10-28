import { describe, expect, it } from "vitest"
import { chimesDue, countdownChoices, countdownLine, countdownTarget, countdownTargets, isCountdownTo, NO_COUNTDOWNS, steadyTargets } from "./countdown"
import { serviceTiming, type TimingInput, type TimingItem } from "./timing-engine"
import { clockText, countdownClock, normalizeScene, sceneFrame } from "./scenes"
import { normalizeStageStyle } from "./stage-style"
import type { OutlineHeader } from "./run-of-show"
import type { BroadcastTheme } from "@/types"

const at = (h: number, m: number, s = 0, day = 25) => new Date(2026, 9, day, h, m, s).getTime()
const MIN = 60_000
const items: TimingItem[] = [
  { id: "a", reference: "Welcome", planned_minutes: 5 },
  { id: "b", reference: "Worship", planned_minutes: 20 },
  { id: "c", reference: "Sermon", planned_minutes: 30, end_by: "11:00" },
  { id: "d", reference: "Blessing", planned_minutes: 5 },
]
const headers = (start = "10:00"): OutlineHeader[] => [{ id: "main", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main", starts_at: start }]
const timing = (o: Partial<TimingInput>) => serviceTiming({ items, headers: headers(), firstOnAir: new Map(), onAirMs: new Map(), liveItemId: null, now: at(9, 30), ...o })

describe("time until the next item (#196 R2)", () => {
  it("before the service: counts to its start, the first item", () => {
    const t = countdownTargets(timing({}))
    expect(t.next).toEqual({ label: "Welcome", at: at(10, 0) })
    expect(countdownLine("next", t.next!, at(9, 45))).toEqual({ label: "Next: Welcome in", text: "15:00", tone: "ok" })
  })

  it("with an item on now: the next one's expected start, which moves as it runs late", () => {
    const t = countdownTargets(timing({ now: at(10, 2), firstOnAir: new Map([["a", at(10, 2)]]), liveItemId: "a" }))
    expect(t.next).toEqual({ label: "Worship", at: at(10, 7) })
    expect(countdownLine("next", t.next!, at(10, 6))).toMatchObject({ text: "1:00", tone: "warn" })
  })

  it("skips a skipped item: never next, and what is next follows the item on now", () => {
    // Welcome ran, Worship never went on air, the Sermon is on now: next is the Blessing.
    const t = countdownTargets(timing({ now: at(10, 10), firstOnAir: new Map([["a", at(10, 0)], ["c", at(10, 5)]]), onAirMs: new Map([["a", 5 * MIN]]), liveItemId: "c" }))
    expect(t.next).toEqual({ label: "Blessing", at: at(10, 35) })
  })

  it("no next item once the last is on, or without a start time", () => {
    const t = countdownTargets(timing({ now: at(10, 58), firstOnAir: new Map([["a", at(10, 0)], ["b", at(10, 5)], ["c", at(10, 25)], ["d", at(10, 55)]]), liveItemId: "d" }))
    expect(t.next).toBeNull()
    expect(countdownTarget(t, "next")).toBeNull()
    expect(countdownTargets(null)).toEqual(NO_COUNTDOWNS)
    expect(countdownClock(t, "next")).toBeNull()
  })

  it("across midnight: a 23:50 service's next item at 00:15 is 17 minutes away at 23:58", () => {
    const night = serviceTiming({ items, headers: headers("23:50"), firstOnAir: new Map([["a", at(23, 50)], ["b", at(23, 55)]]), onAirMs: new Map([["a", 5 * MIN]]), liveItemId: "b", now: at(23, 58) })
    const t = countdownTargets(night)
    expect(t.next!.at).toBe(at(0, 15, 0, 26))
    expect(countdownLine("next", t.next!, at(23, 58)).text).toBe("17:00")
    // The Sermon's "end by 11:00" is the next morning's, nearest its planned start.
    expect(t.endBy.c.at).toBe(at(11, 0, 0, 26))
  })

  it("once due it says how far over on a private view, and keeps the moment it fell due", () => {
    const due = { label: "Worship", at: at(10, 7) }
    expect(countdownLine("next", due, at(10, 9, 30))).toEqual({ label: "Next: Worship", text: "2:30 over", tone: "over" })
    // Worked out again while Welcome overruns: expected "now" each time, but the target stays.
    const later = steadyTargets({ next: due, end: null, endBy: {} }, { next: { label: "Worship", at: at(10, 9) }, end: null, endBy: {} }, at(10, 9))
    expect(later.next).toBe(due)
    // A new next item is a new target.
    expect(steadyTargets({ next: due, end: null, endBy: {} }, { next: { label: "Sermon", at: at(10, 9) }, end: null, endBy: {} }, at(10, 9)).next!.label).toBe("Sermon")
  })
})

describe("time until a milestone (#196 R2)", () => {
  it("the main service's expected end and each item's end by", () => {
    const t = countdownTargets(timing({ now: at(10, 4), firstOnAir: new Map([["a", at(10, 4)]]), liveItemId: "a" }))
    expect(t.end).toEqual({ label: "End of the main service", at: at(11, 4) })
    expect(t.endBy).toEqual({ c: { label: "Sermon · end by 11:00", at: at(11, 0) } })
    expect(countdownTarget(t, "endby:c")).toEqual(t.endBy.c)
    expect(countdownTarget(t, "endby:gone")).toBeNull()
    expect(countdownLine("end", t.end!, at(10, 44))).toEqual({ label: "End of the main service in", text: "20:00", tone: "ok" })
    expect(countdownChoices(t).filter((c) => !c.group).map((c) => c.value)).toEqual(["next", "end", "endby:c"])
  })

  it("a chosen item's start and a group's end (#196 R2.4): expected while to come, kept once begun", () => {
    const grouped: OutlineHeader[] = [...headers(), { id: "g1", type: "group", name: "Worship set", at: 1 }, { id: "g2", type: "group", name: "Word", at: 2 }]
    const t = countdownTargets(serviceTiming({ items, headers: grouped, firstOnAir: new Map([["a", at(10, 4)]]), onAirMs: new Map(), liveItemId: "a", now: at(10, 6) }))
    // Welcome began at 10:04 (late): what follows moves with it.
    expect(t.starts?.a).toEqual({ label: "Welcome starts", at: at(10, 4) })
    expect(t.starts?.c).toEqual({ label: "Sermon starts", at: at(10, 29) })
    expect(t.groupEnds?.g1).toEqual({ label: "End of Worship set", at: at(10, 29) })
    expect(countdownTarget(t, "start:c")).toEqual(t.starts!.c)
    expect(countdownTarget(t, "groupend:g1")).toEqual(t.groupEnds!.g1)
    expect(countdownTarget(t, "start:gone")).toBeNull()
    expect(countdownLine("start:c", t.starts!.c, at(10, 26))).toEqual({ label: "Sermon starts in", text: "3:00", tone: "ok" })
    const choices = countdownChoices(t)
    expect(choices.filter((c) => c.group === "start").map((c) => c.value)).toEqual(["start:a", "start:b", "start:c", "start:d"])
    expect(choices.filter((c) => c.group === "groupend").map((c) => c.label)).toEqual(["End of Worship set", "End of Word"])
    expect(["start:c", "groupend:g1"].every(isCountdownTo)).toBe(true)
    expect(isCountdownTo("start:")).toBe(false)
    // Once due it holds still, as the next item does.
    const due = { ...t, starts: { c: { label: "Sermon starts", at: at(10, 29) } } }
    const later = steadyTargets(due, { ...t, starts: { c: { label: "Sermon starts", at: at(10, 31) } } }, at(10, 31))
    expect(later.starts?.c.at).toBe(at(10, 29))
  })

  it("a skipped item has no start to count to", () => {
    const t = countdownTargets(timing({ now: at(10, 30), firstOnAir: new Map([["a", at(10, 0)], ["d", at(10, 5)]]), onAirMs: new Map([["a", 5 * MIN]]), liveItemId: "d" }))
    expect(t.starts?.b).toBeUndefined()
    expect(t.starts?.d).toEqual({ label: "Blessing starts", at: at(10, 5) })
  })

  it("a skipped item's end-by stays a milestone, but takes no time", () => {
    const t = countdownTargets(timing({ now: at(10, 30), firstOnAir: new Map([["a", at(10, 0)], ["d", at(10, 5)]]), onAirMs: new Map([["a", 5 * MIN]]), liveItemId: "d" }))
    expect(t.next).toBeNull()
    expect(t.end!.at).toBe(at(10, 30))
    expect(t.endBy.c.at).toBe(at(11, 0))
  })

  it("only real targets are accepted from saved files", () => {
    expect(["next", "end", "endby:x"].every(isCountdownTo)).toBe(true)
    expect([undefined, "", "endby:", "soon", 3].some(isCountdownTo)).toBe(false)
  })
})

describe("countdowns on the screens and the stage", () => {
  const theme = { id: "t", name: "T" } as BroadcastTheme
  const scene = normalizeScene({ id: "s", name: "Countdown", background: "#000", createdAt: 0, updatedAt: 0, layers: [
    { id: "n", name: "Next", kind: "clock", clockShows: "countdown", box: { x: 0, y: 0, w: 50, h: 50 }, opacity: 1, visible: true },
    { id: "m", name: "End", kind: "clock", clockShows: "countdown", countdownTo: "end", box: { x: 50, y: 0, w: 50, h: 50 }, opacity: 1, visible: true },
    { id: "x", name: "Bad", kind: "clock", clockShows: "countdown", countdownTo: "whenever", box: { x: 0, y: 50, w: 50, h: 50 }, opacity: 1, visible: true },
  ] })!

  it("a scene clock layer counts down to the target and stops at 0:00 for the congregation", () => {
    expect(scene.layers.map((l) => [l.clockShows, l.countdownTo])).toEqual([["countdown", undefined], ["countdown", "end"], ["countdown", undefined]])
    const countdowns = { next: { label: "Sermon", at: at(10, 25) }, end: { label: "End of the main service", at: at(11, 0) }, endBy: {} }
    const frame = sceneFrame({ isLive: false, liveVerse: null, sources: {}, themes: [theme], countdowns }, { themeId: "t" }, scene)
    expect(frame.layers[0].clock).toEqual({ mode: "down", at: at(10, 25), text: "" })
    expect(frame.layers[1].clock).toEqual({ mode: "down", at: at(11, 0), text: "" })
    expect(clockText(frame.layers[0].clock!, at(10, 20))).toBe("5:00")
    expect(clockText(frame.layers[0].clock!, at(10, 30))).toBe("0:00")
  })

  it("with no next item the layer shows nothing, and the composer says why", () => {
    const frame = sceneFrame({ isLive: false, liveVerse: null, sources: {}, themes: [theme], countdowns: NO_COUNTDOWNS }, { themeId: "t" }, scene, true)
    expect(frame.layers[0].clock).toBeNull()
    expect(frame.layers[0].label).toBe("Next · no next item in the run of show now")
  })

  it("the stage style keeps a countdown choice, and leaves it out when off or unknown", () => {
    expect(normalizeStageStyle({ countdown: "next" }).countdown).toBe("next")
    expect(normalizeStageStyle({ countdown: "endby:c" }).countdown).toBe("endby:c")
    expect("countdown" in normalizeStageStyle({ countdown: "later" as never })).toBe(false)
    expect("countdown" in normalizeStageStyle({})).toBe(false)
  })
})

describe("chime scheduling (#196 R2)", () => {
  const target = at(10, 25)
  it("at N minutes before and at zero, each once as the time passes it", () => {
    expect(chimesDue(target, 2, at(10, 22, 59), at(10, 23))).toEqual(["before"])
    expect(chimesDue(target, 2, at(10, 23), at(10, 23, 1))).toEqual([])
    expect(chimesDue(target, 2, at(10, 24, 59), at(10, 25))).toEqual(["zero"])
    expect(chimesDue(target, 0, at(10, 22, 59), at(10, 23))).toEqual([])
  })
  it("a chime missed while the computer slept is let go, not played late", () => {
    expect(chimesDue(target, 2, at(10, 20), at(10, 30))).toEqual([])
    expect(chimesDue(target, 2, at(10, 24, 50), at(10, 25, 5))).toEqual(["zero"])
  })
})
