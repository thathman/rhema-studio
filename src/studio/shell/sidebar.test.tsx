// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The shell store reads this computer's storage when it loads: a Map-backed one, in place first.
const saved = vi.hoisted(() => {
  const map = new Map<string, string>()
  globalThis.localStorage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, String(v)), removeItem: (k: string) => void map.delete(k), clear: () => map.clear(), key: () => null, length: 0 } as Storage
  return map
})
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.3.3") }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { SHELL_PREFS_KEY, useShellStore, type Workspace } from "@/studio/shell-store"
import { churchItems } from "./nav-items"
import { Sidebar } from "./sidebar"

/** The sidebar folds to icons (#299): its button, Cmd/Ctrl+B, remembered, tooltips when folded. */
let root: Root
let host: HTMLDivElement
let narrow = false
let selectedWorkspace: Workspace | null = null

const nav = () => host.querySelector("nav")!
const toggle = () => host.querySelector<HTMLButtonElement>("button[aria-controls='studio-sidebar']")!
const navButton = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("nav button")].find((b) => b.textContent === label)!
const press = (init: KeyboardEventInit) => act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true, cancelable: true, ...init })))

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  narrow = false
  selectedWorkspace = null
  window.matchMedia = ((q: string) => ({ matches: q.includes("1180") ? narrow : false, media: q, addEventListener() {}, removeEventListener() {} })) as never
  saved.clear()
  useShellStore.setState({ sidebarCollapsed: false })
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root.render(
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Sidebar workspace="home" isLive={false} church={churchItems()} onWorkspace={(workspace) => { selectedWorkspace = workspace }} onSettings={() => {}} />
        </TooltipProvider>
      </ThemeProvider>,
    ),
  )
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.innerHTML = ""
})

const savedPrefs = () => JSON.parse(saved.get(SHELL_PREFS_KEY) ?? "{}") as { sidebarCollapsed?: boolean }

describe("the collapsible sidebar", () => {
  it("opens the single Connections workspace from the church navigation", async () => {
    await act(async () => navButton("Connections").click())
    expect(selectedWorkspace).toBe("connections")
  })

  it("opens expanded; its button folds it and opens it out, and the choice is remembered", async () => {
    expect(nav().dataset.collapsed).toBeUndefined()
    expect(toggle().getAttribute("aria-expanded")).toBe("true")
    expect(toggle().getAttribute("aria-label")).toBe("Collapse sidebar")

    await act(async () => toggle().click())
    expect(nav().dataset.collapsed).toBe("true")
    expect(toggle().getAttribute("aria-expanded")).toBe("false")
    expect(toggle().getAttribute("aria-label")).toBe("Expand sidebar")
    expect(savedPrefs().sidebarCollapsed).toBe(true)

    await act(async () => toggle().click())
    expect(nav().dataset.collapsed).toBeUndefined()
    expect(savedPrefs().sidebarCollapsed).toBe(false)
  })

  it("Cmd+B and Ctrl+B toggle it; not over an open dialog, and not in a narrow window", async () => {
    await press({ metaKey: true })
    expect(useShellStore.getState().sidebarCollapsed).toBe(true)
    await press({ ctrlKey: true, key: "B" })
    expect(useShellStore.getState().sidebarCollapsed).toBe(false)
    await press({})
    expect(useShellStore.getState().sidebarCollapsed).toBe(false)

    const dialog = document.createElement("div")
    dialog.setAttribute("role", "dialog")
    dialog.dataset.state = "open"
    document.body.append(dialog)
    await press({ metaKey: true })
    expect(useShellStore.getState().sidebarCollapsed).toBe(false)
    dialog.remove()

    narrow = true
    await press({ metaKey: true })
    expect(useShellStore.getState().sidebarCollapsed).toBe(false)
  })

  it("folded, every place keeps its name for screen readers and shows it in a tooltip", async () => {
    // Open out: the label is visible and the title gives the keys; no extra tooltip.
    expect(navButton("Home").title).toBe("Home (⌘1 / Ctrl+1)")
    await act(async () => navButton("Home").focus())
    expect(document.querySelector("[role='tooltip']")).toBeNull()

    await act(async () => useShellStore.getState().setSidebarCollapsed(true))
    for (const label of ["Home", "Prepare", "Present", "Production", "Library", "Design", "Team", "Archive"]) {
      const b = navButton(label)
      expect(b.querySelector(".compact\\:sr-only")?.textContent).toBe(label)
      expect(b.title).toBe("")
    }
    await act(async () => navButton("Library").blur())
    await act(async () => navButton("Library").focus())
    expect(document.querySelector("[role='tooltip']")?.textContent).toContain("Library (⌘4 / Ctrl+4)")
  })
})
