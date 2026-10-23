import { beforeEach, describe, expect, it, vi } from "vitest"
import type { QueueItem } from "@/types"

const calls: { cmd: string; args: Record<string, unknown> }[] = []
const handlers = new Map<string, (e: { payload: string }) => void>()
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args })
    if (cmd === "join_pair") return "token-123"
    if (cmd === "join_me") return { name: "Femi's laptop", role: "timekeeper" }
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

const { buildLiveState, publishLiveState, startLiveStatePublisher } = await import("@/lib/live-state")
const { useJoin } = await import("@/stores/join-store")
const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useEventClock } = await import("@/stores/event-clock-store")
const { useQueueStore } = await import("@/stores/queue-store")
const { useSettingsStore } = await import("@/stores/settings-store")

/** Host/Join (ARCH-004): what a host publishes, and how a joined computer pairs, follows and sends. */
const slide = (id: string, planned_minutes?: number): QueueItem => ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0, planned_minutes }) as unknown as QueueItem

beforeEach(() => {
  calls.length = 0
  useQueueStore.setState({ items: [slide("Welcome", 5), slide("Sermon", 30)], headers: [] })
  useBroadcastStore.setState({ isLive: true, liveVerse: { reference: "Romans 8:28", segments: [], content: "bible" }, rehearsal: false, stageMessage: "Wrap up", sources: { bible: { value: { reference: "Romans 8:28", segments: [], content: "bible" }, itemId: null, revision: 3, activatedAt: 0, on: true } } })
  useEventClock.setState({ mode: "screens", currentId: "Welcome" })
  useSettingsStore.setState({ joinAddress: "", joinToken: "", joinName: "", remoteSecret: "shh", deepgramApiKey: "dg-secret" })
  useJoin.setState({ status: "off", error: null, me: null, live: null })
})

describe("the host's Live State", () => {
  it("carries what joined computers need, never a secret", () => {
    const s = buildLiveState(1000)
    expect(s).toMatchObject({ v: 1, program: { onAir: true, reference: "Romans 8:28", rehearsal: false }, event: { mode: "screens", currentId: "Welcome" }, stageMessage: "Wrap up" })
    expect(s.sources).toEqual([{ id: "bible", reference: "Romans 8:28", on: true, revision: 3, activatedAt: 0 }])
    expect(s.rundown.map((r) => r.reference)).toEqual(["Welcome", "Sermon"])
    const text = JSON.stringify(s)
    for (const secret of ["shh", "dg-secret", "token"]) expect(text).not.toContain(secret)
  })

  it("is published only when it changed", () => {
    publishLiveState()
    publishLiveState()
    expect(calls.filter((c) => c.cmd === "publish_live_state")).toHaveLength(1)
    useEventClock.setState({ currentId: "Sermon" })
    publishLiveState()
    expect(calls.filter((c) => c.cmd === "publish_live_state")).toHaveLength(2)
  })
})

describe("publishing without timers (a hidden window holds them back)", () => {
  it("a change is published at the end of the same turn", async () => {
    const stop = startLiveStatePublisher()
    await Promise.resolve()
    calls.length = 0
    useEventClock.setState({ currentId: "Sermon" })
    useEventClock.setState({ mode: "own" })
    await Promise.resolve()
    const sent = calls.filter((c) => c.cmd === "publish_live_state")
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0].args.json as string).event).toEqual({ mode: "own", currentId: "Sermon" })
    stop()
  })
})

describe("joining a host", () => {
  it("pairs, keeps the token, learns its role, follows the Live State and sends commands", async () => {
    await useJoin.getState().pair(" 192.168.1.20:8080 ", "123456", "Femi's laptop")
    expect(calls.map((c) => c.cmd)).toEqual(["join_pair", "join_me", "join_connect"])
    expect(useSettingsStore.getState()).toMatchObject({ joinAddress: "192.168.1.20:8080", joinToken: "token-123", joinName: "Femi's laptop" })
    expect(useJoin.getState().me).toEqual({ name: "Femi's laptop", role: "timekeeper" })
    handlers.get("join:state")!({ payload: JSON.stringify({ state: "connected" }) })
    handlers.get("join:live")!({ payload: JSON.stringify(buildLiveState()) })
    expect(useJoin.getState()).toMatchObject({ status: "connected", live: { event: { currentId: "Welcome" } } })
    handlers.get("join:live")!({ payload: "not json" })
    expect(useJoin.getState().live?.event.currentId).toBe("Welcome")
    await useJoin.getState().send({ command: "event_next" })
    expect(calls.at(-1)).toEqual({ cmd: "join_command", args: { address: "192.168.1.20:8080", token: "token-123", command: { command: "event_next" } } })
  })

  it("a refusal says to pair again; leaving can forget the host", async () => {
    useSettingsStore.setState({ joinAddress: "h:1", joinToken: "t" })
    await useJoin.getState().connect()
    handlers.get("join:state")!({ payload: JSON.stringify({ state: "refused", error: "The host refused this computer (401): pair again" }) })
    expect(useJoin.getState().status).toBe("refused")
    await useJoin.getState().leave(true)
    expect(useSettingsStore.getState()).toMatchObject({ joinAddress: "", joinToken: "" })
    expect(calls.at(-1)?.cmd).toBe("join_disconnect")
  })
})
