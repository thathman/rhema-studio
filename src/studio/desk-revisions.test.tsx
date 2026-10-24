// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

const calls: { cmd: string; args: Record<string, unknown> }[] = []
/** What the host answers the next join_command with, if it refuses (as join.rs marks it). */
let refuseNext: string | null = null
const handlers = new Map<string, (e: { payload: string }) => void>()
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args })
    if (cmd === "join_me") return { name: "Femi's laptop", role: "screens" }
    if (cmd === "join_command" && refuseNext) {
      const why = refuseNext
      refuseNext = null
      throw why
    }
    return null
  }),
}))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn(async () => {}),
  listen: vi.fn(async (name: string, h: (e: { payload: string }) => void) => {
    handlers.set(name, h)
    return () => {}
  }),
}))

const { buildLiveState } = await import("@/lib/live-state")
const { useJoin, withWhatWasSeen, STALE_MESSAGE } = await import("@/stores/join-store")
const { useSettingsStore } = await import("@/stores/settings-store")
const { useTimerStore } = await import("@/stores/timer-store")
const { useNotices, noteUnableReason, takeUnableReason } = await import("@/stores/notices-store")
const { NoticesPanel } = await import("./notices-panel")

/** A Live State as the host's server hands it on: with the revisions it adds (#196 R7). */
const served = (revisions: Record<string, number>) => ({ ...buildLiveState(), revisions })

beforeEach(() => {
  calls.length = 0
  refuseNext = null
  useSettingsStore.setState({ joinAddress: "h:1", joinToken: "t" })
  useJoin.setState({ status: "off", error: null, me: null, live: null, paused: false, note: null })
  useNotices.setState({ notices: [], read: [] })
})

describe("acting on what the desk saw (#196 R7)", () => {
  it("the timer's revision moves when someone starts, pauses or corrects it, not as it counts", () => {
    useTimerStore.getState().reset()
    const at = () => buildLiveState().timer!.revision!
    const before = at()
    expect(at()).toBe(before)
    useTimerStore.getState().start()
    const started = at()
    expect(started).toBeGreaterThan(before)
    expect(at()).toBe(started)
    useTimerStore.getState().adjustMinutes(1)
    expect(at()).toBeGreaterThan(started)
    useTimerStore.getState().pause()
    useTimerStore.getState().reset()
  })

  it("each command carries the revisions the desk saw; an older host's Live State has none to send", async () => {
    expect(withWhatWasSeen({ command: "take_scene", value: { output: "main", scene: "s" } }, served({ "output:main": 4, hold: 1 }))).toEqual({ command: "take_scene", value: { output: "main", scene: "s" }, seen: { "output:main": 4, hold: 1 } })
    expect(withWhatWasSeen({ command: "hold" }, buildLiveState())).toEqual({ command: "hold" })
    expect(withWhatWasSeen({ command: "hold" }, null)).toEqual({ command: "hold" })
    useJoin.setState({ status: "connected", me: { name: "Femi's laptop", role: "screens" }, live: served({ "output:main": 7 }) })
    await useJoin.getState().send({ command: "release_scene", value: "main" })
    expect(calls.at(-1)?.args.command).toEqual({ command: "release_scene", value: "main", seen: { "output:main": 7 } })
  })

  it("refused because someone changed it first: the desk says so and stays connected", async () => {
    useJoin.setState({ status: "connected", me: { name: "Femi's laptop", role: "screens" }, live: served({ "output:main": 7 }) })
    refuseNext = `stale: ${STALE_MESSAGE}`
    expect(await useJoin.getState().send({ command: "take_scene", value: { output: "main", scene: "s" } })).toEqual({ ok: false, error: STALE_MESSAGE, stale: true })
    expect(useJoin.getState()).toMatchObject({ status: "connected", error: STALE_MESSAGE, note: null, paused: false })
    // No reconnect: the desk already follows the change; the operator looks again.
    expect(calls.map((c) => c.cmd)).toEqual(["join_command"])
    // Looking again and pressing works.
    expect(await useJoin.getState().send({ command: "take_scene", value: { output: "main", scene: "s" } })).toEqual({ ok: true })
    expect(useJoin.getState().error).toBeNull()
  })
})

describe("a refusal stays on the joined desk until its next command", () => {
  it("the next Live State (every 2 s) does not wipe the reason; a lost connection's reason does go once it is back", async () => {
    await useJoin.getState().connect()
    handlers.get("join:live")!({ payload: JSON.stringify(served({ "output:main": 1 })) })
    refuseNext = `stale: ${STALE_MESSAGE}`
    await useJoin.getState().send({ command: "release_scene", value: "main" })
    // The heartbeat: the operator still sees why nothing happened.
    handlers.get("join:live")!({ payload: JSON.stringify(served({ "output:main": 2 })) })
    expect(useJoin.getState()).toMatchObject({ status: "connected", error: STALE_MESSAGE })
    refuseNext = "this device runs the congregation screens: it may take and release scenes only"
    await useJoin.getState().send({ command: "event_next" })
    handlers.get("join:live")!({ payload: JSON.stringify(served({ "output:main": 2 })) })
    expect(useJoin.getState().error).toBe("this device runs the congregation screens: it may take and release scenes only")
    // The connection drops and comes back: its reason was about the connection, and goes.
    handlers.get("join:state")!({ payload: JSON.stringify({ state: "reconnecting", error: "the host closed the connection" }) })
    expect(useJoin.getState()).toMatchObject({ status: "reconnecting", error: "the host closed the connection" })
    handlers.get("join:live")!({ payload: JSON.stringify(served({ "output:main": 2 })) })
    expect(useJoin.getState()).toMatchObject({ status: "connected", error: null })
  })
})

describe("why a request could not be done reaches whoever sent it (Comms, #251)", () => {
  it("an Unable answer keeps its reason; other answers have none", () => {
    const n = useNotices.getState().send({ from: "Main desk", fromId: "host", to: "bible", text: "Show John 3:16", action: { kind: "bible", value: "John 3:16" } })!
    useNotices.getState().answer(n.id, "Ade", "unable", "  “Show John 3:16”:\n that verse was not found ")
    useNotices.getState().answer(n.id, "Femi", "ready", "ignored")
    expect(useNotices.getState().notices[0].answers).toEqual([
      { by: "Ade", state: "unable", at: expect.any(Number), why: "“Show John 3:16”: that verse was not found" },
      { by: "Femi", state: "ready", at: expect.any(Number) },
    ])
  })

  it("a joined desk sends the reason with its Unable answer, once", () => {
    noteUnableReason("n1", "“Take Sermon split”: no such scene")
    expect(withWhatWasSeen({ command: "notice_ack", value: { id: "n1", state: "unable" } }, null)).toEqual({ command: "notice_ack", value: { id: "n1", state: "unable" }, why: "“Take Sermon split”: no such scene" })
    expect(takeUnableReason("n1")).toBeUndefined()
    noteUnableReason("n2", "x")
    expect(withWhatWasSeen({ command: "notice_ack", value: { id: "n2", state: "seen" } }, null)).toEqual({ command: "notice_ack", value: { id: "n2", state: "seen" } })
  })

  it("the recipient's failed action answers Unable with why; the sender's panel shows it", async () => {
    const n = useNotices.getState().send({ from: "Main desk", fromId: "host", to: "bible", text: "Please", action: { kind: "bible", value: "Hezekiah 1:1" } })!
    const onAnswer = vi.fn()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const el = document.createElement("div")
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => root.render(<NoticesPanel notices={useNotices.getState().notices} role="bible" me="Ade" onSend={vi.fn()} onAnswer={onAnswer} onAction={() => "that is not a Bible reference"} />))
    await act(async () => [...el.querySelectorAll("button")].find((b) => b.textContent === "Show Hezekiah 1:1")!.click())
    expect(onAnswer).toHaveBeenCalledWith(n.id, "unable", "“Show Hezekiah 1:1”: that is not a Bible reference")
    // The host's side: the answer arrives with its reason, and the main desk (the sender) sees it.
    useNotices.getState().answer(n.id, "Ade", "unable", onAnswer.mock.calls[0][2])
    await act(async () => root.render(<NoticesPanel notices={useNotices.getState().notices} role="host" me="Main desk" onSend={vi.fn()} onAnswer={vi.fn()} onAction={vi.fn()} />))
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("Ade could not do it: “Show Hezekiah 1:1”: that is not a Bible reference")
    await act(async () => root.unmount())
    el.remove()
  })
})
