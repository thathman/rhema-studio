import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LiveStateV1 } from "@/lib/live-state"

const { invokeMock, listeners, settings } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listeners: new Map<string, (event: { payload: string }) => void>(),
  settings: {
    joinAddress: "https://host.local",
    joinToken: "paired-token",
    joinSecure: null as null | { port: number; fingerprint: string },
  },
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (
    event: string,
    callback: (event: { payload: string }) => void
  ) => {
    listeners.set(event, callback)
    return () => listeners.delete(event)
  },
}))
vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: { getState: () => settings },
}))
vi.mock("@/stores/notices-store", () => ({ takeUnableReason: () => null }))

import { readHostReceivers, useJoin } from "./join-store"

describe("joined host state", () => {
  beforeEach(() => {
    listeners.clear()
    invokeMock.mockReset()
    invokeMock.mockImplementation(async (command: string) =>
      command === "join_me" ? { name: "Viewer desk", role: "viewer" } : null
    )
    useJoin.setState({
      status: "off",
      error: null,
      me: null,
      paused: false,
      note: null,
      secure: null,
      live: null,
      receivedAt: 0,
      clockSkewMs: null,
    })
  })

  afterEach(() => vi.clearAllMocks())

  it("clears the last host snapshot when the host refuses the desk", async () => {
    await useJoin.getState().connect()
    useJoin.setState({
      status: "connected",
      me: { name: "Viewer desk", role: "viewer" },
      live: { v: 1 } as LiveStateV1,
      paused: true,
      note: "A prior host note",
      receivedAt: 1234,
      clockSkewMs: 42,
    })

    listeners.get("join:state")?.({
      payload: JSON.stringify({
        state: "refused",
        error: "This desk must pair again",
        me: { name: "Viewer desk", role: "viewer" },
      }),
    })
    listeners.get("join:live")?.({
      payload: JSON.stringify({ v: 1, at: 1235 } as LiveStateV1),
    })

    expect(useJoin.getState()).toMatchObject({
      status: "refused",
      error: "This desk must pair again",
      me: null,
      live: null,
      paused: false,
      note: null,
      receivedAt: 0,
      clockSkewMs: null,
    })
  })

  it("reads only validated receiver confirmation for the paired host", async () => {
    invokeMock.mockResolvedValueOnce({ outputs: [{ id: "tv", feed: true, watching: 2, seq: 7, acked: 7, confirmed: true, privateToken: "ignored" }] })
    await expect(readHostReceivers()).resolves.toEqual([{ id: "tv", feed: true, watching: 2, seq: 7, acked: 7, confirmed: true }])
    expect(invokeMock).toHaveBeenCalledWith("join_receivers", { address: "https://host.local", token: "paired-token" })
  })

  it("preserves the host output revision from an accepted Take", async () => {
    invokeMock.mockResolvedValueOnce({ note: null, revision: 17 })
    await expect(useJoin.getState().send({ command: "take_scene", value: { output: "tv", scene: "welcome" } }))
      .resolves.toEqual({ ok: true, revision: 17 })
  })

  it("keeps the output revision and service seen when the operator chose the Take", async () => {
    useJoin.setState({ live: { v: 1, revisions: { "output:tv": 9 }, service: { id: "new-service", title: "New service" } } as unknown as LiveStateV1 })
    await useJoin.getState().send({
      command: "take_scene",
      value: { output: "tv", scene: "welcome" },
      seen: { "output:tv": 7 },
      service: "original-service",
    })
    expect(invokeMock).toHaveBeenCalledWith("join_command", expect.objectContaining({
      service: "original-service",
      command: expect.objectContaining({ seen: { "output:tv": 7 } }),
    }))
  })

  it("sends an explicit empty service when the captured host state has no open service", async () => {
    useJoin.setState({ live: { v: 1, revisions: { "output:tv": 9 }, service: null } as unknown as LiveStateV1 })
    await useJoin.getState().send({
      command: "take_scene",
      value: { output: "tv", scene: "welcome" },
      seen: { "output:tv": 9 },
      service: "",
    })
    expect(invokeMock).toHaveBeenCalledWith("join_command", expect.objectContaining({
      service: "",
      command: expect.objectContaining({ seen: { "output:tv": 9 } }),
    }))
  })

  it("fails closed when receiver confirmation fields are missing or malformed", async () => {
    invokeMock.mockResolvedValueOnce({ outputs: [{ id: "tv", feed: true, watching: "2", confirmed: true }] })
    await expect(readHostReceivers()).rejects.toThrow("incomplete receiver confirmation")
    invokeMock.mockResolvedValueOnce({ outputs: [{ id: "tv", feed: "yes" }] })
    await expect(readHostReceivers()).rejects.toThrow("malformed receiver row")
  })

  it("ignores a host snapshot arriving after the desk left", async () => {
    await useJoin.getState().leave()
    listeners.get("join:live")?.({ payload: JSON.stringify({ v: 1, at: 1235 } as LiveStateV1) })
    expect(useJoin.getState().live).toBeNull()
  })

  it("clears the last host snapshot when reconnect requires pairing again", async () => {
    useJoin.setState({
      status: "connected",
      me: { name: "Viewer desk", role: "viewer" },
      live: { v: 1 } as LiveStateV1,
      paused: true,
      note: "A prior host note",
      receivedAt: 1234,
      clockSkewMs: 42,
    })
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "join_me") return { name: "Viewer desk", role: "viewer" }
      if (command === "join_connect")
        throw new Error("This desk must pair again")
      return null
    })

    await useJoin.getState().connect()

    expect(useJoin.getState()).toMatchObject({
      status: "refused",
      error: expect.stringContaining("pair again"),
      me: null,
      live: null,
      paused: false,
      note: null,
      receivedAt: 0,
      clockSkewMs: null,
    })
  })
})

describe("a first connect that fails is tried again (#411 Companion hunt)", () => {
  afterEach(() => vi.useRealTimers())

  it("keeps trying, backing off, and stops once connected", async () => {
    vi.useFakeTimers()
    let failures = 2
    invokeMock.mockReset()
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "join_me") {
        if (failures-- > 0) throw new Error("host not reachable")
        return { name: "OBS PC", role: "obs" }
      }
      return null
    })
    useJoin.setState({ status: "off" })
    await useJoin.getState().connect()
    expect(useJoin.getState().status).toBe("reconnecting")
    await vi.advanceTimersByTimeAsync(5_000) // first retry
    expect(invokeMock.mock.calls.filter(([c]) => c === "join_me")).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(10_000) // second, after a longer wait
    expect(invokeMock.mock.calls.filter(([c]) => c === "join_connect")).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(invokeMock.mock.calls.filter(([c]) => c === "join_me")).toHaveLength(3) // no more once connected
  })

  it("Leave while a retry is still waiting stops it for good", async () => {
    vi.useFakeTimers()
    let release: (e: Error) => void = () => {}
    invokeMock.mockReset()
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "join_me") return new Promise((_, reject) => { release = reject })
      return null
    })
    useJoin.setState({ status: "off" })
    const pending = useJoin.getState().connect()
    await vi.advanceTimersByTimeAsync(0)
    await useJoin.getState().leave()
    release(new Error("host not reachable")) // the old attempt fails after Leave
    await pending
    await vi.advanceTimersByTimeAsync(120_000)
    expect(invokeMock.mock.calls.filter(([c]) => c === "join_me")).toHaveLength(1)
    expect(useJoin.getState().status).not.toBe("reconnecting")
  })

  it("Leave while the host is answering: the late answer does not connect", async () => {
    let answer: (v: unknown) => void = () => {}
    invokeMock.mockReset()
    invokeMock.mockImplementation(async (cmd: string) => (cmd === "join_me" ? new Promise((r) => { answer = r }) : null))
    useJoin.setState({ status: "off" })
    const pending = useJoin.getState().connect()
    await new Promise((r) => setTimeout(r, 0))
    await useJoin.getState().leave()
    answer({ name: "OBS PC", role: "obs" })
    await pending
    expect(invokeMock.mock.calls.filter(([c]) => c === "join_connect")).toHaveLength(0)
  })
})
