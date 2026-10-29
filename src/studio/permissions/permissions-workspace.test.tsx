// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PermissionsWorkspace } from "./permissions-workspace"

const disk = vi.hoisted(() => ({ values: new Map<string, unknown>() }))
vi.mock("@tauri-apps/plugin-store", () => ({ load: async () => ({
  get: async (key: string) => disk.values.get(key),
  set: async (key: string, value: unknown) => { disk.values.set(key, value) },
  save: async () => {},
}) }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

const { createSceneEditApproval, reloadSceneApprovals, useSceneApprovalsStore } = await import("@/stores/scene-approvals-store")
const { useJoin } = await import("@/stores/join-store")
const { useSettingsStore } = await import("@/stores/settings-store")
const { useBroadcastStore } = await import("@/stores/broadcast-store")

let root: Root
let host: HTMLDivElement

async function mount() {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<PermissionsWorkspace />))
  return host
}

beforeEach(async () => {
  disk.values.clear()
  await reloadSceneApprovals()
  useSceneApprovalsStore.setState({ requests: [], audit: [], hydrated: true, error: null })
  useJoin.setState({ status: "off", me: null, live: null })
  useSettingsStore.setState({ operatorName: "Main desk", remoteDevices: [] })
  useBroadcastStore.setState({ scenes: [], outputs: [], rehearsal: false, rehearsalReturn: null })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

describe("Permissions workspace", () => {
  it("accepts a saved request on the host and applies the scene without taking it live", async () => {
    await createSceneEditApproval({
      scene: { id: "remote-scene", name: "Remote scene", background: "#000000", createdAt: 1, updatedAt: 2, layers: [] },
      sceneId: "remote-scene", name: "Remote scene", savedAt: null, by: "Screens desk", at: 10,
    })
    const el = await mount()

    await act(async () => [...el.querySelectorAll("button")].find((button) => button.textContent?.includes("Accept"))!.click())

    expect(useSceneApprovalsStore.getState().requests).toMatchObject([{ status: "approved", decidedBy: "Main desk" }])
    expect(useBroadcastStore.getState().scenes.map((scene) => scene.id)).toEqual(["remote-scene"])
    expect(useBroadcastStore.getState().outputs).toEqual([])
    await act(async () => root.unmount())
  })

  it("keeps approvals and device roles read-only on a joined desk", async () => {
    await createSceneEditApproval({ scene: null, sceneId: "scene-1", name: "Scene", savedAt: 1, by: "Screens desk", at: 10 })
    useSettingsStore.setState({ remoteDevices: [{ hash: "device-hash", name: "Phone", paired_at: "2026-10-01T00:00:00Z", role: "viewer" as const }] })
    useJoin.setState({ status: "connected" })
    const el = await mount()

    expect(el.textContent).toContain("read-only for approvals and device access")
    expect([...el.querySelectorAll("button")].some((button) => button.textContent?.includes("Accept"))).toBe(false)
    expect([...el.querySelectorAll("button")].some((button) => button.textContent?.includes("Decline"))).toBe(false)
    expect(el.querySelector<HTMLSelectElement>('select[aria-label="Role for Phone"]')?.disabled).toBe(true)
    await act(async () => root.unmount())
  })
})
