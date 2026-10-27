// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { CUE_ACTIONS } from "@/lib/cues"
import { useEventClock } from "@/stores/event-clock-store"
import { useJoin } from "@/stores/join-store"
import { useQueueStore } from "@/stores/queue-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { EventCuesEditor } from "./event-cues-editor"

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  vi.restoreAllMocks()
  useQueueStore.setState({ items: [], headers: [], activeIndex: null, addTarget: null })
  useEventClock.setState({ currentId: null, currentMomentId: null })
  useJoin.setState({ status: "off", me: null, paused: false })
  useBroadcastStore.setState({ rehearsal: false })
  useSettingsStore.setState({ customMacros: [] })
})

async function renderEditor() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<EventCuesEditor eventId="prayer" />))
  return host
}

function prepareActiveEvent() {
  useQueueStore.setState({
    items: [],
    headers: [{ id: "prayer", type: "group", name: "Opening Prayer", at: 0, event: { schema_version: 1 } }],
    activeIndex: null,
  })
  useEventClock.setState({ currentId: "prayer", currentMomentId: null })
  useJoin.setState({ status: "off", me: null, paused: false })
  useBroadcastStore.setState({ rehearsal: false })
  useSettingsStore.setState({ customMacros: [] })
}

describe("event cue arming and execution", () => {
  it("saves a cue snapshot, then requires Arm and a scoped confirmation before running it", async () => {
    prepareActiveEvent()
    const el = await renderEditor()
    const runSteps = ["rehearsal.off", "timer.fresh", "quick.welcome"] as const
    const actionSpies = runSteps.map((id) => vi.spyOn(CUE_ACTIONS[id], "run").mockImplementation(() => undefined))

    const cuePicker = el.querySelector<HTMLSelectElement>('[aria-label="Cue to add to this event"]')!
    await act(async () => {
      cuePicker.value = "service-start"
      cuePicker.dispatchEvent(new Event("change", { bubbles: true }))
      el.querySelector<HTMLButtonElement>('[aria-label="Add cue to Opening Prayer"]')!.click()
    })
    expect(useQueueStore.getState().headers[0].event?.cues).toEqual([
      { id: expect.any(String), name: "Start the service", trigger: "manual", steps: runSteps },
    ])
    expect(actionSpies.every((spy) => !spy.mock.calls.length)).toBe(true)

    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Arm cue: Start the service"]')!.click())
    expect(el.textContent).toContain("Armed")
    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Review cue: Start the service"]')!.click())
    expect(document.body.textContent).toContain("Puts a screen over what the main screens show")
    expect(actionSpies.every((spy) => !spy.mock.calls.length)).toBe(true)

    await act(async () => document.body.querySelector<HTMLButtonElement>('[aria-label="Run event cue now"]')!.click())
    expect(actionSpies.every((spy) => spy.mock.calls.length === 1)).toBe(true)
  })

  it("does not arm from a joined desk, in rehearsal, or for an event that is not current", async () => {
    prepareActiveEvent()
    const el = await renderEditor()
    const cuePicker = el.querySelector<HTMLSelectElement>('[aria-label="Cue to add to this event"]')!
    await act(async () => {
      cuePicker.value = "service-start"
      cuePicker.dispatchEvent(new Event("change", { bubbles: true }))
      el.querySelector<HTMLButtonElement>('[aria-label="Add cue to Opening Prayer"]')!.click()
    })

    const arm = () => el.querySelector<HTMLButtonElement>('[aria-label="Arm cue: Start the service"]')!
    act(() => useJoin.setState({ status: "connected", me: { name: "Stage desk", role: "stage" } }))
    expect(arm().disabled).toBe(true)
    act(() => useJoin.setState({ status: "off", me: null }))
    act(() => useBroadcastStore.setState({ rehearsal: true }))
    expect(arm().disabled).toBe(true)
    act(() => useBroadcastStore.setState({ rehearsal: false }))
    act(() => useEventClock.setState({ currentId: "sermon" }))
    expect(arm().disabled).toBe(true)
  })

  it("preserves unavailable custom actions and refuses to snapshot an empty cue", async () => {
    prepareActiveEvent()
    useSettingsStore.setState({ customMacros: [
      { id: "mixed-future", label: "Mixed future cue", steps: ["quick.welcome", "future.screen"] },
      { id: "future-only", label: "Future-only cue", steps: ["future.live"] },
      { id: "empty", label: "Empty cue", steps: [] },
    ] })
    const el = await renderEditor()
    const picker = el.querySelector<HTMLSelectElement>('[aria-label="Cue to add to this event"]')!
    const add = () => el.querySelector<HTMLButtonElement>('[aria-label="Add cue to Opening Prayer"]')!
    const choose = async (id: string) => act(async () => {
      picker.value = id
      picker.dispatchEvent(new Event("change", { bubbles: true }))
    })

    await choose("mixed-future")
    expect(add().disabled).toBe(false)
    await act(async () => add().click())
    expect(useQueueStore.getState().headers[0].event?.cues?.[0].steps).toEqual(["quick.welcome", "future.screen"])
    expect(el.textContent).toContain("Unavailable action")
    expect(el.querySelector<HTMLButtonElement>('[aria-label="Review cue: Mixed future cue"]')!.disabled).toBe(true)

    await choose("future-only")
    expect(add().disabled).toBe(false)
    await act(async () => add().click())
    expect(useQueueStore.getState().headers[0].event?.cues?.[1].steps).toEqual(["future.live"])
    expect(el.querySelector<HTMLButtonElement>('[aria-label="Review cue: Future-only cue"]')!.disabled).toBe(true)

    await choose("empty")
    expect(add().disabled).toBe(true)
    await act(async () => add().click())
    expect(useQueueStore.getState().headers[0].event?.cues).toHaveLength(2)
  })
})
