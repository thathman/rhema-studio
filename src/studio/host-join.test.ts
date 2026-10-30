import { beforeEach, describe, expect, it, vi } from "vitest"
import type { QueueItem } from "@/types"

const calls: { cmd: string; args: Record<string, unknown> }[] = []
/** What the host answers the next join_command with, if it refuses (as join.rs marks it). */
let refuseNext: string | null = null
let rejectRemotePolicy = false
const handlers = new Map<string, (e: { payload: string }) => void>()
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args })
    if (cmd === "remote_set_keys" && rejectRemotePolicy) throw new Error("remote policy update failed")
    if (cmd === "join_pair") return "token-123"
    if (cmd === "join_me") return { name: "Femi's laptop", role: "timekeeper" }
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

const { buildLiveState, publishLiveState, refreshLiveState, startLiveStatePublisher } = await import("@/lib/live-state")
const { useJoin } = await import("@/stores/join-store")
const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useEventClock } = await import("@/stores/event-clock-store")
const { useQueueStore } = await import("@/stores/queue-store")
const { useSettingsStore, pushRemoteKeys } = await import("@/stores/settings-store")
const { useServiceStore } = await import("@/stores/service-store")
const { useJournalStore } = await import("@/stores/journal-store")
const { setDeskControl } = await import("@/lib/desk-control")
const { serviceOf } = await import("@/stores/join-store")

/** Host/Join (ARCH-004): what a host publishes, and how a joined computer pairs, follows and sends. */
const slide = (id: string, planned_minutes?: number): QueueItem => ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0, planned_minutes }) as unknown as QueueItem

beforeEach(() => {
  calls.length = 0
  rejectRemotePolicy = false
  useQueueStore.setState({ items: [slide("Welcome", 5), slide("Sermon", 30)], headers: [] })
  useBroadcastStore.setState({ isLive: true, liveVerse: { reference: "Romans 8:28", segments: [], content: "bible" }, rehearsal: false, stageMessage: "Wrap up", sources: { bible: { value: { reference: "Romans 8:28", segments: [], content: "bible" }, itemId: null, revision: 3, activatedAt: 0, on: true } } })
  useEventClock.setState({ mode: "screens", currentId: "Welcome", currentMomentId: "Welcome" })
  useSettingsStore.setState({ joinAddress: "", joinToken: "", joinName: "", remoteSecret: "shh", deepgramApiKey: "dg-secret" })
  useJoin.setState({ status: "off", error: null, me: null, live: null, paused: false, note: null })
  useServiceStore.setState({ current: null })
  useJournalStore.setState({ entries: [] })
  refuseNext = null
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

  it("publishes planned events and lengths as Timekeeper targets while keeping moments separate", () => {
    useQueueStore.setState({
      items: [slide("prayer-words", 2), slide("prayer-reading", 3), slide("sermon-reading", 4)],
      headers: [
        { id: "main", type: "phase", name: "Main service", at: 0, role: "main", starts_at: "10:00" },
        { id: "prayer", type: "group", name: "Opening Prayer", at: 0, event: { schema_version: 1, duration_minutes: 15, approval: "approved" } },
        { id: "sermon", type: "group", name: "Sermon", at: 2, event: { schema_version: 1, duration_minutes: 40, approval: "approved" } },
        { id: "post", type: "phase", name: "Post-service", at: 3, role: "post" },
      ],
    })
    useEventClock.setState({ mode: "screens", currentId: null, currentMomentId: null })
    useEventClock.getState().start("prayer-reading")

    const live = buildLiveState()
    expect(live.event).toMatchObject({
      currentId: "prayer",
      currentMomentId: "prayer-reading",
      targets: [
        { id: "prayer", reference: "Opening Prayer", plannedMinutes: 15, kind: "event" },
        { id: "sermon", reference: "Sermon", plannedMinutes: 40, kind: "event" },
      ],
    })
    expect(live.rundown.map((row) => row.id)).toEqual(["prayer-words", "prayer-reading", "sermon-reading"])
  })

  it("is published only when it changed", () => {
    publishLiveState()
    publishLiveState()
    expect(calls.filter((c) => c.cmd === "publish_live_state")).toHaveLength(1)
    useEventClock.setState({ currentId: "Sermon", currentMomentId: "Sermon" })
    publishLiveState()
    expect(calls.filter((c) => c.cmd === "publish_live_state")).toHaveLength(2)
  })
})

describe("the heartbeat (#196 R5)", () => {
  it("unchanged, it is still sent every 2 s on the app tick, so a desk can tell a quiet host from a lost one", () => {
    publishLiveState()
    const sent = () => calls.filter((c) => c.cmd === "publish_live_state")
    const n = sent().length
    refreshLiveState(Date.now() + 1000)
    expect(sent()).toHaveLength(n)
    refreshLiveState(Date.now() + 2500)
    expect(sent()).toHaveLength(n + 1)
    expect(JSON.parse(sent().at(-1)!.args.json as string)).toMatchObject({ heartbeatMs: 2000, hold: null })
  })
})

describe("publishing without timers (a hidden window holds them back)", () => {
  it("a change is published at the end of the same turn", async () => {
    const stop = startLiveStatePublisher()
    await Promise.resolve()
    calls.length = 0
    useEventClock.setState({ currentId: "Sermon", currentMomentId: "Sermon" })
    useEventClock.setState({ mode: "own" })
    await Promise.resolve()
    const sent = calls.filter((c) => c.cmd === "publish_live_state")
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0].args.json as string).event).toMatchObject({ mode: "own", currentId: "Sermon", currentMomentId: "Sermon", targets: [{ id: "Welcome" }, { id: "Sermon" }] })
    stop()
  })
})

describe("joining a host", () => {
  it("pairs, keeps the token, learns its role, follows the Live State and sends commands", async () => {
    await useJoin.getState().pair(" 192.168.1.20:8080 ", "123456", "Femi's laptop")
    expect(calls.map((c) => c.cmd)).toEqual(["join_pair", "join_secure", "join_me", "join_connect"])
    expect(useSettingsStore.getState()).toMatchObject({ joinAddress: "192.168.1.20:8080", joinToken: "token-123", joinName: "Femi's laptop" })
    expect(useJoin.getState().me).toEqual({ name: "Femi's laptop", role: "timekeeper" })
    handlers.get("join:state")!({ payload: JSON.stringify({ state: "connected" }) })
    handlers.get("join:live")!({ payload: JSON.stringify(buildLiveState()) })
    expect(useJoin.getState()).toMatchObject({ status: "connected", live: { event: { currentId: "Welcome" } } })
    handlers.get("join:live")!({ payload: "not json" })
    expect(useJoin.getState().live?.event.currentId).toBe("Welcome")
    await useJoin.getState().send({ command: "event_next" })
    expect(calls.at(-1)).toEqual({ cmd: "join_command", args: { address: "192.168.1.20:8080", token: "token-123", command: { command: "event_next" }, service: "" } })
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

describe("the main desk takes back control (#243)", () => {
  const device = { hash: "a".repeat(64), name: "Desk C", paired_at: "2026-10-23T09:00:00Z", role: "bible" as const }

  it("the toggle persists, reaches the backend and is logged; giving back leaves the entry as before", async () => {
    useSettingsStore.setState({ remoteDevices: [device], remoteSecret: "" })
    await setDeskControl(device.hash, true)
    expect(useSettingsStore.getState().remoteDevices[0]).toMatchObject({ name: "Desk C", role: "bible", paused: true })
    await pushRemoteKeys()
    const pushed = calls.filter((c) => c.cmd === "remote_set_keys").at(-1)!.args.devices as { name: string; paused: boolean }[]
    expect(pushed).toEqual([{ hash: device.hash, name: "Desk C", role: "bible", paused: true, output_scope: [], group_take_scope: [], record: false }])
    expect(buildLiveState().paused).toEqual(["Desk C"])
    await setDeskControl(device.hash, true)
    expect(useJournalStore.getState().entries.map((e) => e.label)).toEqual(["Main desk took back control from Desk C"])

    await setDeskControl(device.hash, false)
    expect(useSettingsStore.getState().remoteDevices[0]).toEqual(device)
    await pushRemoteKeys()
    expect((calls.filter((c) => c.cmd === "remote_set_keys").at(-1)!.args.devices as { paused: boolean }[])[0].paused).toBe(false)
    expect(buildLiveState().paused).toEqual([])
    expect(useJournalStore.getState().entries.at(-1)).toMatchObject({ kind: "remote", label: "Main desk gave control back to Desk C" })
  })

  it("does not change local access or log a host reclaim when the backend rejects it", async () => {
    useSettingsStore.setState({ remoteDevices: [device], remoteSecret: "" })
    rejectRemotePolicy = true

    await expect(setDeskControl(device.hash, true)).resolves.toBe(false)

    expect(useSettingsStore.getState().remoteDevices[0]).toEqual(device)
    expect(useJournalStore.getState().entries).toEqual([])
  })

  it("a joined desk shows it is paused instead of an error, and follows the host when given back", async () => {
    useSettingsStore.setState({ joinAddress: "h:1", joinToken: "t" })
    await useJoin.getState().connect()
    const live = { ...buildLiveState(), paused: ["Femi's laptop"] }
    handlers.get("join:live")!({ payload: JSON.stringify(live) })
    expect(useJoin.getState().paused).toBe(true)
    refuseNext = "paused: The main desk has taken back control"
    // Each send says whether the host did it, and if not, why in the host's words (Comms: Ready only on success).
    expect(await useJoin.getState().send({ command: "event_next" })).toEqual({ ok: false, error: "The main desk has taken back control" })
    expect(useJoin.getState()).toMatchObject({ paused: true, error: null })
    handlers.get("join:live")!({ payload: JSON.stringify({ ...live, paused: [] }) })
    expect(useJoin.getState().paused).toBe(false)
    refuseNext = "this device keeps time"
    expect(await useJoin.getState().send({ command: "show" })).toEqual({ ok: false, error: "this device keeps time" })
    expect(useJoin.getState().error).toBe("this device keeps time")
    expect(await useJoin.getState().send({ command: "event_next" })).toEqual({ ok: true })
  })
})

describe("one service at a time (#246 C16)", () => {
  it("the Live State names the service and its revision; a desk tags its commands with it", async () => {
    useServiceStore.setState({ current: { id: "svc-11", title: "11 AM", revision: 4, service_date: null, created_at: "", updated_at: "", item_count: 2 } })
    const s = buildLiveState()
    expect(s.service).toEqual({ id: "svc-11", title: "11 AM", revision: 4 })
    expect(serviceOf(s)).toBe("svc-11")
    expect(serviceOf({ ...s, service: null })).toBe("")
    expect(serviceOf({ ...s, service: { title: "an older host" } })).toBeUndefined()
    expect(serviceOf(null)).toBeUndefined()

    useSettingsStore.setState({ joinAddress: "h:1", joinToken: "t" })
    useJoin.setState({ status: "connected", me: { name: "Femi's laptop", role: "timekeeper" }, live: s })
    await useJoin.getState().send({ command: "event_next" })
    expect(calls.at(-1)?.args).toMatchObject({ command: { command: "event_next" }, service: "svc-11" })
  })

  it("a desk on another service is told, not shown an error, and refreshes", async () => {
    useSettingsStore.setState({ joinAddress: "h:1", joinToken: "t" })
    useJoin.setState({ status: "connected", me: { name: "Femi's laptop", role: "timekeeper" }, live: buildLiveState() })
    calls.length = 0
    refuseNext = "other-service: That desk is looking at a different service; it will refresh"
    expect(await useJoin.getState().send({ command: "event_next" })).toMatchObject({ ok: false, error: expect.stringContaining("different service") })
    await Promise.resolve()
    expect(useJoin.getState().error).toBeNull()
    expect(useJoin.getState().note).toContain("different service")
    await new Promise((r) => setTimeout(r, 0))
    expect(calls.map((c) => c.cmd)).toEqual(["join_command", "join_secure", "join_me", "join_connect"])
  })
})
