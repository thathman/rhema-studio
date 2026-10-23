// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.3.2") }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { useSettingsDialogStore } from "@/lib/settings-dialog"
import { useJoin } from "@/stores/join-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useShellStore } from "@/studio/shell-store"
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
  useSettingsStore.setState({ operatorName: "", joinAddress: "" })
  useJoin.setState({ status: "off", me: null, live: null })
  useShellStore.setState({ setupOpen: false, setupStatusOpen: false })
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
})
