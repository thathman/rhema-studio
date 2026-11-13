// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.4.0") }))
vi.mock("@/components/settings/church-profile-section", () => ({ ChurchProfileSection: () => { throw new Error("boom") } }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { SettingsPage } from "@/components/settings-dialog"
import { useSettingsDialogStore } from "@/lib/settings-dialog"

/** UX audit slice 5: a section that throws shows its own note; the rest of Settings keeps working. */
describe("Settings section error boundary", () => {
  it("contains one failing section and recovers when another section is chosen", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.spyOn(console, "error").mockImplementation(() => {})
    useSettingsDialogStore.getState().setActiveSection("church")
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => root.render(<SettingsPage />))
    expect(host.querySelector("[role=alert]")?.textContent).toContain("Something went wrong in Settings →")
    expect(host.querySelector("h1")?.textContent).toBeTruthy()
    await act(async () => useSettingsDialogStore.getState().setActiveSection("help"))
    expect(host.querySelector("[role=alert]")?.textContent ?? "").not.toContain("Something went wrong")
    await act(async () => root.unmount())
  })
})
