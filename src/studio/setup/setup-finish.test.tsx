// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = []
let folderWritable = true
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args })
    if (cmd === "setup_data_paths") return { folder: "/Users/tolu/Library/Application Support/com.openbezal.rhema", database: "/Users/tolu/Library/Application Support/com.openbezal.rhema/studio.db" }
    if (cmd === "setup_test_folder") {
      if (folderWritable) return null
      throw "Rhema could not write there: Permission denied"
    }
    if (cmd === "get_audio_devices") return [{ id: "usb-desk", name: "Sound desk USB", sample_rate: 48000, channels: 2, is_default: false }]
    return null
  }),
}))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(async () => "/Volumes/USB/rhema-backup.db"), open: vi.fn(async () => null) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { SetupWizard } from "./setup-wizard"
import { SetupCard } from "./setup-card"
import { useSetupLaunch } from "./setup-launch"
import { defaultSetup } from "@/lib/setup-readiness"
import { defaultBrandKit } from "@/lib/brand-kit"
import { useSettingsStore } from "@/stores/settings-store"
import { useBibleStore } from "@/stores/bible-store"
import { useServiceStore } from "@/stores/service-store"
import { useShellStore } from "@/studio/shell-store"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
async function render(node: React.ReactNode) {
  const el = document.createElement("div")
  document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => root!.render(node))
}
const button = (t: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(t)) as HTMLButtonElement | undefined
const click = async (t: string) => {
  const b = button(t)
  if (!b) throw new Error(`no button “${t}”`)
  await act(async () => b.click())
}
const heading = () => document.querySelector('[role="dialog"] h2')?.textContent
const text = () => document.body.textContent ?? ""

beforeEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = null
  document.body.replaceChildren()
  calls.length = 0
  folderWritable = true
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  useSettingsStore.setState({ setup: defaultSetup(), brandKit: { ...defaultBrandKit(), churchName: "Grace Chapel" }, operatorName: "Tolu", onboardingComplete: false, remoteDevices: [], joinAddress: "", churchFolder: "", audioDeviceId: null, settingsSaveFailed: false })
  useShellStore.setState({ setupOpen: false, outputsDialogOpen: false, goRequest: null, workspace: "home" })
  useBibleStore.setState({ translations: [{ id: 7, abbreviation: "KJV", title: "King James Version", language: "en", is_copyrighted: false, is_downloaded: true }], activeTranslationId: 7, secondaryTranslationId: null })
  useServiceStore.setState({ programs: [], current: null, dirty: false })
  useSetupLaunch.setState({ checked: false, autoOpened: false })
})

async function openAt(step: string) {
  useSettingsStore.getState().setSetup({ lastStep: step as never })
  useShellStore.setState({ setupOpen: true })
  await render(<SetupWizard />)
}

describe("the setup's Finish step: safety and backups (#298 S7)", () => {
  it("shows where services and songs are kept, and copies the database path", async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    await openAt("finish")
    expect(text()).toContain("com.openbezal.rhema/studio.db")
    await click("Copy")
    expect(writeText).toHaveBeenCalledWith("/Users/tolu/Library/Application Support/com.openbezal.rhema/studio.db")
    await click("Show in folder")
    expect(calls.some((c) => c.cmd === "setup_show_data_folder")).toBe(true)
  })

  it("Back up now makes a backup file and shows when", async () => {
    await openAt("finish")
    expect(text()).toContain("None made from this computer yet")
    await click("Back up now")
    const args = calls.find((c) => c.cmd === "content_backup")?.args as { path: string; installation: string }
    expect(args.path).toBe("/Volumes/USB/rhema-backup.db")
    // The settings and looks go in the same file (#298 E6).
    expect(JSON.parse(args.installation)).toMatchObject({ kind: "rhema-installation", v: 1, settings: { church: expect.any(Object), machine: expect.any(Object), operator: expect.any(Object) } })
    expect(useSettingsStore.getState().setup.lastBackupAt).not.toBe("")
    expect(text()).toMatch(/Today at /)
  })

  it("tests the church folder by writing and deleting a file, and says so either way", async () => {
    useSettingsStore.setState({ churchFolder: "/Volumes/Church" })
    await openAt("finish")
    await click("Test the folder")
    expect(calls.find((c) => c.cmd === "setup_test_folder")?.args).toEqual({ path: "/Volumes/Church" })
    expect(text()).toContain("Rhema can write there")
    folderWritable = false
    await click("Test the folder")
    expect(text()).toContain("Permission denied")
  })

  it("Run screen test goes to the Screens step", async () => {
    await openAt("finish")
    await click("Run screen test")
    expect(heading()).toBe("Screens")
  })

  it("Start a sample service opens Prepare with an unsaved rundown and closes the setup", async () => {
    await openAt("finish")
    await click("Start a sample service")
    await act(async () => {})
    expect(useShellStore.getState().setupOpen).toBe(false)
    expect(useShellStore.getState().goRequest).toBe("prepare")
  })
})

describe("sound in the Screens step (#298 S5.4)", () => {
  it("never asks for the microphones until Choose microphone, then saves the choice", async () => {
    await openAt("screens")
    expect(calls.some((c) => c.cmd === "get_audio_devices")).toBe(false)
    expect(text()).toContain("system's own microphone")
    await click("Choose microphone")
    expect(calls.filter((c) => c.cmd === "get_audio_devices")).toHaveLength(1)
    expect(document.getElementById("setup-microphone")).toBeTruthy()
    await act(async () => useSettingsStore.getState().setAudioDeviceId("usb-desk"))
    expect(text()).toContain("Listening uses Sound desk USB")
  })
})

describe("time zone in the Church step (#298 S1.3)", () => {
  it("starts on this computer's and saves nothing until one is chosen", async () => {
    await openAt("church")
    expect(document.getElementById("setup-time-zone")?.textContent).toContain("This computer's")
    expect(useSettingsStore.getState().setup.timeZone).toBe("")
  })
})

describe("Review your setup, for an install in use before the setup (#298 M7)", () => {
  it("shows once the saved services are known, opens the setup at its summary, and Not now ends it", async () => {
    useServiceStore.setState({ programs: [{ id: "p1" }] as never })
    await render(<SetupCard />)
    expect(text()).not.toContain("Review your setup") // not before the first-launch check
    await act(async () => useSetupLaunch.setState({ checked: true }))
    expect(text()).toContain("Review your setup")
    await click("Review setup")
    expect(useShellStore.getState().setupOpen).toBe(true)
    expect(useSettingsStore.getState().setup.lastStep).toBe("finish")
    await act(async () => useShellStore.setState({ setupOpen: false }))
    await click("Not now")
    expect(useSettingsStore.getState().setup.dismissedAt).not.toBe("")
    expect(text()).not.toContain("Review your setup")
  })
})
