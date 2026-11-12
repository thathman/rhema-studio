// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.4.0") }))

const { TeamWorkspace } = await import("./team-workspace")
const { useSettingsStore } = await import("@/stores/settings-store")
const { useSettingsDialogStore } = await import("@/lib/settings-dialog")
const { useShellStore } = await import("@/studio/shell-store")
const { useJoin } = await import("@/stores/join-store")

let root: Root
let host: HTMLDivElement

const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useSettingsStore.setState({ operatorName: "Tolu", requireApproval: true })
  useSettingsDialogStore.setState({ isOpen: false, activeSection: "audio" })
  useShellStore.setState({ workspace: "team", goRequest: null })
  useJoin.setState({ status: "off", me: null, live: null })
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<TeamWorkspace />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe("Team", () => {
  it("sends both church-folder buttons to Settings → Data and sync, not History (#814)", async () => {
    await act(async () => button("Share through the church folder").click())
    expect(useSettingsDialogStore.getState()).toMatchObject({ isOpen: true, activeSection: "data" })
    expect(useShellStore.getState().goRequest).not.toBe("archive")

    useSettingsDialogStore.setState({ isOpen: false, activeSection: "audio" })
    await act(async () => button("Set up").click())
    expect(useSettingsDialogStore.getState()).toMatchObject({ isOpen: true, activeSection: "data" })
  })

  it("shows the approval rule and links to Permissions, where its switch now is (#815)", async () => {
    expect(host.querySelector('input[type="checkbox"]')).toBeNull()
    expect(host.querySelector("#team-approval-policy")?.textContent).toContain("Ask before showing an unapproved service: on")
    await act(async () => button("Change in Permissions").click())
    expect(useShellStore.getState().goRequest).toBe("permissions")
    expect(useSettingsStore.getState().requireApproval).toBe(true)
  })

  it("on a joined desk shows the host's approval rule from Live State, not this desk's own (#815)", async () => {
    await act(async () => useJoin.setState({ status: "connected", me: { name: "Bible desk", role: "viewer", outputScope: [], groupTakeScope: [] }, live: { requireApproval: false } as never }))
    expect(host.querySelector("#team-approval-policy")?.textContent).toContain("Ask before showing an unapproved service: off (the main host’s setting)")
    await act(async () => useJoin.setState({ live: null }))
    expect(host.querySelector("#team-approval-policy")?.textContent).toContain("not shared by the main host yet")
    await act(async () => useJoin.setState({ status: "off", me: null, live: null }))
    expect(host.querySelector("#team-approval-policy")?.textContent).toContain("Ask before showing an unapproved service: on")
  })

  it("shows the operator's name without editing it, and opens the Desk menu to change it (#802)", async () => {
    expect(host.querySelector("#operator-name")).toBeNull()
    expect(host.querySelector("input")).toBeNull()
    expect(host.querySelector("#team-operator-name")?.textContent).toContain("Tolu")
    const before = useShellStore.getState().deskMenuRequest
    await act(async () => button("Change in the Desk menu").click())
    expect(useShellStore.getState().deskMenuRequest).toBe(before + 1)
  })

  it("asks for a name in the Desk menu when none is set", async () => {
    await act(async () => useSettingsStore.setState({ operatorName: "" }))
    expect(host.querySelector("#team-operator-name")?.textContent).toContain("not added yet")
    expect(button("Add it in the Desk menu")).toBeTruthy()
  })
})
