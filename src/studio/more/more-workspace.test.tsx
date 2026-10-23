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
import { MoreWorkspace } from "./more-workspace"
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
const button = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(label))

describe("one place to build a service (#299)", () => {
  it("More has no Classic layout, nothing marked planned, and sends Prepare and Signage to the real places", async () => {
    useShellStore.setState({ presentView: "standard", goRequest: null, outputsDialogOpen: false })
    const el = await render(<MoreWorkspace />)
    expect(el.textContent).not.toContain("Classic layout")
    expect(el.textContent).not.toContain("Planned")
    for (const b of el.querySelectorAll("button")) expect(b.disabled).toBe(false)

    await act(async () => button("Prepare")!.click())
    expect(useShellStore.getState().goRequest).toBe("prepare")

    await act(async () => button("Signage")!.click())
    expect(useShellStore.getState().outputsDialogOpen).toBe(true)
    // Nothing here switches Present to its advanced view any more.
    expect(useShellStore.getState().presentView).toBe("standard")
  })

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
})
