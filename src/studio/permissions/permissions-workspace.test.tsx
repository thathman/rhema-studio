// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PermissionsWorkspace } from "./permissions-workspace"

vi.mock("@chenglou/pretext", () => ({ clearCache: vi.fn() }))
vi.mock("@chenglou/pretext/rich-inline", () => ({
  prepareRichInline: vi.fn(() => ({})),
  materializeRichInlineLineRange: vi.fn(() => []),
  measureRichInlineStats: vi.fn(() => ({ width: 0, height: 0, lines: 0 })),
  walkRichInlineLineRanges: vi.fn(),
}))

const disk = vi.hoisted(() => ({ values: new Map<string, unknown>(), pending: new Map<string, unknown>(), failSave: false, failSceneSaves: 0 }))
const tauri = vi.hoisted(() => ({ invoke: vi.fn(async (command: string, args?: unknown): Promise<unknown> => {
  void args
  return command === "approvals_list" ? [] : null
}) }))
vi.mock("@tauri-apps/plugin-store", () => ({ load: async () => ({
  get: async (key: string) => disk.pending.has(key) ? disk.pending.get(key) : disk.values.get(key),
  set: async (key: string, value: unknown) => { disk.pending.set(key, value) },
  save: async () => {
    if (disk.failSave) throw new Error("local store unavailable")
    const scenes = disk.pending.get("scenes")
    if (disk.failSceneSaves > 0 && Array.isArray(scenes) && scenes.some((scene) => (scene as { name?: string }).name === "Fail local save")) {
      disk.failSceneSaves -= 1
      throw new Error("one scene write failed")
    }
    for (const [key, value] of disk.pending) disk.values.set(key, value)
    disk.pending.clear()
  },
}) }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

const { createSceneEditApproval, reloadSceneApprovals, useSceneApprovalsStore } = await import("@/stores/scene-approvals-store")
const { useJoin } = await import("@/stores/join-store")
const { useSettingsStore } = await import("@/stores/settings-store")
const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { sceneForOutput } = await import("@/lib/scenes")
const { useJournalStore } = await import("@/stores/journal-store")
const { useShellStore } = await import("@/studio/shell-store")
const { applySceneApprovalRequest, reloadApprovalRequests, resetApprovalRequests, useApprovalRequestsStore } = await import("./approval-requests-store")

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
  disk.pending.clear()
  disk.failSave = false
  disk.failSceneSaves = 0
  await reloadSceneApprovals()
  useSceneApprovalsStore.setState({ requests: [], audit: [], hydrated: true, error: null })
  useJoin.setState({ status: "off", me: null, live: null })
  useSettingsStore.setState({ operatorName: "Main desk", remoteDevices: [] })
  useJournalStore.setState({ entries: [], startItemIds: null, added: 0, keptAt: 0 })
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

  it("saves Recorder grant changes only after host confirmation and hides the host roster on joined desks", async () => {
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
    expect(joinedEl.textContent).toContain("Your access")
    expect(joinedEl.querySelector<HTMLInputElement>('input[aria-label="Rhema Recorder access for Phone"]')).toBeNull()
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
    expect(el.textContent).toContain("An approved scene needs an explicit host-checked Apply")
    expect(el.textContent).toContain("Remote scene")
    expect(el.textContent).toContain("Proposed composition: 0 visual layers")
    await act(async () => [...el.querySelectorAll("button")].find((button) => button.textContent?.includes("Approve"))!.click())

    expect(tauri.invoke).toHaveBeenCalledWith("approvals_decide", { id: "host-request-uuid", decision: "approve" })
    expect(tauri.invoke.mock.calls.some(([command]) => command === "approvals_apply")).toBe(false)
    expect(useApprovalRequestsStore.getState().requests).toMatchObject([{ id: "host-request-uuid", state: "approved" }])
    expect(el.textContent).toContain("Apply approved scene change")
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

  it("applies an approved scene through the host check and saves it without changing outputs", async () => {
    const request = {
      id: "scene-request-uuid", kind: "scene_save", targetId: "scene-1", baseRevision: 7,
      requester: { id: "screens-key", name: "Screens desk" },
      payload: { scene: { id: "scene-1", name: "Welcome", background: "#000000", layers: [] } },
      reason: null, state: "approved", createdAt: "2026-10-30T09:00:00Z",
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
    const takenScene = { id: "scene-1", name: "Welcome · taken revision", background: "#111111", createdAt: 1, updatedAt: 1, layers: [] }
    useBroadcastStore.setState({
      scenes: [takenScene] as never,
      outputs: [{ id: "sanctuary", name: "Sanctuary", type: "display", sceneId: "scene-1", sceneSnapshot: takenScene, themeId: "classic-dark", monitorIndex: 0 }] as never,
      isLive: true,
    })
    const outputsBefore = useBroadcastStore.getState().outputs
    const el = await mount()

    expect(el.textContent).toContain("Apply checks the scene revision and current output assignment on this host")
    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Apply approved scene change"]')!.click())

    expect(tauri.invoke).toHaveBeenCalledWith("approvals_apply", { id: "scene-request-uuid" })
    expect(useApprovalRequestsStore.getState().requests).toMatchObject([{ id: "scene-request-uuid", state: "applied" }])
    expect(el.textContent).toContain("Applied by host · no Live change")
    expect(el.textContent).toContain("Saved in the local scene library after host approval")
    expect(useBroadcastStore.getState().scenes).toEqual(expect.arrayContaining([expect.objectContaining({ id: "scene-1", name: "Welcome" })]))
    expect(useBroadcastStore.getState().outputs).toBe(outputsBefore)
    expect(sceneForOutput(useBroadcastStore.getState().outputs[0], useBroadcastStore.getState().scenes)?.name).toBe("Welcome · taken revision")
    expect(useBroadcastStore.getState().isLive).toBe(true)
    await act(async () => root.unmount())
  })

  it("refreshes a stale scene request from the host and leaves the library unchanged", async () => {
    const approved = {
      id: "scene-request-uuid", kind: "scene_save", targetId: "scene-1", baseRevision: 7,
      requester: { id: "screens-key", name: "Screens desk" },
      payload: { scene: { id: "scene-1", name: "Welcome", background: "#000000", layers: [] } },
      reason: null, state: "approved", createdAt: "2026-10-30T09:00:00Z",
      expiresAt: "2026-10-31T09:00:00Z", decidedBy: { id: "main-desk", name: "Main desk" },
      decidedAt: "2026-10-30T10:00:00Z", decisionNote: null,
    }
    let hostRequest = approved
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "approvals_list") return [hostRequest]
      if (command === "approvals_apply") {
        hostRequest = { ...approved, state: "superseded" }
        throw new Error("The scene changed after this request was approved.")
      }
      return null
    })
    resetApprovalRequests()
    await reloadApprovalRequests()
    const sceneStateBefore = useBroadcastStore.getState().scenes
    const el = await mount()

    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Apply approved scene change"]')!.click())

    expect(useApprovalRequestsStore.getState().requests).toMatchObject([{ id: "scene-request-uuid", state: "superseded" }])
    expect(el.textContent).toContain("Superseded")
    expect(el.textContent).toContain("The scene changed after this request was approved.")
    expect(useBroadcastStore.getState().scenes).toBe(sceneStateBefore)
    await act(async () => root.unmount())
  })

  it("shows a host rejection and never applies the rejected scene", async () => {
    const request = {
      id: "scene-request-uuid", kind: "scene_save", targetId: "scene-1", baseRevision: 7,
      requester: { id: "screens-key", name: "Screens desk" },
      payload: { scene: { id: "scene-1", name: "Welcome", background: "#000000", layers: [] } },
      reason: null, state: "submitted", createdAt: "2026-10-30T09:00:00Z",
      expiresAt: "2026-10-31T09:00:00Z", decidedBy: null, decidedAt: null, decisionNote: null,
    }
    tauri.invoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "approvals_list") return [request]
      if (command === "approvals_decide") return { ...request, state: (args as { decision: string }).decision === "decline" ? "declined" : "approved" }
      return null
    })
    resetApprovalRequests()
    await reloadApprovalRequests()
    const sceneStateBefore = useBroadcastStore.getState().scenes
    const el = await mount()

    await act(async () => [...el.querySelectorAll("button")].find((button) => button.textContent?.includes("Decline"))!.click())

    expect(tauri.invoke).toHaveBeenCalledWith("approvals_decide", { id: "scene-request-uuid", decision: "decline" })
    expect(useApprovalRequestsStore.getState().requests).toMatchObject([{ id: "scene-request-uuid", state: "declined" }])
    expect(el.textContent).toContain("Declined")
    expect(useBroadcastStore.getState().scenes).toBe(sceneStateBefore)
    expect(tauri.invoke.mock.calls.some(([command]) => command === "approvals_apply")).toBe(false)
    await act(async () => root.unmount())
  })

  it("keeps a scene request approved and reports a host failure when scene state is unavailable", async () => {
    const request = {
      id: "scene-request-uuid", kind: "scene_save", targetId: "scene-1", baseRevision: 7,
      requester: { id: "screens-key", name: "Screens desk" },
      payload: { scene: { id: "scene-1", name: "Welcome", background: "#000000", layers: [] } },
      reason: null, state: "approved", createdAt: "2026-10-30T09:00:00Z",
      expiresAt: "2026-10-31T09:00:00Z", decidedBy: { id: "main-desk", name: "Main desk" },
      decidedAt: "2026-10-30T10:00:00Z", decisionNote: null,
    }
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "approvals_list") return [request]
      if (command === "approvals_apply") throw new Error("The host has not shared its scenes yet; try again in a moment.")
      return null
    })
    resetApprovalRequests()
    await reloadApprovalRequests()
    const sceneStateBefore = useBroadcastStore.getState().scenes
    const el = await mount()

    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Apply approved scene change"]')!.click())

    expect(useApprovalRequestsStore.getState().requests).toMatchObject([{ id: "scene-request-uuid", state: "approved" }])
    expect(el.textContent).toContain("The host has not shared its scenes yet; try again in a moment.")
    expect(useBroadcastStore.getState().scenes).toBe(sceneStateBefore)
    await act(async () => root.unmount())
  })

  it("recovers an applied scene after local persistence fails without applying it at the host twice", async () => {
    const original = { id: "scene-1", name: "Before approval", background: "#111111", createdAt: 1, updatedAt: 7, layers: [] }
    const approved = {
      id: "scene-request-uuid", kind: "scene_save", targetId: "scene-1", baseRevision: 7,
      requester: { id: "screens-key", name: "Screens desk" },
      payload: { scene: { id: "scene-1", name: "Welcome", background: "#000000", layers: [] } },
      reason: null, state: "approved", createdAt: "2026-10-30T09:00:00Z",
      expiresAt: "2026-10-31T09:00:00Z", decidedBy: { id: "main-desk", name: "Main desk" },
      decidedAt: "2026-10-30T10:00:00Z", decisionNote: null,
    }
    let hostRequest = approved
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "approvals_list") return [hostRequest]
      if (command === "approvals_apply") {
        hostRequest = { ...approved, state: "applied" }
        disk.failSave = true
        return hostRequest
      }
      return null
    })
    resetApprovalRequests()
    await reloadApprovalRequests()
    useBroadcastStore.setState({ scenes: [original] as never })
    const el = await mount()

    await act(async () => {
      el.querySelector<HTMLButtonElement>('[aria-label="Apply approved scene change"]')!.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(useApprovalRequestsStore.getState().requests).toMatchObject([{ id: "scene-request-uuid", state: "applied" }])
    expect(el.textContent).toContain("Retry local scene save")
    expect(el.textContent).toContain("local store unavailable")
    expect(disk.values.get("sceneApprovalRecovery:scene-request-uuid")).toMatchObject({ requestId: "scene-request-uuid", targetId: "scene-1" })
    expect(tauri.invoke.mock.calls.filter(([command]) => command === "approvals_apply")).toHaveLength(1)

    // Simulate a restart: the disk still has the old scene, while the host request is durably applied.
    disk.failSave = false
    disk.pending.clear()
    disk.values.set("scenes", [original])
    const newerLocalScene = { ...original, name: "Newer local design" }
    useBroadcastStore.setState({ scenes: [newerLocalScene] as never })
    resetApprovalRequests()
    await reloadApprovalRequests()
    await act(async () => {
      el.querySelector<HTMLButtonElement>('[aria-label="Retry local approved scene save"]')!.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(useBroadcastStore.getState().scenes).toEqual([newerLocalScene])
    expect(el.textContent).toContain("stopped to protect the newer design")
    expect(tauri.invoke.mock.calls.filter(([command]) => command === "approvals_apply")).toHaveLength(1)

    useBroadcastStore.setState({ scenes: [newerLocalScene] as never })
    await act(async () => {
      el.querySelector<HTMLButtonElement>('[aria-label="Keep newer local scene"]')!.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(tauri.invoke.mock.calls.filter(([command]) => command === "approvals_apply")).toHaveLength(1)
    expect(useBroadcastStore.getState().scenes).toEqual([newerLocalScene])
    expect(disk.values.get("scenes")).toEqual([newerLocalScene])
    expect(disk.values.get("sceneApprovalRecovery:scene-request-uuid")).toMatchObject({ status: "kept_local" })
    expect(el.textContent).toContain("You kept the newer local scene")
    expect(el.querySelector('[aria-label="Retry local approved scene save"]')).toBeNull()
    await act(async () => root.unmount())
  })

  it("recovers an applied host scene after restart when the local scene still matches the saved compare point", async () => {
    const original = { id: "scene-1", name: "Before approval", background: "#111111", createdAt: 1, updatedAt: 7, layers: [] }
    const applied = {
      id: "scene-restart-request", kind: "scene_save", targetId: "scene-1", baseRevision: 7,
      requester: { id: "screens-key", name: "Screens desk" },
      payload: { scene: { id: "scene-1", name: "Welcome", background: "#000000", layers: [] } },
      reason: null, state: "applied", createdAt: "2026-10-30T09:00:00Z",
      expiresAt: "2026-10-31T09:00:00Z", decidedBy: { id: "main-desk", name: "Main desk" },
      decidedAt: "2026-10-30T10:00:00Z", decisionNote: null,
    }
    disk.values.set("scenes", [original])
    disk.values.set("sceneApprovalRecovery:scene-restart-request", {
      requestId: applied.id, kind: applied.kind, targetId: applied.targetId, beforeScene: original, status: "pending",
    })
    useBroadcastStore.setState({ scenes: [original] as never })
    tauri.invoke.mockImplementation(async (command: string) => command === "approvals_list" ? [applied] : null)
    resetApprovalRequests()
    await reloadApprovalRequests()

    await expect(applySceneApprovalRequest(applied.id)).resolves.toMatchObject({ state: "applied" })

    expect(tauri.invoke.mock.calls.some(([command]) => command === "approvals_apply")).toBe(false)
    expect(useBroadcastStore.getState().scenes).toEqual(expect.arrayContaining([expect.objectContaining({ id: "scene-1", name: "Welcome" })]))
    expect(disk.values.get("scenes")).toEqual(expect.arrayContaining([expect.objectContaining({ id: "scene-1", name: "Welcome" })]))
    expect(disk.values.get("sceneApprovalRecovery:scene-restart-request")).toBeNull()
  })

  it("keeps the recovery marker when the host applies but the response is lost", async () => {
    const original = { id: "scene-1", name: "Before approval", background: "#111111", createdAt: 1, updatedAt: 7, layers: [] }
    const approved = {
      id: "scene-lost-response", kind: "scene_save", targetId: "scene-1", baseRevision: 7,
      requester: { id: "screens-key", name: "Screens desk" },
      payload: { scene: { id: "scene-1", name: "Welcome", background: "#000000", layers: [] } },
      reason: null, state: "approved", createdAt: "2026-10-30T09:00:00Z",
      expiresAt: "2026-10-31T09:00:00Z", decidedBy: { id: "main-desk", name: "Main desk" },
      decidedAt: "2026-10-30T10:00:00Z", decisionNote: null,
    }
    let hostRequest = approved
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "approvals_list") return [hostRequest]
      if (command === "approvals_apply") {
        hostRequest = { ...approved, state: "applied" }
        throw new Error("The host committed the approval but the response was interrupted.")
      }
      return null
    })
    useBroadcastStore.setState({ scenes: [original] as never })
    resetApprovalRequests()
    await reloadApprovalRequests()
    const el = await mount()

    await act(async () => {
      el.querySelector<HTMLButtonElement>('[aria-label="Apply approved scene change"]')!.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(useApprovalRequestsStore.getState().requests).toMatchObject([{ id: "scene-lost-response", state: "applied" }])
    expect(disk.values.get("sceneApprovalRecovery:scene-lost-response")).toMatchObject({ status: "pending" })
    expect(el.textContent).toContain("response was interrupted")

    await act(async () => {
      el.querySelector<HTMLButtonElement>('[aria-label="Retry local approved scene save"]')!.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(tauri.invoke.mock.calls.filter(([command]) => command === "approvals_apply")).toHaveLength(1)
    expect(useBroadcastStore.getState().scenes).toEqual(expect.arrayContaining([expect.objectContaining({ id: "scene-1", name: "Welcome" })]))
    await act(async () => root.unmount())
  })

  it("retains recovery when the host applies but both response and immediate refresh fail", async () => {
    const original = { id: "scene-1", name: "Before approval", background: "#111111", createdAt: 1, updatedAt: 7, layers: [] }
    const approved = {
      id: "scene-refresh-recovery", kind: "scene_save", targetId: "scene-1", baseRevision: 7,
      requester: { id: "screens-key", name: "Screens desk" },
      payload: { scene: { id: "scene-1", name: "Welcome", background: "#000000", layers: [] } },
      reason: null, state: "approved", createdAt: "2026-10-30T09:00:00Z",
      expiresAt: "2026-10-31T09:00:00Z", decidedBy: { id: "main-desk", name: "Main desk" },
      decidedAt: "2026-10-30T10:00:00Z", decisionNote: null,
    }
    let hostRequest = approved
    let failedListCalls = 0
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "approvals_list") {
        if (failedListCalls > 0) {
          failedListCalls -= 1
          throw new Error("Host list temporarily unavailable")
        }
        return [hostRequest]
      }
      if (command === "approvals_apply") {
        hostRequest = { ...approved, state: "applied" }
        failedListCalls = 1
        throw new Error("The host committed the approval but the response was interrupted.")
      }
      return null
    })
    useBroadcastStore.setState({ scenes: [original] as never })
    resetApprovalRequests()
    await reloadApprovalRequests()
    const el = await mount()

    await act(async () => {
      el.querySelector<HTMLButtonElement>('[aria-label="Apply approved scene change"]')!.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(useApprovalRequestsStore.getState().requests).toMatchObject([{ id: approved.id, state: "approved" }])
    expect(useApprovalRequestsStore.getState().localHostStatusUnknown[approved.id]).toBe(true)
    expect(disk.values.get(`sceneApprovalRecovery:${approved.id}`)).toMatchObject({ status: "pending" })
    expect(el.textContent).toContain("its status is unknown")
    expect(el.querySelector('[aria-label="Apply approved scene change"]')).toBeNull()

    await act(async () => {
      [...el.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Refresh host status")!.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(useApprovalRequestsStore.getState().requests).toMatchObject([{ id: approved.id, state: "applied" }])
    expect(useApprovalRequestsStore.getState().localHostStatusUnknown[approved.id]).toBeUndefined()
    await act(async () => {
      el.querySelector<HTMLButtonElement>('[aria-label="Retry local approved scene save"]')!.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(tauri.invoke.mock.calls.filter(([command]) => command === "approvals_apply")).toHaveLength(1)
    expect(useBroadcastStore.getState().scenes).toEqual(expect.arrayContaining([expect.objectContaining({ id: "scene-1", name: "Welcome" })]))
    expect(disk.values.get(`sceneApprovalRecovery:${approved.id}`)).toBeNull()
    await act(async () => root.unmount())
  })

  it("journals a same-process recovery once after the first scene write fails", async () => {
    const original = { id: "scene-1", name: "Before approval", background: "#111111", createdAt: 1, updatedAt: 7, layers: [] }
    const approved = {
      id: "scene-same-process", kind: "scene_save", targetId: "scene-1", baseRevision: 7,
      requester: { id: "screens-key", name: "Screens desk" },
      payload: { scene: { id: "scene-1", name: "Welcome", background: "#000000", layers: [] } },
      reason: null, state: "approved", createdAt: "2026-10-30T09:00:00Z",
      expiresAt: "2026-10-31T09:00:00Z", decidedBy: { id: "main-desk", name: "Main desk" },
      decidedAt: "2026-10-30T10:00:00Z", decisionNote: null,
    }
    let hostRequest = approved
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "approvals_list") return [hostRequest]
      if (command === "approvals_apply") {
        hostRequest = { ...approved, state: "applied" }
        disk.failSave = true
        return hostRequest
      }
      return null
    })
    useBroadcastStore.setState({ scenes: [original] as never })
    resetApprovalRequests()
    await reloadApprovalRequests()
    const el = await mount()
    await act(async () => {
      el.querySelector<HTMLButtonElement>('[aria-label="Apply approved scene change"]')!.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(useBroadcastStore.getState().scenes).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Welcome" })]))
    expect(useJournalStore.getState().entries).toHaveLength(0)

    disk.failSave = false
    await act(async () => {
      el.querySelector<HTMLButtonElement>('[aria-label="Retry local approved scene save"]')!.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(useJournalStore.getState().entries).toHaveLength(1)
    expect(useJournalStore.getState().entries[0]?.label).toContain("Scene Welcome changed by Screens desk")
    expect(tauri.invoke.mock.calls.filter(([command]) => command === "approvals_apply")).toHaveLength(1)
    await act(async () => root.unmount())
  })

  it("serializes concurrent approved scene applies without losing either request recovery", async () => {
    const request = (id: string, name: string) => ({
      id, kind: "scene_save", targetId: id, baseRevision: 7,
      requester: { id: "screens-key", name: "Screens desk" },
      payload: { scene: { id, name, background: "#000000", layers: [] } },
      reason: null, state: "approved", createdAt: "2026-10-30T09:00:00Z",
      expiresAt: "2026-10-31T09:00:00Z", decidedBy: { id: "main-desk", name: "Main desk" },
      decidedAt: "2026-10-30T10:00:00Z", decisionNote: null,
    })
    const first = request("scene-first", "Fail local save")
    const second = request("scene-second", "Second scene")
    let hostRequests = [first, second]
    tauri.invoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "approvals_list") return hostRequests
      if (command === "approvals_apply") {
        const id = (args as { id: string }).id
        hostRequests = hostRequests.map((item) => item.id === id ? { ...item, state: "applied" } : item)
        if (id === first.id) disk.failSceneSaves = 1
        return hostRequests.find((item) => item.id === id)
      }
      return null
    })
    useBroadcastStore.setState({ scenes: [] })
    resetApprovalRequests()
    await reloadApprovalRequests()

    const results = await Promise.allSettled([applySceneApprovalRequest(first.id), applySceneApprovalRequest(second.id)])

    expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled"])
    expect(disk.values.get("sceneApprovalRecovery:scene-first")).toMatchObject({ status: "pending", requestId: first.id })
    expect(disk.values.get("sceneApprovalRecovery:scene-second")).toBeNull()
    expect(tauri.invoke.mock.calls.filter(([command]) => command === "approvals_apply")).toHaveLength(2)
    expect(useApprovalRequestsStore.getState().requests).toMatchObject([
      { id: first.id, state: "applied" },
      { id: second.id, state: "applied" },
    ])
  })

  it("blocks deletion while an output still shows the scene", async () => {
    const request = {
      id: "scene-delete-request", kind: "scene_delete", targetId: "scene-1", baseRevision: 7,
      requester: { id: "screens-key", name: "Screens desk" },
      payload: { id: "scene-1" }, reason: null, state: "approved", createdAt: "2026-10-30T09:00:00Z",
      expiresAt: "2026-10-31T09:00:00Z", decidedBy: { id: "main-desk", name: "Main desk" },
      decidedAt: "2026-10-30T10:00:00Z", decisionNote: null,
    }
    tauri.invoke.mockImplementation(async (command: string) => command === "approvals_list" ? [request] : null)
    resetApprovalRequests()
    await reloadApprovalRequests()
    useBroadcastStore.setState({
      scenes: [{ id: "scene-1", name: "Welcome", background: "#000000", createdAt: 1, updatedAt: 1, layers: [] }] as never,
      outputs: [{ id: "sanctuary", name: "Sanctuary", type: "display", sceneId: "scene-1", themeId: "classic-dark", monitorIndex: 0 }] as never,
    })
    const el = await mount()

    const apply = el.querySelector<HTMLButtonElement>('[aria-label="Apply approved scene deletion"]')!
    expect(apply.disabled).toBe(true)
    expect(el.textContent).toContain("Move every real screen away from this scene")
    expect(tauri.invoke.mock.calls.some(([command]) => command === "approvals_apply")).toBe(false)
    expect(useBroadcastStore.getState().scenes).toEqual(expect.arrayContaining([expect.objectContaining({ id: "scene-1" })]))
    await act(async () => root.unmount())
  })

  it("allows approved deletion when the scene is only assigned to rehearsal output", async () => {
    const request = {
      id: "scene-delete-request", kind: "scene_delete", targetId: "scene-1", baseRevision: 7,
      requester: { id: "screens-key", name: "Screens desk" },
      payload: { id: "scene-1" }, reason: null, state: "approved", createdAt: "2026-10-30T09:00:00Z",
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
    useBroadcastStore.setState({
      scenes: [{ id: "scene-1", name: "Welcome", background: "#000000", createdAt: 1, updatedAt: 7, layers: [] }] as never,
      outputs: [{ id: "sanctuary", name: "Sanctuary", type: "display", sceneId: "scene-1", themeId: "classic-dark", monitorIndex: 0 }] as never,
      rehearsal: true,
      rehearsalReturn: { outputScenes: {} } as never,
    })
    const el = await mount()

    const apply = el.querySelector<HTMLButtonElement>('[aria-label="Apply approved scene deletion"]')!
    expect(apply.disabled).toBe(false)
    expect(el.textContent).not.toContain("Move every real screen away from this scene")
    await act(async () => {
      apply.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(tauri.invoke).toHaveBeenCalledWith("approvals_apply", { id: "scene-delete-request" })
    expect(useBroadcastStore.getState().scenes).toEqual([])
    expect(useApprovalRequestsStore.getState().requests).toMatchObject([{ id: "scene-delete-request", state: "applied" }])
    await act(async () => root.unmount())
  })

  it("keeps approvals and device roles read-only on a joined desk", async () => {
    await createSceneEditApproval({ scene: null, sceneId: "scene-1", name: "Scene", savedAt: 1, by: "Screens desk", at: 10 })
    useSettingsStore.setState({ remoteDevices: [{ hash: "device-hash", name: "Other operator phone", paired_at: "2026-10-01T00:00:00Z", role: "screens" as const, record: true }] })
    useJoin.setState({ status: "connected", me: { name: "Viewer desk", role: "viewer", outputScope: ["main"], groupTakeScope: [] } })
    const el = await mount()

    expect(el.textContent).toContain("read-only for approvals and device access")
    expect(el.textContent).toContain("Your access")
    expect(el.textContent).toContain("Viewer desk")
    expect(el.textContent).toContain("View only")
    expect(el.textContent).toContain("1 assigned")
    expect(el.textContent).toContain("Recorder grant is separate from your role")
    expect(el.textContent).not.toContain("Other operator phone")
    expect([...el.querySelectorAll("button")].some((button) => button.textContent?.includes("Accept"))).toBe(false)
    expect([...el.querySelectorAll("button")].some((button) => button.textContent?.includes("Decline"))).toBe(false)
    expect(el.querySelector<HTMLSelectElement>('select[aria-label^="Role for "]')).toBeNull()
    expect(el.querySelector<HTMLInputElement>('input[aria-label^="Rhema Recorder access for "]')).toBeNull()
    await act(async () => root.unmount())
  })
})
