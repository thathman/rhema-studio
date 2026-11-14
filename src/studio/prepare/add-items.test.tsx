// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

vi.hoisted(() => { globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never })
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { AddItems } from "./add-items"
import { useAddDialog } from "./add-target"
import { useQueueStore } from "@/stores/queue-store"

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  vi.restoreAllMocks()
  useAddDialog.getState().close()
})

const quizTab = () => [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.trim() === "Quiz")!
const addQuiz = () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Add a new quiz")!

/** #386: a successful add closes the picker and selects the item; a refused add leaves it open. */
describe("Prepare's Add picker", () => {
  it("stays open when the item was not added, and closes on a real add", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useQueueStore.setState({ items: [], headers: [] })
    const host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(<AddItems />))
    await act(async () => useAddDialog.getState().openFor(null))
    await act(async () => { quizTab().dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })) })

    const refuse = vi.spyOn(useQueueStore.getState(), "addItem").mockReturnValue(null as never)
    await act(async () => addQuiz().click())
    expect(refuse).toHaveBeenCalled()
    expect(useAddDialog.getState().open).toBe(true)
    expect(useQueueStore.getState().items).toHaveLength(0)

    refuse.mockRestore()
    await act(async () => addQuiz().click())
    expect(useQueueStore.getState().items).toHaveLength(1)
    expect(useAddDialog.getState().open).toBe(false)
  })
})
