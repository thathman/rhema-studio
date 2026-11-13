import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}), emitTo: vi.fn(async () => {}) }))

import { engageSlide, type EngagePublicState } from "@/lib/engage-screen"
import { showEngageOnScreens, stopFollowingEngage, useEngageScreens } from "@/studio/engage/engage-screens"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { presentActions } from "@/studio/present-actions"

const base: EngagePublicState = { title: "Acts quiz", code: "ABCD", phase: "lobby", deadline: null, questionIndex: 0, questionCount: 3, answerCount: 0, playerCount: 1, question: null, leaderboard: null }
const q = { prompt: "Who preached at Pentecost?", choices: ["Peter", "Paul", "John", "James"], correctIndex: 0, reference: "Acts 2:14" }
const session = { endpoint: "https://quiz.test", code: "ABCD", hostToken: "t", joinUrl: "https://quiz.test/j/ABCD", screenUrl: "https://quiz.test/s/ABCD" } as never
const settle = () => new Promise<void>((r) => setTimeout(r, 0))

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
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    state = { ...base }
    useBroadcastStore.setState({ liveVerse: null, heldLive: null, isLive: false })
    useBroadcastStore.getState().setLiveVerse({ kind: "slide", reference: "Welcome", segments: [{ text: "Welcome" }], lines: ["Welcome"] }, null, { goLive: true })
  })
  afterEach(() => { stopFollowingEngage(); vi.useRealTimers() })

  it("goes up as a quick screen, follows the game, and Back returns what was on", async () => {
    showEngageOnScreens(session, async () => ({ state, offsetMs: 0 }))
    await settle()
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Quiz · Acts quiz")
    state = { ...base, phase: "question", question: q }
    vi.advanceTimersByTime(1700)
    await settle()
    expect(useBroadcastStore.getState().liveVerse?.lines?.[1]).toBe("A. Peter")
    stopFollowingEngage()
    presentActions.back()
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Welcome")
  })

  it("stops following once something else goes on Live", async () => {
    showEngageOnScreens(session, async () => ({ state, offsetMs: 0 }))
    await settle()
    useBroadcastStore.getState().setLiveVerse({ kind: "slide", reference: "Notices", segments: [{ text: "Notices" }], lines: ["Notices"] }, null, { goLive: true })
    state = { ...base, phase: "question", question: q }
    vi.advanceTimersByTime(1700)
    await settle()
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Notices")
    expect(useEngageScreens.getState().following).toBe(false)
  })

  it("keeps the last slide when the service cannot be reached", async () => {
    let fail = false
    showEngageOnScreens(session, async () => { if (fail) throw new Error("offline"); return { state, offsetMs: 0 } })
    await settle()
    fail = true
    vi.advanceTimersByTime(1700)
    await settle()
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Quiz · Acts quiz")
    expect(useEngageScreens.getState()).toMatchObject({ following: true, error: "offline" })
  })
})
