// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const invokeHost = vi.hoisted(() => vi.fn())
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeHost }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { useSettingsStore } from "@/stores/settings-store"
import { useShellStore } from "@/studio/shell-store"
import { useProductionTab } from "@/studio/production/production-tab"
import { LiveCrewStatus } from "./live-crew-status"

const initialRemoteDevices = useSettingsStore.getState().remoteDevices
let element: HTMLDivElement
let root: Root

const pairedDevices = [
  { hash: "bible-key", name: "Bible desk", paired_at: "2026-11-03T10:00:00Z", role: "bible" as const },
  { hash: "stage-key", name: "Stage desk", paired_at: "2026-11-03T10:00:00Z", role: "stage" as const },
]

async function renderStatus() {
  element = document.createElement("div")
  document.body.append(element)
  root = createRoot(element)
  await act(async () => {
    root.render(<LiveCrewStatus />)
    await Promise.resolve()
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  invokeHost.mockReset()
  useSettingsStore.setState({ remoteDevices: [] })
  useProductionTab.setState({ requested: null, selected: "timekeeper", open: false, liveToolsTab: "bible" })
  useShellStore.setState({ workspace: "home", goRequest: null })
})

afterEach(() => {
  act(() => root?.unmount())
  element?.remove()
  useSettingsStore.setState({ remoteDevices: initialRemoteDevices })
  useProductionTab.setState(useProductionTab.getInitialState())
  useShellStore.setState(useShellStore.getInitialState())
  vi.restoreAllMocks()
})

describe("Live crew status", () => {
  it("shows host-confirmed connected count and opens the existing Operators panel", async () => {
    useSettingsStore.setState({ remoteDevices: pairedDevices })
    invokeHost.mockResolvedValue({
      running: true,
      lan: true,
      port: 8000,
      addresses: ["192.168.1.2"],
      desks: [
        { hash: "bible-key", name: "Bible desk", address: "192.168.1.9", connected: true, lastSeenMs: 100 },
        { hash: "stage-key", name: "Stage desk", address: "192.168.1.10", connected: false, lastSeenMs: 50 },
      ],
    })
    await renderStatus()

    const status = element.querySelector<HTMLButtonElement>("[data-testid='live-crew-status']")!
    expect(status.textContent).toContain("1/2 online")
    expect(status.getAttribute("aria-label")).toBe("Review paired operators: 1 of 2 paired operators connected")
    await act(async () => status.click())
    expect(useProductionTab.getState()).toMatchObject({ selected: "operators", requested: "operators", open: true, liveToolsTab: "production" })
    expect(useShellStore.getState().goRequest).toBe("present")
  })

  it("reports an unavailable host status instead of showing a false zero", async () => {
    useSettingsStore.setState({ remoteDevices: pairedDevices })
    invokeHost.mockRejectedValue(new Error("Host status unavailable"))
    await renderStatus()

    const status = element.querySelector<HTMLButtonElement>("[data-testid='live-crew-status']")!
    expect(status.textContent).toContain("Unavailable")
    expect(status.getAttribute("aria-label")).toBe("Review paired operators: operator status unavailable")
  })

  it("keeps solo-host Live free of a redundant crew control and host polling", async () => {
    await renderStatus()

    expect(element.querySelector("[data-testid='live-crew-status']")).toBeNull()
    expect(invokeHost).not.toHaveBeenCalled()
  })
})
