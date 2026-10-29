// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The shell store reads this computer's storage when it loads: a Map-backed one, in place first.
vi.hoisted(() => {
  const map = new Map<string, string>()
  globalThis.localStorage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, String(v)), removeItem: (k: string) => void map.delete(k), clear: () => map.clear(), key: () => null, length: 0 } as Storage
})
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.4.0") }))

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { SettingsPage } from "@/components/settings-dialog"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useSettingsDialogStore } from "@/lib/settings-dialog"
import { useJoin } from "@/stores/join-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useShellStore } from "@/studio/shell-store"
import { DeskMenu } from "./desk-menu"
import { churchItems } from "./nav-items"
import { Sidebar } from "./sidebar"

/**
 * Keyboard access (#215 G9.4): Tab goes through the sidebar, the Desk menu and Settings search in
 * reading order, and never gets stuck. jsdom has no Tab of its own, so `tab()` does what a browser
 * does: the focused control hears the key first (a menu may move focus itself), then focus moves
 * to the next control in the page's order.
 */
let root: Root
let host: HTMLDivElement

const TABBABLE = "a[href], button, input, select, textarea, [tabindex]"
function tabbables(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && !el.closest("[hidden], [inert]"))
}
async function tab(shift = false): Promise<void> {
  const from = document.activeElement instanceof HTMLElement ? document.activeElement : document.body
  const key = new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, bubbles: true, cancelable: true })
  await act(async () => void from.dispatchEvent(key))
  if (key.defaultPrevented) return
  const list = tabbables()
  const next = list[list.indexOf(from) + (shift ? -1 : 1)]
  await act(async () => (next ? next.focus() : from.blur()))
}
/** What a screen reader would call the focused control. */
function focused(): string {
  const el = document.activeElement as HTMLElement | null
  if (!el || el === document.body) return "(page)"
  const name = el.getAttribute("aria-label") ?? (el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent : null) ?? el.textContent ?? ""
  return name.replace(/\s+/g, " ").trim()
}
async function walk(steps: number): Promise<string[]> {
  const seen: string[] = []
  for (let i = 0; i < steps; i++) {
    await tab()
    seen.push(focused())
  }
  return seen
}
async function mount(node: ReactNode) {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<ThemeProvider defaultTheme="light"><TooltipProvider>{node}</TooltipProvider></ThemeProvider>))
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
  useShellStore.setState({ sidebarCollapsed: false, setupOpen: false, setupStatusOpen: false })
  useSettingsStore.setState({ operatorName: "Tolu", joinAddress: "", sttProvider: "deepgram" })
  useJoin.setState({ status: "off", me: null, live: null })
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.innerHTML = ""
})

describe("keyboard order (#215)", () => {
  it("the sidebar: the workspaces in order, then the church's pages, Collapse and the Desk menu, then out", async () => {
    await mount(
      <>
        <button type="button">Before</button>
        <Sidebar workspace="home" isLive={false} church={churchItems()} onWorkspace={() => {}} onSettings={() => {}} />
        <button type="button">After</button>
      </>,
    )
    await act(async () => document.querySelector<HTMLButtonElement>("button")!.focus())
    expect(await walk(12)).toEqual(["Home", "Prepare", "Live", "Library", "Design", "History", "Permissions", "Connections", "Team", "Collapse sidebar", "Your desk: Tolu, Main desk", "After"])
    // And back the same way.
    await tab(true)
    expect(focused()).toBe("Your desk: Tolu, Main desk")
    // Nothing in it jumps the queue.
    expect(tabbables().filter((el) => el.tabIndex > 0)).toEqual([])
  })

  it("the Desk menu: name, this computer, its role rows, appearance, then its rows; Tab wraps inside it and Escape gives focus back to its button", async () => {
    await mount(<DeskMenu onSettings={() => {}} />)
    const trigger = host.querySelector<HTMLButtonElement>("button")!
    await act(async () => trigger.focus())
    await act(async () => trigger.click())
    // It opens on its first control.
    expect(focused()).toBe("Your name")
    expect(await walk(15)).toEqual(["This computer", "See joined desks", "Join another host", "Light", "Dark", "System", expect.stringMatching(/^Settings/), "Complete setup", expect.stringMatching(/^Setup status/), "This computer runs OBS only…", "Keyboard shortcuts", "Help and the tour", "Diagnostics", expect.stringMatching(/^About Rhema Studio/), "Your name"])
    await act(async () => void document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })))
    expect(document.querySelector('[aria-label="Your desk"]')).toBeNull()
    // Focus goes back to the Desk button after the menu's close; give it up to a second (slow CI).
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger), { timeout: 1000 })
  })

  it("Settings search: the search box, then each section in order, then the open section; a match elsewhere is next after the search", async () => {
    useSettingsDialogStore.setState({ activeSection: "help" })
    await mount(<SettingsPage />)
    const search = host.querySelector<HTMLInputElement>('input[aria-label="Search settings"]')!
    await act(async () => search.focus())
    expect(await walk(10)).toEqual(["Bible", "Outputs", "Heard verses", "Audio", "Speech Recognition", "Remote Control", "AI assistants", "Data & Sync", "Diagnostics", "Help"])
    // Then into the section that is open, not round again.
    await tab()
    expect(host.querySelector("section")!.contains(document.activeElement)).toBe(true)

    await act(async () => search.focus())
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "camera")
      search.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await tab()
    expect(focused()).toMatch(/^Cameras and the camera router/)
    // Shift+Tab goes back to the search: nothing holds focus.
    await tab(true)
    expect(document.activeElement).toBe(search)
  })
})
