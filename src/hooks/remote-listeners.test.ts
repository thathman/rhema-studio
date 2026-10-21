import { beforeEach, describe, expect, it, vi } from "vitest"

const calls: Array<[string, unknown]> = []
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (cmd: string, args: unknown) => { calls.push([cmd, args]); return cmd.endsWith("_status") ? { running: false } : 8080 }) }))
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

  it("never opens the whole network by itself: without a key, a network listener is not restarted", async () => {
    useSettingsStore.setState({ remoteListeners: { osc: true, http: true, oscPort: 8000, httpPort: 8080, lan: true }, remoteAuthRequired: false, remoteSecret: "", remoteDevices: [] })
    await restartRemoteListeners()
    expect(calls.map(([c]) => c).filter((c) => c.startsWith("start_"))).toEqual([])
    useSettingsStore.setState({ remoteDevices: [{ hash: "h", name: "Phone", paired_at: "2026-10-21T10:00:00Z" }] as never, remoteAuthRequired: true })
    await restartRemoteListeners()
    expect(calls.map(([c]) => c)).toContain("start_http")
  })

  it("starts nothing when none was running", async () => {
    useSettingsStore.setState({ remoteListeners: { osc: false, http: false, oscPort: 8000, httpPort: 8080, lan: true } })
    await restartRemoteListeners()
    expect(calls).toEqual([])
  })
})
