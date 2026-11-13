import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}), emitTo: vi.fn(async () => {}) }))

import { engageSlide, type EngagePublicState } from "@/lib/engage-screen"
import { engageOnLive, showEngageOnScreens, showEngageScores, stopFollowingEngage, useEngageScreens } from "@/studio/engage/engage-screens"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { presentActions } from "@/studio/present-actions"

const base: EngagePublicState = { title: "Acts quiz", code: "ABCD", phase: "lobby", deadline: null, questionIndex: 0, questionCount: 3, answerCount: 0, playerCount: 1, question: null, leaderboard: null }
const q = { prompt: "Who preached at Pentecost?", choices: ["Peter", "Paul", "John", "James"], correctIndex: 0, reference: "Acts 2:14" }
const session = { endpoint: "https://quiz.test", code: "ABCD", hostToken: "t", joinUrl: "https://quiz.test/j/ABCD", screenUrl: "https://quiz.test/s/ABCD" } as never

describe("the quiz slide (#425 stage 2)", () => {
  it("shows the join link and code in the lobby", () => {
    const lines = engageSlide(base, "https://quiz.test/j/ABCD").lines!
    expect(lines.join("\n")).toContain("https://quiz.test/j/ABCD")
    expect(lines.join("\n")).toContain("Code ABCD")
    expect(lines).toContain("1 player in")
  })

  it("never shows the answer before the reveal, and shows it at the reveal", () => {
    const asked = engageSlide({ ...base, phase: "question", question: q }, "")
    expect(asked.lines).toEqual(["Who preached at Pentecost?", "A. Peter", "B. Paul", "C. John", "D. James"])
    expect(JSON.stringify(asked)).not.toContain("Answer")
    const shown = engageSlide({ ...base, phase: "reveal", answerCount: 12, question: q }, "")
    expect(shown.lines).toEqual(["Who preached at Pentecost?", "Answer: A. Peter", "Acts 2:14", "12 answered"])
  })

  it("ends on the top five scores", () => {
    const leaderboard = Array.from({ length: 7 }, (_, i) => ({ rank: i + 1, nickname: `P${i + 1}`, points: 700 - i * 100 }))
    const s = engageSlide({ ...base, phase: "finished", leaderboard }, "")
    expect(s.reference).toBe("Quiz · Final scores")
    expect(s.lines).toHaveLength(5)
    expect(s.lines![0]).toBe("1. P1 · 700 points")
  })
})

describe("following the quiz on Live", () => {
  let state: EngagePublicState
  const settle = () => vi.advanceTimersByTimeAsync(0)
  const tick = () => vi.advanceTimersByTimeAsync(1700)
  const live = () => useBroadcastStore.getState().liveVerse
  const fetch = async () => ({ state, offsetMs: 0 })
  beforeEach(() => {
    vi.useFakeTimers()
    state = { ...base }
    useBroadcastStore.setState({ liveVerse: null, heldLive: null, isLive: false, cleared: false })
    useBroadcastStore.getState().setLiveVerse({ kind: "slide", reference: "Welcome", segments: [{ text: "Welcome" }], lines: ["Welcome"] }, null, { goLive: true })
  })
  afterEach(() => { stopFollowingEngage(); vi.useRealTimers() })

  it("goes up as a quick screen, follows the game, and Back returns what was on", async () => {
    showEngageOnScreens(session, fetch)
    await settle()
    expect(live()?.reference).toBe("Quiz · Acts quiz")
    state = { ...base, phase: "question", question: q }
    await tick()
    expect(live()?.lines?.[1]).toBe("A. Peter")
    expect(engageOnLive()).toBe(true)
    stopFollowingEngage()
    presentActions.back()
    expect(live()?.reference).toBe("Welcome")
  })

  it("stops following once something else goes on Live, or the screens are cleared", async () => {
    showEngageOnScreens(session, fetch)
    await settle()
    useBroadcastStore.getState().setLiveVerse({ kind: "slide", reference: "Notices", segments: [{ text: "Notices" }], lines: ["Notices"] }, null, { goLive: true })
    expect(engageOnLive()).toBe(false)
    state = { ...base, phase: "question", question: q }
    await tick()
    expect(live()?.reference).toBe("Notices")
    expect(useEngageScreens.getState().following).toBe(false)
    // Cleared mid-quiz: the next question never puts the quiz back on air.
    state = { ...base }
    showEngageOnScreens(session, fetch)
    await settle()
    useBroadcastStore.getState().setLive(false)
    state = { ...base, phase: "reveal", question: q }
    await tick()
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(useEngageScreens.getState().following).toBe(false)
  })

  it("keeps the last slide when the service cannot be reached", async () => {
    let fail = false
    showEngageOnScreens(session, async () => { if (fail) throw new Error("offline"); return { state, offsetMs: 0 } })
    await settle()
    fail = true
    await tick()
    expect(live()?.reference).toBe("Quiz · Acts quiz")
    expect(useEngageScreens.getState()).toMatchObject({ following: true, error: "offline" })
  })

  it("a late answer from an earlier Show changes nothing, and polls never stack up", async () => {
    let release: (v: { state: EngagePublicState; offsetMs: number }) => void = () => {}
    let calls = 0
    showEngageOnScreens(session, () => { calls++; return new Promise((r) => { release = r }) })
    await tick(); await tick()
    expect(calls).toBe(1)
    stopFollowingEngage()
    release({ state: { ...base, title: "Old room" }, offsetMs: 0 })
    await settle()
    expect(live()?.reference).toBe("Welcome")
    expect(useBroadcastStore.getState().heldLive).toBeNull()
  })

  it("holds the scores (people's nicknames) until the operator shows them", async () => {
    showEngageOnScreens(session, fetch)
    await settle()
    state = { ...base, phase: "finished", leaderboard: [{ rank: 1, nickname: "Ade", points: 900 }] }
    await tick()
    expect(live()?.reference).toBe("Quiz · Acts quiz")
    expect(useEngageScreens.getState().scoresWaiting).toBe(true)
    showEngageScores()
    expect(live()?.lines).toEqual(["1. Ade · 900 points"])
    expect(useEngageScreens.getState().scoresWaiting).toBe(false)
  })
})
