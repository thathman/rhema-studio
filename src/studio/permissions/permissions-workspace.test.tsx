// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PermissionsWorkspace } from "./permissions-workspace"

const disk = vi.hoisted(() => ({ values: new Map<string, unknown>() }))
const tauri = vi.hoisted(() => ({ invoke: vi.fn(async (command: string, args?: unknown): Promise<unknown> => {
  void args
  return command === "approvals_list" ? [] : null
}) }))
vi.mock("@tauri-apps/plugin-store", () => ({ load: async () => ({
  get: async (key: string) => disk.values.get(key),
  set: async (key: string, value: unknown) => { disk.values.set(key, value) },
  save: async () => {},
}) }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

const { createSceneEditApproval, reloadSceneApprovals, useSceneApprovalsStore } = await import("@/stores/scene-approvals-store")
const { useJoin } = await import("@/stores/join-store")
const { useSettingsStore } = await import("@/stores/settings-store")
const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useShellStore } = await import("@/studio/shell-store")
const { reloadApprovalRequests, resetApprovalRequests, useApprovalRequestsStore } = await import("./approval-requests-store")

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
  useShellStore.setState({ workspace: "permissions", prepareProgramRequest: null })
  tauri.invoke.mockClear()
  tauri.invoke.mockImplementation(async (command: string) => command === "approvals_list" ? [] : null)
  resetApprovalRequests()
  await reloadApprovalRequests()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

describe("Permissions workspace", () => {
  it("shows role-less paired devices as read-only Viewer until the host assigns a role", async () => {
    useSettingsStore.setState({ remoteDevices: [{ hash: "legacy-hash", name: "Legacy phone", paired_at: "2026-10-01T00:00:00Z" }] })
    const el = await mount()

    expect(el.textContent).toContain("View only · needs a role")
    expect(el.querySelector<HTMLSelectElement>('select[aria-label="Role for Legacy phone"]')?.value).toBe("viewer")
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Rhema Recorder access for Legacy phone"]')?.checked).toBe(false)
    await act(async () => root.unmount())
  })

  it("saves Recorder grant changes only after host confirmation and keeps them read-only on joined desks", async () => {
    useSettingsStore.setState({ remoteDevices: [{ hash: "phone-hash", name: "Phone", paired_at: "2026-10-01T00:00:00Z", role: "viewer" }] })
    let acknowledge!: () => void
    tauri.invoke.mockImplementation((command: string, args?: unknown) => {
      void args
      if (command === "remote_set_keys") return new Promise<void>((resolve) => { acknowledge = resolve })
      return Promise.resolve(command === "approvals_list" ? [] : null)
    })
    const el = await mount()
    const checkbox = el.querySelector<HTMLInputElement>('input[aria-label="Rhema Recorder access for Phone"]')!

    await act(async () => { checkbox.click(); await Promise.resolve() })
    expect(checkbox.checked).toBe(false)
    expect(tauri.invoke).toHaveBeenCalledWith("remote_set_keys", expect.objectContaining({
      devices: [expect.objectContaining({ hash: "phone-hash", record: true })],
    }))
    await act(async () => acknowledge())
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Rhema Recorder access for Phone"]')?.checked).toBe(true)
    await act(async () => root.unmount())

    useJoin.setState({ status: "connected" })
    const joinedEl = await mount()
    expect(joinedEl.querySelector<HTMLInputElement>('input[aria-label="Rhema Recorder access for Phone"]')?.disabled).toBe(true)
    await act(async () => root.unmount())
  })

  it("shows an inline error and preserves the Recorder grant when the host rejects it", async () => {
    useSettingsStore.setState({ remoteDevices: [{ hash: "phone-hash", name: "Phone", paired_at: "2026-10-01T00:00:00Z", role: "viewer" }] })
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "remote_set_keys") throw new Error("host unavailable")
      return command === "approvals_list" ? [] : null
    })
    const el = await mount()

    await act(async () => { el.querySelector<HTMLInputElement>('input[aria-label="Rhema Recorder access for Phone"]')!.click(); await Promise.resolve(); await Promise.resolve() })
    expect(useSettingsStore.getState().remoteDevices[0]?.record).toBeUndefined()
    expect(el.textContent).toContain("host did not confirm the Recorder access change")
    await act(async () => root.unmount())
  })

  it("requires host review for legacy Screens scopes and allows only congregation output grants", async () => {
    useSettingsStore.setState({ remoteDevices: [{ hash: "screen-hash", name: "Screens tablet", paired_at: "2026-10-01T00:00:00Z", role: "screens" }] })
    useBroadcastStore.setState({ outputs: [
      { id: "main", name: "Sanctuary", type: "display", themeId: "classic-dark", monitorIndex: 0 },
      { id: "overflow", name: "Overflow", type: "ndi", themeId: "classic-dark", monitorIndex: 0 },
      { id: "stage", name: "Stage Confidence", type: "display", role: "stage", themeId: "classic-dark", monitorIndex: 0 },
      { id: "lobby", name: "Lobby", type: "display", role: "signage", themeId: "classic-dark", monitorIndex: 0 },
    ] as never })
    const el = await mount()
    expect(el.textContent).toContain("Legacy Screens access needs scope review")
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Sanctuary output access for Screens tablet"]')).not.toBeNull()
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Overflow output access for Screens tablet"]')).not.toBeNull()
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Stage Confidence output access for Screens tablet"]')).toBeNull()
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Lobby output access for Screens tablet"]')).toBeNull()
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Sanctuary group Take access for Screens tablet"]')).toBeNull()
    expect(el.textContent).toContain("No separate group Take grant is saved")

    await act(async () => el.querySelector<HTMLInputElement>('input[aria-label="Sanctuary output access for Screens tablet"]')!.click())
    expect(useSettingsStore.getState().remoteDevices[0]?.outputScope).toEqual(["main"])
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Sanctuary group Take access for Screens tablet"]')).not.toBeNull()
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Overflow group Take access for Screens tablet"]')).toBeNull()
    await act(async () => el.querySelector<HTMLInputElement>('input[aria-label="Sanctuary group Take access for Screens tablet"]')!.click())
    expect(useSettingsStore.getState().remoteDevices[0]?.groupTakeScope).toEqual(["main"])
    await act(async () => root.unmount())
  })

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

  it("decides the exact host request ID without applying a scene or changing outputs", async () => {
    const request = {
      id: "host-request-uuid", kind: "scene_save", targetId: "remote-scene", baseRevision: 7,
      requester: { id: "desk-key", name: "Screens desk" },
      payload: { scene: { id: "remote-scene", name: "Remote scene", layers: [] } },
      reason: "Prepare the welcome screen", state: "submitted", createdAt: "2026-10-30T09:00:00Z",
      expiresAt: "2026-10-31T09:00:00Z", decidedBy: null, decidedAt: null, decisionNote: null,
    }
    tauri.invoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "approvals_list") return [request]
      if (command === "approvals_decide") return { ...request, state: (args as { decision: string }).decision === "approve" ? "approved" : "declined" }
      return null
    })
    resetApprovalRequests()
    await reloadApprovalRequests()
    const scenesBefore = useBroadcastStore.getState().scenes
    const outputsBefore = useBroadcastStore.getState().outputs
    const el = await mount()

    expect(el.textContent).toContain("Approval Requests")
    expect(el.textContent).toContain("Based on host revision 7")
    expect(el.textContent).toContain("Approval records authorization; it does not save a scene")
    expect(el.textContent).toContain("Remote scene")
    expect(el.textContent).toContain("Proposed composition: 0 visual layers")
    await act(async () => [...el.querySelectorAll("button")].find((button) => button.textContent?.includes("Approve"))!.click())

    expect(tauri.invoke).toHaveBeenCalledWith("approvals_decide", { id: "host-request-uuid", decision: "approve" })
    expect(tauri.invoke.mock.calls.some(([command]) => command === "approvals_apply")).toBe(false)
    expect(useApprovalRequestsStore.getState().requests).toMatchObject([{ id: "host-request-uuid", state: "approved" }])
    expect(useBroadcastStore.getState().scenes).toBe(scenesBefore)
    expect(useBroadcastStore.getState().outputs).toBe(outputsBefore)
    expect(useSceneApprovalsStore.getState().requests).toEqual([])
    await act(async () => root.unmount())
  })

  it("confirms an approved plan request through the host's revision check", async () => {
    const request = {
      id: "plan-request-uuid", kind: "plan_approve", targetId: "service-1", baseRevision: 4,
      requester: { id: "editor-key", name: "Editor desk" },
      payload: { title: "Sunday service", revision: 4, items: 6 },
      reason: "Please review the updated order", state: "approved", createdAt: "2026-10-30T09:00:00Z",
      expiresAt: "2026-10-31T09:00:00Z", decidedBy: { id: "main-desk", name: "Main desk" },
      decidedAt: "2026-10-30T10:00:00Z", decisionNote: null,
    }
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "approvals_list") return [request]
      if (command === "approvals_apply") return { ...request, state: "applied" }
      return null
    })
    resetApprovalRequests()
    await reloadApprovalRequests()
    const sceneStateBefore = useBroadcastStore.getState().scenes
    const outputStateBefore = useBroadcastStore.getState().outputs
    const el = await mount()

    expect(el.textContent).toContain("Sunday service")
    expect(el.textContent).toContain("revision 4")
    expect(el.textContent).toContain("Approve this exact revision in Prepare first")
    await act(async () => [...el.querySelectorAll("button")].find((button) => button.textContent?.includes("Open in Prepare"))!.click())
    expect(useShellStore.getState().prepareProgramRequest).toBe("service-1")
    await act(async () => [...el.querySelectorAll("button")].find((button) => button.textContent?.includes("Confirm approved revision"))!.click())

    expect(tauri.invoke).toHaveBeenCalledWith("approvals_apply", { id: "plan-request-uuid" })
    expect(useApprovalRequestsStore.getState().requests).toMatchObject([{ id: "plan-request-uuid", state: "applied" }])
    expect(useBroadcastStore.getState().scenes).toBe(sceneStateBefore)
    expect(useBroadcastStore.getState().outputs).toBe(outputStateBefore)
    await act(async () => root.unmount())
  })

  it("keeps a plan request approved when Prepare has not approved its revision", async () => {
    const request = {
      id: "plan-request-uuid", kind: "plan_approve", targetId: "service-1", baseRevision: 4,
      requester: { id: "editor-key", name: "Editor desk" },
      payload: { title: "Sunday service", revision: 4, items: 6 },
      reason: null, state: "approved", createdAt: "2026-10-30T09:00:00Z",
      expiresAt: "2026-10-31T09:00:00Z", decidedBy: { id: "main-desk", name: "Main desk" },
      decidedAt: "2026-10-30T10:00:00Z", decisionNote: null,
    }
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "approvals_list") return [request]
      if (command === "approvals_apply") throw new Error("Approve this revision of the plan in Prepare first; the request stays approved until then.")
      return null
    })
    resetApprovalRequests()
    await reloadApprovalRequests()
    const outputStateBefore = useBroadcastStore.getState().outputs
    const el = await mount()

    await act(async () => [...el.querySelectorAll("button")].find((button) => button.textContent?.includes("Confirm approved revision"))!.click())

    expect(tauri.invoke).toHaveBeenCalledWith("approvals_apply", { id: "plan-request-uuid" })
    expect(el.textContent).toContain("Approve this revision of the plan in Prepare first")
    expect(useApprovalRequestsStore.getState().requests).toMatchObject([{ id: "plan-request-uuid", state: "approved" }])
    expect(useBroadcastStore.getState().outputs).toBe(outputStateBefore)
    await act(async () => root.unmount())
  })

  it("does not expose Apply for an approved scene request", async () => {
    const request = {
      id: "scene-request-uuid", kind: "scene_save", targetId: "scene-1", baseRevision: 7,
      requester: { id: "screens-key", name: "Screens desk" },
      payload: { scene: { id: "scene-1", name: "Welcome" } },
      reason: null, state: "approved", createdAt: "2026-10-30T09:00:00Z",
      expiresAt: "2026-10-31T09:00:00Z", decidedBy: { id: "main-desk", name: "Main desk" },
      decidedAt: "2026-10-30T10:00:00Z", decisionNote: null,
    }
    tauri.invoke.mockImplementation(async (command: string) => command === "approvals_list" ? [request] : null)
    resetApprovalRequests()
    await reloadApprovalRequests()
    const el = await mount()

    expect(el.textContent).toContain("Scene apply workflow is not available yet")
    expect([...el.querySelectorAll("button")].some((button) => button.textContent?.includes("Confirm approved revision"))).toBe(false)
    expect([...el.querySelectorAll("button")].some((button) => button.textContent?.includes("Open in Prepare"))).toBe(false)
    expect(tauri.invoke.mock.calls.some(([command]) => command === "approvals_apply")).toBe(false)
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
