// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn(async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} })) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { TickerControl } from "./ticker"

let root: Root | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  Element.prototype.scrollIntoView = vi.fn()
  HTMLCanvasElement.prototype.getContext = (() => null) as never
  document.body.replaceChildren()
  const state = useBroadcastStore.getState()
  useBroadcastStore.setState({
    ticker: null,
    tickerItems: ["Prayer meeting Wednesday"],
    tickerPresets: [{ id: "sunday", name: "Sunday notices", items: ["Choir practice Saturday"] }],
    outputs: state.outputs.map((output) => output.id === "main" ? { ...output, ticker: true } : output),
    outputFrames: {},
  })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function renderTicker() {
  const element = document.createElement("div")
  document.body.appendChild(element)
  root = createRoot(element)
  await act(async () => root!.render(<TickerControl />))
  return element
}

async function openTicker(element: HTMLElement) {
  const trigger = element.querySelector<HTMLButtonElement>('button[title^="News ticker"]')!
  await act(async () => trigger.click())
}

function editTextarea(textarea: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value)
  textarea.dispatchEvent(new Event("input", { bubbles: true }))
}

function editInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("Present ticker word edits", () => {
  it("keeps edits private while running until Update running ticker is chosen", async () => {
    useBroadcastStore.getState().setTicker({ backing: null })
    const before = useBroadcastStore.getState().outputFrames.main?.ticker
    const element = await renderTicker()
    await openTicker(element)

    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ticker items, one per line"]')!
    await act(async () => editTextarea(textarea, "Changed while on air"))

    expect(useBroadcastStore.getState().ticker?.items).toEqual(["Prayer meeting Wednesday"])
    expect(useBroadcastStore.getState().outputFrames.main?.ticker).toEqual(before)
    expect(textarea.value).toBe("Changed while on air")

    const name = document.querySelector<HTMLInputElement>('input[aria-label="Name for this set"]')!
    await act(async () => editInput(name, "Changed words"))
    const save = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Save") as HTMLButtonElement
    await act(async () => save.click())
    expect(useBroadcastStore.getState().tickerPresets.at(-1)?.items).toEqual(["Changed while on air"])
    expect(useBroadcastStore.getState().ticker?.items).toEqual(["Prayer meeting Wednesday"])

    const update = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Update running ticker")) as HTMLButtonElement
    expect(update).toBeTruthy()
    await act(async () => update.click())

    expect(useBroadcastStore.getState().ticker?.items).toEqual(["Changed while on air"])
    expect(useBroadcastStore.getState().outputFrames.main?.ticker?.items).toEqual(["Changed while on air"])
  })

  it("keeps a selected preset private while running until the same explicit update", async () => {
    useBroadcastStore.getState().setTicker({ backing: null })
    const element = await renderTicker()
    await openTicker(element)

    const load = document.querySelector<HTMLButtonElement>('button[aria-label="Load a saved set"]')!
    await act(async () => load.click())
    const preset = [...document.querySelectorAll('[role="option"]')].find((option) => option.textContent?.includes("Sunday notices")) as HTMLElement
    expect(preset).toBeTruthy()
    await act(async () => preset.click())

    expect(useBroadcastStore.getState().ticker?.items).toEqual(["Prayer meeting Wednesday"])
    expect(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ticker items, one per line"]')?.value).toBe("Choir practice Saturday")

    const update = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Update running ticker")) as HTMLButtonElement
    await act(async () => update.click())
    expect(useBroadcastStore.getState().ticker?.items).toEqual(["Choir practice Saturday"])
  })

  it("continues to edit the saved words directly while the ticker is stopped", async () => {
    const element = await renderTicker()
    await openTicker(element)
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ticker items, one per line"]')!

    await act(async () => editTextarea(textarea, "Next announcement"))

    expect(useBroadcastStore.getState().ticker).toBeNull()
    expect(useBroadcastStore.getState().tickerItems).toEqual(["Next announcement"])
    expect(document.querySelector("button")?.textContent).not.toContain("Update running ticker")
  })

  it("keeps unapplied words for next use when the running ticker is stopped", async () => {
    useBroadcastStore.getState().setTicker({ backing: null })
    const element = await renderTicker()
    await openTicker(element)
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ticker items, one per line"]')!
    await act(async () => editTextarea(textarea, "For the next ticker"))

    const stop = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Stop")) as HTMLButtonElement
    await act(async () => stop.click())

    expect(useBroadcastStore.getState().ticker).toBeNull()
    expect(useBroadcastStore.getState().tickerItems).toEqual(["For the next ticker"])
    expect(useBroadcastStore.getState().outputFrames.main?.ticker ?? null).toBeNull()
  })
})
