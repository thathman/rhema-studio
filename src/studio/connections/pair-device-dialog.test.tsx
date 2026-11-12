// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { invoke } from "@tauri-apps/api/core"
import { PairDeviceDialog } from "./pair-device-dialog"
import { useShellStore } from "@/studio/shell-store"
import { useProductionTab } from "@/studio/production/production-tab"

const mockedInvoke = vi.mocked(invoke)
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mockedInvoke.mockReset()
  mockedInvoke.mockImplementation(async (command: string) => command === "get_http_status" ? { running: true, port: 8080, lan: true, tls_port: 8081 } : null)
  useShellStore.setState({ outputsDialogOpen: false, goRequest: null })
  useProductionTab.setState({ requested: null, open: false })
})

afterEach(() => {
  act(() => root.unmount())
  document.body.replaceChildren()
})

async function openDialog() {
  const host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<PairDeviceDialog />))
  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Pair a device")!.click())
}

const radio = (label: string) => [...document.body.querySelectorAll<HTMLButtonElement>('[role="radiogroup"][aria-label="Device to pair"] [role="radio"]')].find((button) => button.textContent === label)!

describe("one Pair a device entry (#823 F12)", () => {
  it("branches by device and explains every kind with the same three steps", async () => {
    await openDialog()
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("Pair a device")
    for (const label of ["Phone remote", "Volunteer computer", "OBS computer", "TV screen", "Camera phone"]) {
      await act(async () => radio(label).click())
      expect(radio(label).getAttribute("aria-checked")).toBe("true")
      const steps = [...document.body.querySelectorAll(`ol[aria-label="Steps to pair a ${label.toLowerCase()}"] li`)].map((li) => li.textContent ?? "")
      expect(steps).toHaveLength(3)
      expect(steps[0]).toMatch(/^On the /)
      expect(steps[1]).toMatch(/^On this computer: /)
      expect(steps[2]).toMatch(/^Then: /)
    }
  })

  it("keeps the main computer code for phones and computers, and sends TVs and cameras to their own secure flows", async () => {
    await openDialog()
    const showCode = () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Show pairing code")
    expect(showCode()).toBeTruthy()
    await act(async () => radio("Volunteer computer").click())
    expect(showCode()).toBeTruthy()
    await act(async () => radio("TV screen").click())
    expect(showCode()).toBeUndefined()
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Open Outputs")!.click())
    expect(useShellStore.getState().outputsDialogOpen).toBe(true)
    expect(mockedInvoke).not.toHaveBeenCalledWith("remote_pair_start")
  })

  it("opens Cameras for a camera phone without starting a pairing code", async () => {
    await openDialog()
    await act(async () => radio("Camera phone").click())
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Open Cameras")!.click())
    expect(useProductionTab.getState()).toMatchObject({ requested: "cameras", open: true, liveToolsTab: "production" })
    expect(useShellStore.getState().goRequest).toBe("present")
    expect(mockedInvoke).not.toHaveBeenCalledWith("remote_pair_start")
  })
})
