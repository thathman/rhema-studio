// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn(async () => {}),
  listen: vi.fn(async () => () => {}),
}))
vi.mock("@tauri-apps/api/window", () => ({
  availableMonitors: vi.fn(async () => []),
}))
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({ get: vi.fn(), set: vi.fn(), save: vi.fn() })),
}))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { useRecovery } from "@/lib/live-recovery"
import { useShellStore } from "@/studio/shell-store"
import { RecoveryBanner } from "./recovery-banner"

let root: Root
let host: HTMLDivElement

beforeEach(async () => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  useRecovery.setState({ offer: null, dismissed: false, damaged: true, restoreError: null, durableRuns: [], durableRunsDismissed: false })
  useShellStore.setState({ workspace: "home", goRequest: null })
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<RecoveryBanner />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe("recovery damage notice", () => {
  it("explains that saved data was not restored and can be dismissed", async () => {
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Saved recovery data could not be read. Nothing was restored."
    )
    expect(host.textContent).not.toContain("Put back on the screens")
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Dismiss")!
        .click()
    )
    expect(useRecovery.getState().damaged).toBe(false)
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it("opens History to review a durable run without offering to put it on a screen", async () => {
    await act(async () => useRecovery.setState({
      damaged: true,
      durableRuns: [{ run_id: "run-1", program_id: "service-1", program_revision: 2, service_date: "2026-10-25", title: "Sunday service", time_zone: "Africa/Lagos", started_at: "2026-10-25T08:00:00.000Z", updated_at: "2026-10-25T09:00:00.000Z", finished_at: null, status: "active" }],
      durableRunsDismissed: false,
    }))

    expect(host.textContent).toContain("Sunday service")
    expect(host.textContent).toContain("Time after the last confirmed checkpoint is unknown")
    expect(host.textContent).not.toContain("Put back on the screens")
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Open History")!.click())

    expect(useShellStore.getState().goRequest).toBe("archive")
    expect(useRecovery.getState().durableRunsDismissed).toBe(true)
  })

  it("shows the failed output, partial state, retry, and explicit continue choice", async () => {
    const offer = {
      v: 1 as const,
      at: Date.now(),
      service: null,
      isLive: true,
      liveVerse: { reference: "John 3:16", segments: [{ text: "For God" }] },
      liveItemId: null,
      sources: {},
      outputsOn: ["main"],
      scenes: {},
      eventId: null,
      eventMomentId: null,
    }
    await act(async () =>
      useRecovery.setState({
        offer,
        dismissed: false,
        damaged: false,
        restoreError: "Could not restore Projector. Check the output and try again.",
      } as never)
    )

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not restore Projector. Check the output and try again."
    )
    expect(host.textContent).toContain("The recovery attempt is incomplete")
    expect(host.textContent).not.toContain("Nothing goes back until you choose.")
    expect(host.textContent).toContain("Put back on the screens")
    expect(host.textContent).toContain("Continue with available state")
  })
})
