// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockInvoke = vi.hoisted(() => vi.fn())
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { AutomaticReminders } from "./automatic-reminders"

const roots: Root[] = []
const policy = { thresholdsMin: [], to: [], urgent: false }

async function render(): Promise<HTMLElement> {
  const el = document.createElement("div")
  const root = createRoot(el)
  roots.push(root)
  await act(async () => root.render(<AutomaticReminders />))
  return el
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mockInvoke.mockReset().mockImplementation(async (command: string, args?: { policy?: typeof policy }) => command === "reminders_policy" ? policy : args?.policy ?? null)
})

afterEach(() => {
  act(() => { for (const root of roots.splice(0)) root.unmount() })
})

describe("AutomaticReminders", () => {
  it("loads host rules and saves thresholds, private recipients and urgency explicitly", async () => {
    const el = await render()
    expect(mockInvoke).toHaveBeenCalledWith("reminders_policy")
    expect(el.textContent).toContain("never appears on a congregation screen or Stage display")

    const thresholds = el.querySelector<HTMLInputElement>('[aria-label="Automatic reminder thresholds in minutes"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(thresholds, "5, 2")
      thresholds.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const stage = el.querySelector<HTMLInputElement>('[aria-label="Timekeeper reminder to Stage"]')!
    const urgent = el.querySelector<HTMLInputElement>('[aria-label="Mark automatic reminders urgent"]')!
    await act(async () => {
      stage.click()
      urgent.click()
    })
    const save = [...el.querySelectorAll("button")].find((button) => button.textContent === "Save reminder rules")!
    await act(async () => save.click())

    expect(mockInvoke).toHaveBeenCalledWith("reminders_set_policy", { policy: { thresholdsMin: [5, 2], to: ["role:stage"], urgent: true } })
    expect(el.textContent).toContain("Reminder rules saved on this host.")
  })

  it("shows host-load failures and does not expose controls that cannot be saved", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("host unavailable"))
    const el = await render()
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("Automatic reminders could not be loaded")
    expect(el.querySelector("button")).toBeNull()
  })
})
