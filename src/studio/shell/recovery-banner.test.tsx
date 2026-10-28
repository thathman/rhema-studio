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
import { RecoveryBanner } from "./recovery-banner"

let root: Root
let host: HTMLDivElement

beforeEach(async () => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  useRecovery.setState({ offer: null, dismissed: false, damaged: true })
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
})
