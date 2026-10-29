// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.4.0") }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { useSettingsDialogStore } from "@/lib/settings-dialog"
import { useJoin } from "@/stores/join-store"
import { useRecovery } from "@/lib/live-recovery"
import { defaultSetup } from "@/lib/setup-readiness"
import { useProductionTab } from "@/studio/production/production-tab"
import { useSettingsStore } from "@/stores/settings-store"
import { useShellStore } from "@/studio/shell-store"
import { REMOTE_ROLES } from "@/lib/remote-roles"
import { DeskMenu } from "./desk-menu"

/** The Desk menu at the foot of the sidebar (#299): name, role, Light/Dark/System, Settings, setup. */
let root: Root
let host: HTMLDivElement
const onSettings = vi.fn()

async function mount() {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<ThemeProvider defaultTheme="light"><DeskMenu onSettings={onSettings} /></ThemeProvider>))
}
const trigger = () => host.querySelector<HTMLButtonElement>("button")!
const openMenu = () => act(async () => trigger().click())
const row = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(text))!
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
  // Node's own half-made localStorage can shadow jsdom's: a small Map-backed one, fresh per test.
  const store = new Map<string, string>()
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, String(v)), removeItem: (k: string) => store.delete(k), clear: () => store.clear() })
  onSettings.mockReset()
  useSettingsStore.setState({ operatorName: "", joinAddress: "", setup: defaultSetup() })
  useJoin.setState({ status: "off", me: null, live: null })
  useRecovery.setState({ offer: null, dismissed: false, damaged: false, restoreError: null, durableRuns: [], durableRunsDismissed: false })
  useProductionTab.setState({ requested: null })
  useShellStore.setState({ workspace: "home", goRequest: null, setupOpen: false, setupStatusOpen: false })
  await mount()
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe("the Desk menu", () => {
  it("asks for a name once and saves it in place on Enter, with no trip to Settings", async () => {
    expect(trigger().getAttribute("aria-label")).toBe("Your desk: Add your name, Main desk")
    await openMenu()
    const name = document.getElementById("desk-name") as HTMLInputElement
    expect(document.activeElement).toBe(name)
    await type(name, "  Tolu Adeyemi ")
    await act(async () => { name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })) })
    expect(useSettingsStore.getState().operatorName).toBe("Tolu Adeyemi")
    expect(trigger().textContent).toContain("TA")
    expect(trigger().getAttribute("aria-label")).toBe("Your desk: Tolu Adeyemi, Main desk")
    expect(onSettings).not.toHaveBeenCalled()
  })

  it("saves the name when the box loses focus", async () => {
    await openMenu()
    const name = document.getElementById("desk-name") as HTMLInputElement
    await type(name, "Femi")
    await act(async () => { name.dispatchEvent(new FocusEvent("focusout", { bubbles: true })) })
    expect(useSettingsStore.getState().operatorName).toBe("Femi")
  })

  it("Complete setup opens the setup, Settings goes to Settings, and the menu closes", async () => {
    await openMenu()
    await act(async () => row("Complete setup").click())
    expect(useShellStore.getState().setupOpen).toBe(true)
    expect(document.getElementById("desk-name")).toBeNull()
    await openMenu()
    await act(async () => row("Settings").click())
    expect(onSettings).toHaveBeenCalledTimes(1)
    await openMenu()
    await act(async () => row("Help and the tour").click())
    expect(useSettingsDialogStore.getState().activeSection).toBe("help")
  })

  it("Setup status says what is left and opens the Setup status page (#298)", async () => {
    await openMenu()
    // No church name and no operator name yet; nothing switched on is failing.
    expect(row("Setup status").textContent).toContain("Needs 2")
    await act(async () => row("Setup status").click())
    expect(useShellStore.getState().setupStatusOpen).toBe(true)
    expect(document.getElementById("desk-name")).toBeNull()
  })

  it("Light, Dark and System switch the shell at once and are remembered", async () => {
    await openMenu()
    const radio = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent?.trim() === label)!
    expect(radio("Light").getAttribute("aria-checked")).toBe("true")
    await act(async () => radio("Dark").click())
    expect(localStorage.getItem("theme")).toBe("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(radio("Dark").getAttribute("aria-checked")).toBe("true")
    await act(async () => radio("System").click())
    expect(localStorage.getItem("theme")).toBe("system")
    expect(document.documentElement.classList.contains("light")).toBe(true)
  })

  it("says honestly what this desk is when it has joined a host", async () => {
    await act(async () => {
      useSettingsStore.setState({ joinAddress: "192.168.1.20:7878" })
      useJoin.setState({ status: "connected", me: { name: "Ade", role: "bible" } })
    })
    expect(trigger().getAttribute("aria-label")).toContain("Bible desk · joined 192.168.1.20:7878")
    await act(async () => useJoin.setState({ status: "off", me: null }))
    expect(trigger().getAttribute("aria-label")).toContain("Main desk")
  })

  it("opens when another page asks (Settings search → Appearance), on the Appearance choice", async () => {
    expect(document.querySelector('[aria-label="Your desk"]')).toBeNull()
    await act(async () => useShellStore.getState().openDeskMenu())
    expect(document.querySelector('[aria-label="Your desk"]')).not.toBeNull()
    expect(document.querySelector('[role="radiogroup"]')).not.toBeNull()
  })

  it("shows and edits this computer's name, with its desk id (#299 1.8, #298 S2.3)", async () => {
    await act(async () => useSettingsStore.getState().setSetup({ deviceName: "Sanctuary desk", deviceId: "3f2a91c0-1111-4222-8333-944455556666" }))
    expect(trigger().getAttribute("aria-label")).toBe("Your desk: Add your name, Sanctuary desk · Main desk")
    await openMenu()
    const device = document.getElementById("desk-device") as HTMLInputElement
    expect(device.value).toBe("Sanctuary desk")
    expect(document.getElementById("desk-device-hint")?.textContent).toContain("3F2A-91C0")
    await type(device, " Media booth ")
    await act(async () => { device.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })) })
    expect(useSettingsStore.getState().setup.deviceName).toBe("Media booth")
    // Escape in the box puts back what was saved, without closing the menu.
    await act(async () => device.focus())
    await type(device, "Typo")
    await act(async () => { device.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })) })
    expect(device.value).toBe("Media booth")
    expect(document.getElementById("desk-device")).toBe(device)
    expect(useSettingsStore.getState().setup.deviceName).toBe("Media booth")
  })

  it("the role row says what this desk may do and opens Connections (#299 1.10, #401)", async () => {
    await openMenu()
    expect(document.body.textContent).toContain("Every control, on this computer")
    await act(async () => row("See joined desks").click())
    expect(useShellStore.getState().goRequest).toBe("connections")
    expect(document.getElementById("desk-name")).toBeNull()
  })

  it("a joined desk sees what its role permits and can leave the host", async () => {
    const leave = vi.fn(async () => {})
    await act(async () => useJoin.setState({ status: "connected", me: { name: "Ade", role: "timekeeper" }, leave }))
    await openMenu()
    expect(document.body.textContent).toContain("Moves the event clock")
    await act(async () => row("Leave this host").click())
    expect(leave).toHaveBeenCalledTimes(1)
  })

  it("names every joined role and what it may do, from the one role list (#299)", async () => {
    for (const r of REMOTE_ROLES) {
      await act(async () => useJoin.setState({ status: "connected", me: { name: "Ade", role: r.id } }))
      expect(trigger().getAttribute("aria-label")).toContain(`${r.name} desk · joined`)
      await openMenu()
      expect(document.body.textContent).toContain(r.may)
      expect(document.body.textContent).not.toContain("What the host allows.")
      await openMenu()
    }
    await act(async () => useJoin.setState({ status: "connected", me: { name: "Ade", role: "future-role" } }))
    await openMenu()
    expect(document.body.textContent).toContain("What the host allows.")
  })

  it("keeps the last session's screens after Not now, and puts them back only after a second click (#299 1.18)", async () => {
    await openMenu()
    expect(row("Put back the last session's screens")).toBeUndefined()
    await act(async () => root.unmount())
    const at = Date.now() - 60_000
    useRecovery.setState({ offer: { v: 1, at, service: null, isLive: false, liveVerse: null, liveItemId: null, sources: {}, outputsOn: [], scenes: {}, eventId: null }, dismissed: true, restoreError: "Could not restore Projector. Check or reconnect it, then try again." })
    await mount()
    await openMenu()
    await act(async () => row("Put back the last session's screens").click())
    // Asked first: it replaces what is on the screens now.
    expect(document.body.textContent).toContain("It replaces what is on them now")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Could not restore Projector")
    expect(document.body.textContent).toContain("Continue with available state")
    expect(useRecovery.getState().offer).not.toBeNull()
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Put back")!.click())
    await act(async () => {})
    expect(useRecovery.getState().offer).toBeNull()
  })
})
