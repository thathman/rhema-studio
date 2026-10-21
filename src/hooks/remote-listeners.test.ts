import { beforeEach, describe, expect, it, vi } from "vitest"

const calls: Array<[string, unknown]> = []
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (cmd: string, args: unknown) => { calls.push([cmd, args]); return 8080 }) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))

import { restartRemoteListeners } from "./use-remote-control"
import { useSettingsStore } from "@/stores/settings-store"

describe("remote listeners after a restart (FR-04)", () => {
  beforeEach(() => { calls.length = 0 })

  it("starts the ones left running, with their ports and network choice, after the keys are in place", async () => {
    useSettingsStore.setState({ remoteListeners: { osc: false, http: true, oscPort: 8000, httpPort: 9090, lan: false } })
    await restartRemoteListeners()
    const names = calls.map(([c]) => c)
    expect(names.indexOf("remote_set_keys")).toBeGreaterThanOrEqual(0)
    expect(names.indexOf("remote_set_keys")).toBeLessThan(names.indexOf("start_http"))
    expect(calls.find(([c]) => c === "start_http")?.[1]).toEqual({ port: 9090, lan: false })
    expect(names).not.toContain("start_osc")
  })

  it("starts nothing when none was running", async () => {
    useSettingsStore.setState({ remoteListeners: { osc: false, http: false, oscPort: 8000, httpPort: 8080, lan: true } })
    await restartRemoteListeners()
    expect(calls).toEqual([])
  })
})
