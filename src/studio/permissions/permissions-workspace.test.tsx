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
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
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

  // #800 R1: Permissions is the one place to pause a desk (the Operators host card is status only).
  it("takes back control from a desk and gives it back, without unpairing it", async () => {
    useSettingsStore.setState({ remoteDevices: [{ hash: "b".repeat(64), name: "Desk C", paired_at: "2026-10-23T09:00:00Z", role: "screens" }] })
    const el = await mount()
    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Take back control from Desk C"]')!.click())
    expect(useSettingsStore.getState().remoteDevices[0].paused).toBe(true)
    expect(el.textContent).toContain("control paused")
    expect(useJournalStore.getState().entries.at(-1)?.label).toBe("Main desk took back control from Desk C")
    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Give control back to Desk C"]')!.click())
    expect(useSettingsStore.getState().remoteDevices).toHaveLength(1)
    expect(useSettingsStore.getState().remoteDevices[0].paused).toBeUndefined()
    expect(useJournalStore.getState().entries.at(-1)?.label).toBe("Main desk gave control back to Desk C")
    await act(async () => root.unmount())
  })

  it("shows a joined desk the host's durable approval status and lets it withdraw only its own pending request", async () => {
    const pending = { id: "request-1", kind: "scene_save", targetId: "scene-1", baseRevision: 4, state: "submitted", reason: "Use this for Sunday", createdAt: "2026-11-02T10:00:00Z", expiresAt: "2026-11-03T10:00:00Z", decidedBy: null, decidedAt: null, decisionNote: null }
    useJoin.setState({ status: "connected", me: { name: "Stage desk", role: "stage" }, live: null, paused: false })
    tauri.invoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "join_requests") return { requests: [pending] }
      if (command === "join_withdraw_request") return { ...pending, state: "withdrawn" }
      if (command === "remote_set_keys") return null
      if (command === "approvals_list") return []
      void args
      return null
    })
    const el = await mount()
    expect(el.textContent).toContain("My approval requests")
    expect(el.textContent).toContain("Waiting for the host")
    expect(el.textContent).toContain("Use this for Sunday")
    const withdraw = [...el.querySelectorAll("button")].find((button) => button.textContent?.includes("Withdraw request")) as HTMLButtonElement
    await act(async () => { withdraw.click(); await Promise.resolve(); await Promise.resolve() })
    expect(tauri.invoke).toHaveBeenCalledWith("join_withdraw_request", { address: expect.any(String), token: expect.any(String), id: "request-1" })
    expect(el.textContent).toContain("Withdrawn")
    await act(async () => root.unmount())
  })

  it("shows host decisions, requested changes and load failures in the joined request tracker", async () => {
    const request = (id: string, state: string, decisionNote: string | null = null) => ({
      id, kind: "scene_save", targetId: `scene-${id}`, baseRevision: 4, state, reason: "Prepare this scene",
      createdAt: "2026-11-02T10:00:00Z", expiresAt: "2026-11-03T10:00:00Z", decidedBy: state === "submitted" ? null : "Main desk",
      decidedAt: state === "submitted" ? null : "2026-11-02T11:00:00Z", decisionNote,
    })
    useJoin.setState({ status: "connected", me: { name: "Stage desk", role: "stage" }, live: null, paused: false })
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "join_requests") return { requests: [request("approved", "approved"), request("declined", "declined", "Use the approved welcome design"), request("changes", "requested_changes", "Please adjust the title")] }
      if (command === "approvals_list") return []
      return null
    })
    const el = await mount()
    expect(el.textContent).toContain("Approved")
    expect(el.textContent).toContain("Declined")
    expect(el.textContent).toContain("Changes requested")
    expect(el.textContent).toContain("Host note: Use the approved welcome design")
    expect(el.textContent).toContain("Host note: Please adjust the title")
    await act(async () => root.unmount())

    useJoin.setState({ status: "connected", me: { name: "Stage desk", role: "stage" }, live: null, paused: false })
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "join_requests") throw new Error("host unavailable")
      if (command === "approvals_list") return []
      return null
    })
    const failed = await mount()
    expect(failed.querySelector('[role="alert"]')?.textContent).toContain("host unavailable")
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

  it("assigns Stage desks only Stage outputs and saves the scope after host acknowledgement", async () => {
    useSettingsStore.setState({ remoteDevices: [{ hash: "stage-hash", name: "Stage tablet", paired_at: "2026-10-01T00:00:00Z", role: "stage" }] })
    useBroadcastStore.setState({ outputs: [
      { id: "main", name: "Sanctuary", type: "display", themeId: "classic-dark", monitorIndex: 0 },
      { id: "stage-east", name: "Stage East", type: "display", role: "stage", themeId: "classic-dark", monitorIndex: 0 },
      { id: "stage-west", name: "Stage West", type: "display", role: "stage", themeId: "classic-dark", monitorIndex: 0 },
      { id: "lobby", name: "Lobby", type: "display", role: "signage", themeId: "classic-dark", monitorIndex: 0 },
    ] as never })
    const el = await mount()
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Stage East Stage access for Stage tablet"]')).not.toBeNull()
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Stage West Stage access for Stage tablet"]')).not.toBeNull()
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Sanctuary Stage access for Stage tablet"]')).toBeNull()
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Lobby Stage access for Stage tablet"]')).toBeNull()

    await act(async () => el.querySelector<HTMLInputElement>('input[aria-label="Stage East Stage access for Stage tablet"]')!.click())
    expect(useSettingsStore.getState().remoteDevices[0]?.outputScope).toEqual(["stage-east"])
    expect(tauri.invoke).toHaveBeenCalledWith("remote_set_keys", expect.objectContaining({
      devices: [expect.objectContaining({ hash: "stage-hash", role: "stage", output_scope: ["stage-east"], group_take_scope: [] })],
    }))
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
      id: "host-request-uuid", kind: "scene_save", targetId: "remote-scene", baseRevision: null,
      requester: { id: "desk-key", name: "Screens desk" },
      payload: { scene: { id: "remote-scene", name: "Remote scene", background: "#000000", layers: [] } },
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
    expect(el.textContent).toContain("New scene · no prior host revision")
    expect(el.textContent).toContain("Approved scenes need an explicit Apply and never Take to Program")
    expect(el.textContent).toContain("Remote scene")
    expect(el.textContent).toContain("Blank composition · no visual layers")
    expect(el.textContent).toContain("No current local scene")
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

  it("blocks approval when the submitted scene is not a complete reviewable composition", async () => {
    const request = {
      id: "incomplete-scene-request", kind: "scene_save", targetId: "remote-scene", baseRevision: 7,
      requester: { id: "desk-key", name: "Screens desk" },
      payload: { scene: { id: "remote-scene", name: "Remote scene", background: "#000000" } },
      reason: "Update the welcome scene", state: "submitted", createdAt: "2026-10-30T09:00:00Z",
      expiresAt: "2026-10-31T09:00:00Z", decidedBy: null, decidedAt: null, decisionNote: null,
    }
    useBroadcastStore.setState({ scenes: [{ id: "remote-scene", name: "Current scene", background: "#000000", layers: [] }] as never })
    tauri.invoke.mockImplementation(async (command: string) => command === "approvals_list" ? [request] : null)
    resetApprovalRequests()
    await reloadApprovalRequests()
    const el = await mount()

    expect(el.textContent).toContain("complete, reviewable layer list")
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("complete, reviewable layer list")
    const approve = [...el.querySelectorAll("button")].find((button) => button.textContent?.includes("Approve"))
    expect(approve?.disabled).toBe(true)
    expect(tauri.invoke.mock.calls.some(([command]) => command === "approvals_decide")).toBe(false)
    expect(useApprovalRequestsStore.getState().requests).toMatchObject([{ id: "incomplete-scene-request", state: "submitted" }])
    await act(async () => root.unmount())
  })

  it("shows a gradient-only scene request and disables approval when its appearance cannot be applied", async () => {
    const currentGradient = { angle: 90, stops: [{ color: "#112233", offset: 0 }, { color: "#445566", offset: 1 }] }
    const requestedGradient = { angle: 180, stops: [{ color: "#112233", offset: 0 }, { color: "#ffffff", offset: 1 }] }
    const currentScene = {
      id: "remote-scene", name: "Welcome", background: "#112233", backgroundGradient: currentGradient,
      layers: [{ id: "heading", name: "Heading", kind: "text", text: "Welcome", textSecond: "Ẹ káàbọ̀", box: { x: 5, y: 8, w: 90, h: 20 }, opacity: 1, visible: true }],
    }
    const requestedLayer = { ...currentScene.layers[0]!, text: "Welcome home", textSecond: "Ẹ káàbọ̀ wá" }
    const request = {
      id: "gradient-scene-request", kind: "scene_save", targetId: "remote-scene", baseRevision: 7,
      requester: { id: "desk-key", name: "Screens desk" },
      payload: { scene: { ...currentScene, backgroundGradient: requestedGradient, layers: [requestedLayer] } },
      reason: "Update the welcome scene", state: "submitted", createdAt: "2026-10-30T09:00:00Z",
      expiresAt: "2026-10-31T09:00:00Z", decidedBy: null, decidedAt: null, decisionNote: null,
    }
    useBroadcastStore.setState({
      scenes: [currentScene] as never,
      outputs: [{ id: "main", name: "Sanctuary", type: "display", role: "congregation", language: "first", sceneId: "remote-scene", themeId: "classic-dark", monitorIndex: 0 }] as never,
    })
    tauri.invoke.mockImplementation(async (command: string) => command === "approvals_list" ? [request] : null)
    resetApprovalRequests()
    await reloadApprovalRequests()
    const el = await mount()

    expect(el.textContent).toContain("Background gradient: 90°")
    expect(el.textContent).toContain("180°")
    expect(el.textContent).toContain("not applied from a joined desk")
    expect(el.textContent).toContain("Sanctuary · First language only")
    expect(el.textContent).toContain("Heading: “Welcome” → “Welcome home”")
    const backgroundSwatches = [...el.querySelectorAll<HTMLElement>('[aria-label$="background paint preview"]')]
    expect(backgroundSwatches.map((swatch) => swatch.style.backgroundImage)).toEqual(expect.arrayContaining([
      expect.stringContaining("linear-gradient(90deg"),
      expect.stringContaining("linear-gradient(180deg"),
    ]))
    expect(el.textContent).toContain("not a pixel-perfect output preview")
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("cannot be applied from a joined desk")
    const approve = [...el.querySelectorAll("button")].find((button) => button.textContent?.includes("Approve"))
    expect(approve?.disabled).toBe(true)
    expect(tauri.invoke.mock.calls.some(([command]) => command === "approvals_decide")).toBe(false)
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
    expect(useShellStore.getState().prepareProgramRequest).toEqual({ programId: "service-1" })
    await act(async () => [...el.querySelectorAll("button")].find((button) => button.textContent?.includes("Confirm approved revision"))!.click())

    expect(tauri.invoke).toHaveBeenCalledWith("approvals_apply", { id: "plan-request-uuid" })
    expect(useApprovalRequestsStore.getState().requests).toMatchObject([{ id: "plan-request-uuid", state: "applied" }])
    expect(useBroadcastStore.getState().scenes).toBe(sceneStateBefore)
    expect(useBroadcastStore.getState().outputs).toBe(outputStateBefore)
    await act(async () => root.unmount())
  })

  it("shows a Stage request privately, requires host approval and Apply, and does not claim receiver playback", async () => {
    const request = {
      id: "stage-request-uuid", kind: "stage_send", targetId: "stage-east", baseRevision: null,
      requester: { id: "stage-key", name: "Stage desk" },
      payload: { target: "stage-east", text: "Choir enters now" },
      reason: "Choir needs a private cue", state: "submitted", createdAt: "2026-11-02T09:00:00Z",
      expiresAt: "2026-11-02T09:10:00Z", decidedBy: null, decidedAt: null, decisionNote: null,
    }
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "approvals_list") return [request]
      if (command === "approvals_decide") return { ...request, state: "approved", decidedBy: { id: "main-desk", name: "Main desk" }, decidedAt: "2026-11-02T09:01:00Z" }
      if (command === "approvals_apply") return { ...request, state: "applied", decidedBy: { id: "main-desk", name: "Main desk" }, decidedAt: "2026-11-02T09:01:00Z" }
      return null
    })
    resetApprovalRequests()
    await reloadApprovalRequests()
    const outputsBefore = useBroadcastStore.getState().outputs
    const el = await mount()
    expect(el.textContent).toContain("Private Stage message to stage-east")
    expect(el.textContent).toContain("Choir enters now")
    expect(el.textContent).toContain("It is not sent until the host applies this approval")

    await act(async () => [...el.querySelectorAll("button")].find((button) => button.textContent?.includes("Approve"))!.click())
    expect(useApprovalRequestsStore.getState().requests).toMatchObject([{ kind: "stage_send", state: "approved" }])
    expect(el.textContent).toContain("Approved · ready to send")
    await act(async () => [...el.querySelectorAll("button")].find((button) => button.textContent?.includes("Send approved Stage message"))!.click())
    expect(tauri.invoke).toHaveBeenCalledWith("approvals_apply", { id: "stage-request-uuid" })
    expect(useApprovalRequestsStore.getState().requests).toMatchObject([{ kind: "stage_send", state: "applied" }])
    expect(el.textContent).toContain("Applied · receiver not confirmed")
    expect(el.textContent).toContain("Receiver playback and whether anyone read it are not confirmed")
    expect(useBroadcastStore.getState().outputs).toBe(outputsBefore)
    await act(async () => root.unmount())
  })

  it("keeps an approved Stage cue visible with an actionable error when the target is gone", async () => {
    const request = {
      id: "stage-request-uuid", kind: "stage_send", targetId: "stage-east", baseRevision: null,
      requester: { id: "stage-key", name: "Stage desk" }, payload: { target: "stage-east", text: "Choir enters now" },
      reason: null, state: "approved", createdAt: "2026-11-02T09:00:00Z", expiresAt: "2026-11-02T09:10:00Z",
      decidedBy: { id: "main-desk", name: "Main desk" }, decidedAt: "2026-11-02T09:01:00Z", decisionNote: null,
    }
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "approvals_list") return [request]
      if (command === "approvals_apply") throw new Error("That stage display is no longer on the host.")
      return null
    })
    resetApprovalRequests()
    await reloadApprovalRequests()
    const el = await mount()
    await act(async () => [...el.querySelectorAll("button")].find((button) => button.textContent?.includes("Send approved Stage message"))!.click())
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("no longer on the host")
    expect(useApprovalRequestsStore.getState().requests).toMatchObject([{ kind: "stage_send", state: "approved" }])
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

    const apply = el.querySelector<HTMLButtonElement>('[aria-label="Apply approved scene change"]')!
    expect(apply.disabled).toBe(false)
    expect([...el.querySelectorAll('[role="status"]')].some((status) => status.textContent?.includes("No matching scene is available in this local library"))).toBe(true)
    expect(el.querySelector('[role="alert"]')).toBeNull()

    await act(async () => apply.click())

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

  it.each([
    ["declined", "The host declined this deletion. The scene remains in the library."],
    ["requested_changes", "The host requested changes. The scene remains in the library"],
    ["expired", "This deletion request expired. The scene remains in the library."],
    ["withdrawn", "This deletion request was withdrawn. The scene remains in the library."],
    ["superseded", "This deletion request is stale. The scene remains in the library"],
  ] as const)("does not describe a %s deletion as executable", async (state, notice) => {
    const request = {
      id: `scene-delete-${state}`, kind: "scene_delete", targetId: "scene-1", baseRevision: 7,
      requester: { id: "screens-key", name: "Screens desk" }, payload: { id: "scene-1" },
      reason: null, state, createdAt: "2026-10-30T09:00:00Z", expiresAt: "2026-10-31T09:00:00Z",
      decidedBy: null, decidedAt: null, decisionNote: null,
    }
    tauri.invoke.mockImplementation(async (command: string) => command === "approvals_list" ? [request] : null)
    resetApprovalRequests()
    await reloadApprovalRequests()
    useBroadcastStore.setState({ scenes: [{ id: "scene-1", name: "Welcome", background: "#000000", createdAt: 1, updatedAt: 1, layers: [] }] as never })
    const el = await mount()

    expect(el.textContent).toContain(notice)
    expect(el.textContent).not.toContain("The scene will be removed from the library only after explicit host Apply.")
    expect(el.querySelector('[aria-label="Apply approved scene deletion"]')).toBeNull()
    expect(tauri.invoke.mock.calls.some(([command]) => command === "approvals_apply")).toBe(false)
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
