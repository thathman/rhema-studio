// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (cmd: string) => (cmd === "content_status" ? { available: true, path: "/data/studio.db", migrations: [], last_backup: null } : null)) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { SetupStatusDialog } from "./setup-status"
import { defaultSetup } from "@/lib/setup-readiness"
import { defaultBrandKit } from "@/lib/brand-kit"
import { useSettingsDialogStore } from "@/lib/settings-dialog"
import { useBibleStore } from "@/stores/bible-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useShellStore } from "@/studio/shell-store"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SECRET = "dg-secret-0123456789abcdef"
let root: Root | null = null
async function render() {
  const el = document.createElement("div")
  document.body.appendChild(el)
  root = createRoot(el)
  useShellStore.setState({ setupStatusOpen: true })
  await act(async () => root!.render(<SetupStatusDialog />))
}
const button = (t: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(t)) as HTMLButtonElement | undefined
const click = async (t: string) => {
  const b = button(t)
  if (!b) throw new Error(`no button “${t}”`)
  await act(async () => b.click())
}
const card = (id: string) => document.getElementById(id)?.closest("section")
const text = () => document.body.textContent ?? ""
const spies = { log: vi.spyOn(console, "log"), warn: vi.spyOn(console, "warn"), error: vi.spyOn(console, "error"), info: vi.spyOn(console, "info") }

beforeEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = null
  document.body.replaceChildren()
  for (const s of Object.values(spies)) s.mockClear()
  useSettingsStore.setState({ setup: defaultSetup(), brandKit: defaultBrandKit(), operatorName: "", sttProvider: "deepgram", deepgramApiKey: null, cloudSpeechConsentAt: "", mcpEnabled: false, joinAddress: "", remoteDevices: [], churchFolder: "", settingsSaveFailed: false })
  useShellStore.setState({ setupOpen: false, setupStatusOpen: false, outputsDialogOpen: false, editOutputRequest: null, designRequest: null })
  useSettingsDialogStore.setState({ isOpen: false })
  useBibleStore.setState({ translations: [{ id: 7, abbreviation: "KJV", title: "King James Version", language: "en", is_copyrighted: false, is_downloaded: true }] })
})
afterEach(() => {
  // No secret in anything logged while the page was open.
  for (const s of Object.values(spies)) expect(JSON.stringify(s.mock.calls)).not.toContain(SECRET)
})

describe("Setup status (#298)", () => {
  it("shows the church's setup, the equipment and this service as three separate cards", async () => {
    await render()
    expect(card("status-church")?.textContent).toContain("2 of 4 essentials done")
    expect(card("status-equipment")?.textContent).toContain("Main Display")
    expect(card("status-service")).toBeTruthy()
    // Unused features are named once as Not using and never counted.
    expect(card("status-equipment")?.textContent).toContain("Not using:")
    expect(card("status-equipment")?.textContent).toContain("OBS")
    expect(card("status-equipment")?.textContent).not.toContain("needs attention")
  })

  it("each item opens the page that fixes it", async () => {
    await render()
    await click("Fix in Church name")
    expect(useShellStore.getState().setupStatusOpen).toBe(false)
    expect(useShellStore.getState().setupOpen).toBe(true)
    expect(useSettingsStore.getState().setup.lastStep).toBe("church")

    await act(async () => useShellStore.setState({ setupOpen: false, setupStatusOpen: true }))
    await click("Add in Design → Brand")
    expect(useShellStore.getState().designRequest).toBe("brand")

    await act(async () => useShellStore.setState({ setupStatusOpen: true }))
    await click("Outputs")
    expect(useShellStore.getState().editOutputRequest).toEqual({ id: "main" })
  })

  it("a finished church setup has nothing to fix", async () => {
    useSettingsStore.setState({ brandKit: { ...defaultBrandKit(), churchName: "Grace Chapel" }, operatorName: "Tolu" })
    await render()
    expect(card("status-church")?.textContent).toContain("4 of 4 essentials done")
    expect(button("Fix in")).toBeUndefined()
  })
})

describe("cloud speech key (#298 scenario E)", () => {
  it("is flagged only once cloud speech is on, and saving a key clears it without ever showing the key", async () => {
    await render()
    // Deepgram is only the default choice: nobody agreed to send audio, so nothing is asked for.
    expect(card("status-equipment")?.textContent).toContain("Cloud speech")
    expect(card("status-equipment")?.textContent).toContain("Not using:")
    expect(button("Speech settings")).toBeUndefined()

    await act(async () => useSettingsStore.setState({ cloudSpeechConsentAt: "2026-10-23T09:00:00Z" }))
    expect(card("status-equipment")?.textContent).toContain("1 needs attention")
    expect(card("status-equipment")?.textContent).toContain("No key saved")
    await click("Speech settings")
    expect(useSettingsDialogStore.getState()).toMatchObject({ isOpen: true, activeSection: "speech" })

    await act(async () => useShellStore.setState({ setupStatusOpen: true }))
    await act(async () => useSettingsStore.setState({ deepgramApiKey: SECRET }))
    expect(card("status-equipment")?.textContent).toContain("Key saved")
    expect(card("status-equipment")?.textContent).not.toContain("needs attention")
    expect(text()).not.toContain(SECRET)
    expect(document.body.innerHTML).not.toContain(SECRET)
  })

  it("switching to speech on this computer removes the warning", async () => {
    useSettingsStore.setState({ cloudSpeechConsentAt: "2026-10-23T09:00:00Z" })
    await render()
    expect(card("status-equipment")?.textContent).toContain("1 needs attention")
    await act(async () => useSettingsStore.setState({ sttProvider: "whisper" }))
    expect(card("status-equipment")?.textContent).not.toContain("needs attention")
    expect(card("status-equipment")?.textContent).not.toContain("No key saved")
  })
})
