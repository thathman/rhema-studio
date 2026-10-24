// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { SetupWizard } from "./setup-wizard"
import { SetupCard } from "./setup-card"
import { decideSetupLaunch, useSetupLaunch } from "./setup-launch"
import { defaultSetup, normalizeSetup } from "@/lib/setup-readiness"
import { defaultBrandKit } from "@/lib/brand-kit"
import { useSettingsStore } from "@/stores/settings-store"
import { useBibleStore } from "@/stores/bible-store"
import { useServiceStore } from "@/stores/service-store"
import { useShellStore } from "@/studio/shell-store"
import { useProductionTab } from "@/studio/production/production-tab"

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
async function type(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
const heading = () => document.querySelector('[role="dialog"] h2')?.textContent
/** The two required steps filled in, as they are once someone has gone past them. */
const named = () => useSettingsStore.setState({ brandKit: { ...defaultBrandKit(), churchName: "Grace Chapel" }, operatorName: "Tolu" })

beforeEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = null
  document.body.replaceChildren()
  useSettingsStore.setState({ setup: defaultSetup(), brandKit: defaultBrandKit(), operatorName: "", onboardingComplete: false, remoteDevices: [], joinAddress: "", churchFolder: "", sttProvider: "deepgram", deepgramApiKey: null, cloudSpeechConsentAt: "", settingsSaveFailed: false })
  useShellStore.setState({ setupOpen: false, outputsDialogOpen: false, goRequest: null, workspace: "home" })
  useBibleStore.setState({ translations: [{ id: 7, abbreviation: "KJV", title: "King James Version", language: "en", is_copyrighted: false, is_downloaded: true }], activeTranslationId: 7, secondaryTranslationId: null })
  useServiceStore.setState({ programs: [] })
  useSetupLaunch.setState({ checked: false, autoOpened: false })
  useProductionTab.setState({ requested: null })
})

describe("first launch", () => {
  it("opens by itself on a fresh install, once, after the saved services are known", () => {
    decideSetupLaunch(true)
    expect(useShellStore.getState().setupOpen).toBe(true)
    expect(useSetupLaunch.getState()).toEqual({ checked: true, autoOpened: true })
  })

  it("does not open for an existing installation with services, even though the tour never finished", () => {
    useServiceStore.setState({ programs: [{ id: "p1" }] as never })
    decideSetupLaunch(true)
    expect(useShellStore.getState().setupOpen).toBe(false)
    expect(useSetupLaunch.getState()).toEqual({ checked: true, autoOpened: false })
  })

  it("gives this install its id once, at the first start, and keeps it (#298 M3)", () => {
    decideSetupLaunch(true)
    const id = useSettingsStore.getState().setup.deviceId
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    useSetupLaunch.setState({ checked: false })
    decideSetupLaunch(true)
    expect(useSettingsStore.getState().setup.deviceId).toBe(id)
  })

  it("does not assume an empty install when the services could not be read", () => {
    decideSetupLaunch(false)
    expect(useShellStore.getState().setupOpen).toBe(false)
  })

  it("does not open again once it was closed", () => {
    useSettingsStore.getState().setSetup({ dismissedAt: "2026-10-23T09:00:00Z" })
    decideSetupLaunch(true)
    expect(useShellStore.getState().setupOpen).toBe(false)
  })
})

describe("the setup wizard", () => {
  it("welcome → main desk → church name is required, saves as typed, and Continue moves on", async () => {
    useShellStore.setState({ setupOpen: true })
    await render(<SetupWizard />)
    expect(document.body.textContent).toContain("Welcome to Rhema Studio")
    await click("Set up this computer as the main desk")
    expect(useSettingsStore.getState().setup.mode).toBe("main")
    expect(heading()).toBe("Church identity")
    expect(useSettingsStore.getState().setup.lastStep).toBe("church")

    await click("Continue")
    expect(heading()).toBe("Church identity")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Enter the church's name")

    await type("setup-church-name", "Ìjọ Àpóstélì Kristi")
    expect(useSettingsStore.getState().brandKit.churchName).toBe("Ìjọ Àpóstélì Kristi")
    expect(document.body.textContent).toContain("Ìjọ Àpóstélì Kristi workspace")
    await type("setup-campus", "Ikeja")
    expect(useSettingsStore.getState().setup.campus).toBe("Ikeja")
    await click("Continue")
    expect(heading()).toBe("You and this computer")
    expect(useSettingsStore.getState().setup.stepsDone.church).toBe("done")

    await type("setup-operator-name", "Tolu")
    await type("setup-device-name", "Sanctuary desk")
    expect(useSettingsStore.getState().operatorName).toBe("Tolu")
    expect(useSettingsStore.getState().setup.deviceName).toBe("Sanctuary desk")
    await click("Continue")
    expect(heading()).toBe("Brand and starter looks")
    // Optional steps can be skipped; required ones cannot.
    await click("Skip")
    expect(useSettingsStore.getState().setup.stepsDone.brand).toBe("skipped")
    expect(heading()).toBe("Bible and library")
    expect(document.body.textContent).toContain("1 edition installed")
    await click("Back")
    expect(heading()).toBe("Brand and starter looks")
  })

  it("Finish later keeps the place; opening again resumes at the last step", async () => {
    named()
    useSettingsStore.getState().setSetup({ lastStep: "screens" })
    useShellStore.setState({ setupOpen: true })
    await render(<SetupWizard />)
    expect(heading()).toBe("Screens")
    expect(document.body.textContent).toContain("Main Display")
    await click("Finish later")
    expect(useShellStore.getState().setupOpen).toBe(false)
    expect(useSettingsStore.getState().setup.dismissedAt).not.toBe("")
    expect(useSettingsStore.getState().setup.lastStep).toBe("screens")
  })

  it("the step list moves between steps and marks the current one", async () => {
    useSettingsStore.getState().setSetup({ lastStep: "church" })
    useShellStore.setState({ setupOpen: true })
    await render(<SetupWizard />)
    const nav = document.querySelector('nav[aria-label="Setup steps"]')!
    expect(nav.querySelector('[aria-current="step"]')?.textContent).toContain("Church")
    await act(async () => ([...nav.querySelectorAll("button")].find((b) => b.textContent?.includes("Finish")) as HTMLButtonElement).click())
    expect(heading()).toBe("Setup summary")
    expect(document.body.textContent).toContain("of 4 essentials done")
    expect(document.body.textContent).toContain("Not using:")
  })

  it("Join an existing church host hands over to Production → Operators", async () => {
    useShellStore.setState({ setupOpen: true })
    await render(<SetupWizard />)
    await click("Join an existing church host")
    expect(useShellStore.getState().setupOpen).toBe(false)
    expect(useSettingsStore.getState().setup.mode).toBe("join")
    expect(useShellStore.getState().goRequest).toBe("production")
    expect(useProductionTab.getState().requested).toBe("operators")
  })

  it("Use Rhema now closes and does not open by itself again", async () => {
    useShellStore.setState({ setupOpen: true })
    await render(<SetupWizard />)
    await click("Use Rhema now, finish later")
    expect(useShellStore.getState().setupOpen).toBe(false)
    expect(useSettingsStore.getState().setup.dismissedAt).not.toBe("")
  })

  it("never lists a Bible edition that is not installed", async () => {
    useBibleStore.setState({ translations: [{ id: 9, abbreviation: "NIV", title: "New International Version", language: "en", is_copyrighted: true, is_downloaded: false }] })
    named()
    useSettingsStore.getState().setSetup({ lastStep: "bible" })
    useShellStore.setState({ setupOpen: true })
    await render(<SetupWizard />)
    expect(document.body.textContent).toContain("No Bible edition was found")
    expect(document.body.textContent).not.toContain("NIV")
  })

  it("hides while the outputs dialog is open and comes back after", async () => {
    named()
    useSettingsStore.getState().setSetup({ lastStep: "screens" })
    useShellStore.setState({ setupOpen: true })
    await render(<SetupWizard />)
    await click("Open Outputs")
    expect(useShellStore.getState().outputsDialogOpen).toBe(true)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => useShellStore.setState({ outputsDialogOpen: false }))
    expect(heading()).toBe("Screens")
  })
})

describe("Join vs Solo keeps this computer's own settings (#298 G)", () => {
  it("choosing Join after filling in the operator step changes nothing local", async () => {
    named()
    useSettingsStore.getState().setSetup({ lastStep: "operator", deviceName: "Sanctuary desk", campus: "Ikeja" })
    useShellStore.setState({ setupOpen: true })
    await render(<SetupWizard />)
    await click("This computer should join another one instead")
    const s = useSettingsStore.getState()
    expect(s.setup.mode).toBe("join")
    expect(s.operatorName).toBe("Tolu")
    expect(s.brandKit.churchName).toBe("Grace Chapel")
    expect(s.setup).toMatchObject({ deviceName: "Sanctuary desk", campus: "Ikeja", lastStep: "operator" })
    // Nothing paired or joined by itself: Operators is where that is done, with the host's approval.
    expect(s.joinAddress).toBe("")
    expect(useProductionTab.getState().requested).toBe("operators")
  })

  it("Solo main desk needs no volunteer, host or other computer to finish", async () => {
    named()
    useSettingsStore.getState().setSetup({ lastStep: "finish" })
    useShellStore.setState({ setupOpen: true })
    await render(<SetupWizard />)
    expect(document.body.textContent).toContain("4 of 4 essentials done")
    expect(document.body.textContent).toContain("Phones and other computers")
    await click("Open Home")
    expect(useShellStore.getState().setupOpen).toBe(false)
    expect(useSettingsStore.getState().setup.stepsDone.finish).toBe("done")
    expect(useSettingsStore.getState().operatorName).toBe("Tolu")
  })
})

describe("interrupted setup and restart (#298 H)", () => {
  it("a restart opens at the step it was left on, in one click from Home", async () => {
    named()
    useShellStore.setState({ setupOpen: true })
    useSettingsStore.getState().setSetup({ lastStep: "bible" })
    await render(<SetupWizard />)
    await click("Finish later")
    await act(async () => root!.unmount())
    root = null
    // As after a restart: the saved section is read again, field by field.
    useSettingsStore.setState({ setup: normalizeSetup(JSON.parse(JSON.stringify(useSettingsStore.getState().setup))) })
    await render(<SetupCard />)
    expect(document.body.textContent).not.toContain("Finish church setup") // essentials are done: no nagging
    await act(async () => root!.unmount())
    root = null
    useShellStore.setState({ setupOpen: true })
    await render(<SetupWizard />)
    expect(heading()).toBe("Bible and library")
  })

  it("a name lost since (cleared, or a damaged file) sends it back to that step first", async () => {
    useSettingsStore.getState().setSetup({ lastStep: "connections" })
    useSettingsStore.setState({ brandKit: { ...defaultBrandKit(), churchName: "Grace Chapel" }, operatorName: "" })
    useShellStore.setState({ setupOpen: true })
    await render(<SetupWizard />)
    expect(heading()).toBe("You and this computer")
  })

  it("a damaged setup section opens at the welcome, not a step that does not exist", async () => {
    named()
    useSettingsStore.setState({ setup: normalizeSetup({ lastStep: "cameras", stepsDone: 4 }) })
    useShellStore.setState({ setupOpen: true })
    await render(<SetupWizard />)
    expect(document.body.textContent).toContain("Welcome to Rhema Studio")
  })
})

describe("Home's Finish church setup card", () => {
  it("shows the missing essentials and opens the setup", async () => {
    await render(<SetupCard />)
    expect(document.body.textContent).toContain("Finish church setup · 2 items")
    await click("Continue setup")
    expect(useShellStore.getState().setupOpen).toBe(true)
  })

  it("Setup status opens the three-card status page", async () => {
    await render(<SetupCard />)
    await click("Setup status")
    expect(useShellStore.getState().setupStatusOpen).toBe(true)
  })

  it("is hidden once the essentials are done, whatever optional features are unused", async () => {
    useSettingsStore.setState({ brandKit: { ...defaultBrandKit(), churchName: "Grace Chapel" }, operatorName: "Tolu" })
    await render(<SetupCard />)
    expect(document.body.textContent).not.toContain("Finish church setup")
  })

  it("Remind me tomorrow and Hide put it away", async () => {
    await render(<SetupCard />)
    await click("Remind me tomorrow")
    expect(Date.parse(useSettingsStore.getState().setup.remindAfter)).toBeGreaterThan(Date.now())
    expect(document.body.textContent).not.toContain("Finish church setup")
    await act(async () => useSettingsStore.getState().setSetup({ remindAfter: "" }))
    expect(document.body.textContent).toContain("Finish church setup")
    await act(async () => (document.querySelector('[aria-label="Hide this reminder"]') as HTMLButtonElement).click())
    expect(useSettingsStore.getState().setup.homeCardHidden).toBe(true)
    expect(document.body.textContent).not.toContain("Finish church setup")
  })
})
