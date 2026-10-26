// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/ui/canvas-verse", () => ({ CanvasVerse: () => <div aria-label="Design preview" /> }))
vi.mock("@/studio/prepare/slide-composer", () => ({ SlideBackground: () => <div /> }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), emit: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { LowerThirdDesigner } from "./lower-third-designer"
import { TickerDesigner } from "./ticker-designer"
import { StageDesigner } from "./stage-designer"
import { CountdownDesigner } from "./countdown-designer"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { DEFAULT_LOWER_THIRD_STYLE } from "@/lib/lower-third-style"
import { DEFAULT_TICKER_STYLE } from "@/lib/ticker"
import { DEFAULT_STAGE_STYLE } from "@/lib/stage-style"
import { DEFAULT_COUNTDOWN_LOOK } from "@/lib/countdown-display"

let root: Root | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  HTMLCanvasElement.prototype.getContext = (() => null) as never
  const state = useBroadcastStore.getState()
  useBroadcastStore.setState({
    lowerThird: null,
    lowerThirdStyles: [{ ...DEFAULT_LOWER_THIRD_STYLE }],
    ticker: null,
    tickerItems: [],
    tickerStyle: { ...DEFAULT_TICKER_STYLE },
    stageStyle: { ...DEFAULT_STAGE_STYLE },
    countdownLook: { ...DEFAULT_COUNTDOWN_LOOK },
    designDrafts: [],
    outputs: state.outputs.slice(0, 1),
    outputFrames: {},
  })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function render(node: React.ReactNode) {
  const element = document.createElement("div")
  document.body.appendChild(element)
  root = createRoot(element)
  await act(async () => root!.render(node))
  return element
}

async function saveAndApply(element: HTMLElement) {
  await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Save Draft")!.click())
  expect(useBroadcastStore.getState().designDrafts).toHaveLength(1)
  expect(element.textContent).toContain("Saved draft · outputs unchanged")
  await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Apply design…")!.click())
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
  await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Apply design")!.click())
  expect(useBroadcastStore.getState().designDrafts).toHaveLength(0)
}

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }))
}

describe("design editors keep edits in draft until applied (#442)", () => {
  it("does not change a lower third that is already on air while editing", async () => {
    const style = { ...DEFAULT_LOWER_THIRD_STYLE }
    useBroadcastStore.setState({
      lowerThirdStyles: [style],
      lowerThird: { line1: "Pastor Tolu", line2: "Senior Pastor", style },
    })
    const element = await render(<LowerThirdDesigner />)

    await act(async () => setValue(element.querySelector<HTMLInputElement>('[aria-label="Style name"]')!, "Evening band"))

    expect(useBroadcastStore.getState().lowerThirdStyles[0]).toEqual(style)
    expect(useBroadcastStore.getState().lowerThird?.style).toEqual(style)

    await saveAndApply(element)
    expect(useBroadcastStore.getState().lowerThirdStyles[0].name).toBe("Evening band")
    expect(useBroadcastStore.getState().lowerThird?.style?.name).toBe("Evening band")
  })

  it("does not change a running ticker while editing", async () => {
    const style = { ...DEFAULT_TICKER_STYLE }
    useBroadcastStore.setState({
      tickerStyle: style,
      ticker: { items: ["Service begins at 10"], style, startedAt: 1 },
      tickerItems: ["Service begins at 10"],
    })
    const element = await render(<TickerDesigner />)

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Top")!.click())

    expect(useBroadcastStore.getState().tickerStyle).toEqual(style)
    expect(useBroadcastStore.getState().ticker?.style).toEqual(style)

    await saveAndApply(element)
    expect(useBroadcastStore.getState().tickerStyle.position).toBe("top")
    expect(useBroadcastStore.getState().ticker?.style.position).toBe("top")
  })

  it("does not change an active stage display while editing", async () => {
    const style = { ...DEFAULT_STAGE_STYLE }
    useBroadcastStore.setState({
      stageStyle: style,
      outputs: [{ ...useBroadcastStore.getState().outputs[0], id: "stage", name: "Stage", role: "stage" }],
    })
    const element = await render(<StageDesigner />)

    await act(async () => element.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())

    expect(useBroadcastStore.getState().stageStyle).toEqual(style)
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Save Draft")!.click())
    expect(useBroadcastStore.getState().designDrafts).toMatchObject([{ id: "stage:default", value: { showTimer: false } }])
    act(() => root?.unmount())
    root = null
    document.body.replaceChildren()
    const reopened = await render(<StageDesigner />)
    expect(reopened.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false)
    expect(useBroadcastStore.getState().stageStyle).toEqual(style)

    await saveAndApply(reopened)
    expect(useBroadcastStore.getState().stageStyle.showTimer).toBe(false)
  })

  it("keeps the stage built-in reset in the draft until applied", async () => {
    const published = { ...DEFAULT_STAGE_STYLE, background: "#16202a" }
    useBroadcastStore.setState({ stageStyle: published })
    const element = await render(<StageDesigner />)
    expect([...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Apply design…")?.disabled).toBe(true)

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("built-in look"))!.click())

    expect(useBroadcastStore.getState().stageStyle).toEqual(published)
    expect(element.textContent).toContain("Draft changes · outputs unchanged")
    expect([...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Apply design…")?.disabled).toBe(false)
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Save Draft")!.click())
    expect(useBroadcastStore.getState().designDrafts).toMatchObject([{ id: "stage:default", value: DEFAULT_STAGE_STYLE }])
    expect(useBroadcastStore.getState().stageStyle).toEqual(published)
  })

  it("does not change a running countdown display while editing", async () => {
    const look = { ...DEFAULT_COUNTDOWN_LOOK }
    useBroadcastStore.setState({
      countdownLook: look,
      outputs: [{ ...useBroadcastStore.getState().outputs[0], id: "stage-countdown", name: "Stage countdown", role: "stage", stageLayout: "countdown" }],
    })
    const element = await render(<CountdownDesigner />)

    await act(async () => setValue(element.querySelector<HTMLSelectElement>('[aria-label="What the countdown counts"]')!, "item"))

    expect(useBroadcastStore.getState().countdownLook).toEqual(look)

    await saveAndApply(element)
    expect(useBroadcastStore.getState().countdownLook.counts).toBe("item")
  })

  it("keeps the countdown built-in reset in the draft until applied", async () => {
    const published = { ...DEFAULT_COUNTDOWN_LOOK, counts: "item" as const }
    useBroadcastStore.setState({ countdownLook: published })
    const element = await render(<CountdownDesigner />)

    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("built-in look"))!.click())

    expect(useBroadcastStore.getState().countdownLook).toEqual(published)
    expect(element.textContent).toContain("Draft changes · outputs unchanged")
    await act(async () => [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Save Draft")!.click())
    expect(useBroadcastStore.getState().designDrafts).toMatchObject([{ id: "countdown:default", value: DEFAULT_COUNTDOWN_LOOK }])
    expect(useBroadcastStore.getState().countdownLook).toEqual(published)
  })
})
