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

import { useJoin } from "./join-store"

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
