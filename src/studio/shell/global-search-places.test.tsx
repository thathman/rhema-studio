// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

// jsdom lacks what the command list needs.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
})
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}), emit: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { GlobalSearch } from "@/studio/shell/global-search"
import { useShellStore } from "@/studio/shell-store"

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function render(node: React.ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const el = document.createElement("div")
  document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => root!.render(node))
  return el
}

// Moved from the retired More tools page (#809 R10): Find anything is the way to these places now.
describe("Find anything names each Live tool (UX audit S1e)", () => {
  it("typing obs finds the OBS tool and opens it on Live", async () => {
    const { useProductionTab } = await import("@/studio/production/production-tab")
    useShellStore.setState({ searchOpen: true, goRequest: null })
    await render(<GlobalSearch />)
    const input = document.querySelector("[cmdk-input]") as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "obs")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const items = [...document.querySelectorAll("[cmdk-item]")].map((i) => i.textContent?.trim())
    expect(items).toContain("Live · OBS")
    const obs = [...document.querySelectorAll("[cmdk-item]")].find((i) => i.textContent?.trim() === "Live · OBS") as HTMLElement
    await act(async () => obs.click())
    expect(useProductionTab.getState()).toMatchObject({ selected: "obs", open: true, liveToolsTab: "production" })
  })
})

describe("Find anything opens the real places", () => {
  it("Find anything: New service opens Prepare with the New service form", async () => {
    useShellStore.setState({ searchOpen: true, goRequest: null, newServiceOpen: false })
    await render(<GlobalSearch />)
    const item = [...document.querySelectorAll("[cmdk-item]")].find((i) => i.textContent?.trim() === "New service") as HTMLElement
    expect(item).toBeTruthy()
    await act(async () => item.click())
    expect(useShellStore.getState().newServiceOpen).toBe(true)
    expect(useShellStore.getState().goRequest).toBe("prepare")
    expect(useShellStore.getState().searchOpen).toBe(false)
  })

  it("Find anything distinguishes content Library from Design templates", async () => {
    useShellStore.setState({ searchOpen: true, designRequest: null, goRequest: null })
    await render(<GlobalSearch />)
    const items = [...document.querySelectorAll("[cmdk-item]")] as HTMLElement[]
    const labels = items.map((item) => item.textContent?.trim())
    const templates = items.find((item) => item.textContent?.includes("Design templates"))
    const contentLibrary = items.find((item) => item.textContent?.includes("Library") && !item.textContent?.includes("Design templates"))

    expect(labels).toContain("Design templates")
    expect(contentLibrary).toBeTruthy()
    await act(async () => templates!.click())
    expect(useShellStore.getState().designRequest).toBe("library")
    expect(useShellStore.getState().searchOpen).toBe(false)
  })

  it("Find anything names every place, Library section and settings section as the app does (#401, #402, #447)", async () => {
    useShellStore.setState({ searchOpen: true, goRequest: null })
    await render(<GlobalSearch />)
    const labels = [...document.querySelectorAll("[cmdk-item]")].map((i) => i.textContent?.trim())
    for (const name of ["Connections", "Collections", "Outputs", "AI assistants", "Data & Sync", "Heard verses"]) expect(labels).toContain(name)
    const connections = [...document.querySelectorAll("[cmdk-item]")].find((i) => i.textContent?.trim() === "Connections") as HTMLElement
    await act(async () => connections.click())
    expect(useShellStore.getState().goRequest).toBe("connections")
  })
})
