// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

import { idleTimer } from "@/lib/timer"
import { useAuxTimers } from "@/stores/aux-timers-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useShellStore } from "@/studio/shell-store"
import {
  NO_SERVICE_TIMER_DRAFT_KEY,
  usePresentDraftsStore,
} from "@/studio/present/present-drafts-store"
import { AuxTimersPanel } from "./aux-timers"
import { StageMessage } from "./stage-message"

let root: Root | null = null

beforeEach(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  useShellStore.setState({
    workspace: "present",
    designTab: "themes",
    designRequest: null,
  })
  usePresentDraftsStore.setState({
    stageMessage: "",
    auxTimerDrafts: {},
  })
  useServiceStore.setState({ current: null })
  useSettingsStore.setState({ serviceTimers: {} })
  useBroadcastStore.setState({
    outputs: [{ id: "stage-1", name: "Stage", role: "stage" } as never],
    isLive: true,
    liveVerse: {
      reference: "John 3:16",
      segments: [{ text: "Existing program" }],
    },
    stageMessage: "Wrap up",
  })
  useAuxTimers.setState({
    timers: [
      {
        id: "prep",
        label: "Communion prep",
        timer: idleTimer(300_000),
        onStage: true,
        owner: "",
      },
    ],
    tick: 0,
  })
  root = createRoot(document.body.appendChild(document.createElement("div")))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

describe("Live to Design handoffs", () => {
  it("opens the Stage designer without changing Stage or Program", async () => {
    const before = useBroadcastStore.getState()
    await act(async () => {
      root!.render(<StageMessage />)
    })
    const design = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Design stage display"))!

    await act(async () => {
      design.click()
    })

    expect(useShellStore.getState().designRequest).toBe("stage")
    expect(useBroadcastStore.getState().stageMessage).toBe("Wrap up")
    expect(useBroadcastStore.getState().isLive).toBe(true)
    expect(useBroadcastStore.getState().liveVerse).toEqual(before.liveVerse)
    expect(useBroadcastStore.getState().outputs).toEqual(before.outputs)
  })

  it("preserves an unsent Stage draft across Design navigation and a Live remount", async () => {
    await act(async () => {
      root!.render(<StageMessage />)
    })
    const input = document.querySelector<HTMLInputElement>(
      '[aria-label="Message to stage"]'
    )!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(input, "Unsent note")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const design = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Design stage display"))!

    expect(design.disabled).toBe(false)
    await act(async () => {
      design.click()
    })
    expect(useShellStore.getState().designRequest).toBe("stage")
    expect(usePresentDraftsStore.getState().stageMessage).toBe("Unsent note")
    await act(async () => {
      root!.unmount()
      root = createRoot(
        document.body.appendChild(document.createElement("div"))
      )
      root.render(<StageMessage />)
    })
    expect(
      document.querySelector<HTMLInputElement>(
        '[aria-label="Message to stage"]'
      )?.value
    ).toBe("Unsent note")
  })

  it("opens Countdown design without changing timers, Stage, or Program", async () => {
    const broadcastBefore = useBroadcastStore.getState()
    const timersBefore = useAuxTimers.getState().timers
    await act(async () => {
      root!.render(<AuxTimersPanel />)
    })
    const design = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) =>
      button.textContent?.includes("Design countdown display")
    )!

    await act(async () => {
      design.click()
    })

    expect(useShellStore.getState().designRequest).toBe("countdown")
    expect(useAuxTimers.getState().timers).toEqual(timersBefore)
    expect(useBroadcastStore.getState().stageMessage).toBe(
      broadcastBefore.stageMessage
    )
    expect(useBroadcastStore.getState().isLive).toBe(true)
    expect(useBroadcastStore.getState().liveVerse).toEqual(
      broadcastBefore.liveVerse
    )
  })

  it("preserves timer details across Design navigation and a panel remount", async () => {
    await act(async () => {
      root!.render(<AuxTimersPanel />)
    })
    const input = document.querySelector<HTMLInputElement>(
      '[aria-label="New timer name"]'
    )!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(input, "Unsent timer")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const minutes = document.querySelector<HTMLInputElement>(
      '[aria-label="Minutes"]'
    )!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(minutes, "8")
      minutes.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const owner = document.querySelector<HTMLSelectElement>(
      '[aria-label="Who runs the new timer"]'
    )!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value"
      )!.set!.call(owner, "stage")
      owner.dispatchEvent(new Event("change", { bubbles: true }))
    })
    const design = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) =>
      button.textContent?.includes("Design countdown display")
    )!

    expect(design.disabled).toBe(false)
    await act(async () => {
      design.click()
    })
    expect(useShellStore.getState().designRequest).toBe("countdown")
    expect(
      usePresentDraftsStore.getState().auxTimerDrafts[
        NO_SERVICE_TIMER_DRAFT_KEY
      ]
    ).toEqual({
      label: "Unsent timer",
      minutes: "8",
      owner: "stage",
    })
    await act(async () => {
      root!.unmount()
      root = createRoot(
        document.body.appendChild(document.createElement("div"))
      )
      root.render(<AuxTimersPanel />)
    })
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="New timer name"]')
        ?.value
    ).toBe("Unsent timer")
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="Minutes"]')?.value
    ).toBe("8")
    expect(
      document.querySelector<HTMLSelectElement>(
        '[aria-label="Who runs the new timer"]'
      )?.value
    ).toBe("stage")
  })

  it("keeps a timer draft with the service where it was started", async () => {
    useServiceStore.setState({
      current: { id: "service-a", title: "Service A" } as never,
    })
    await act(async () => {
      root!.render(<AuxTimersPanel />)
    })
    const name = document.querySelector<HTMLInputElement>(
      '[aria-label="New timer name"]'
    )!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(name, "Communion prep")
      name.dispatchEvent(new Event("input", { bubbles: true }))
    })

    await act(async () => {
      useServiceStore.setState({
        current: { id: "service-b", title: "Service B" } as never,
      })
    })
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="New timer name"]')
        ?.value
    ).toBe("")
    expect(
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent?.includes("Add")
      )?.disabled
    ).toBe(true)

    await act(async () => {
      useServiceStore.setState({
        current: { id: "service-a", title: "Service A" } as never,
      })
    })
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="New timer name"]')
        ?.value
    ).toBe("Communion prep")
  })

  it("clears the added timer name while retaining reusable duration and owner", async () => {
    useServiceStore.setState({
      current: { id: "service-a", title: "Service A" } as never,
    })
    await act(async () => {
      root!.render(<AuxTimersPanel />)
    })
    const name = document.querySelector<HTMLInputElement>(
      '[aria-label="New timer name"]'
    )!
    const minutes = document.querySelector<HTMLInputElement>(
      '[aria-label="Minutes"]'
    )!
    const owner = document.querySelector<HTMLSelectElement>(
      '[aria-label="Who runs the new timer"]'
    )!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(name, "Communion prep")
      name.dispatchEvent(new Event("input", { bubbles: true }))
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(minutes, "8")
      minutes.dispatchEvent(new Event("input", { bubbles: true }))
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value"
      )!.set!.call(owner, "stage")
      owner.dispatchEvent(new Event("change", { bubbles: true }))
    })
    const add = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Add"))!
    await act(async () => {
      add.click()
    })

    expect(useAuxTimers.getState().timers).toEqual([
      expect.objectContaining({
        label: "Communion prep",
        owner: "stage",
        timer: expect.objectContaining({ durationMs: 480_000 }),
      }),
    ])
    expect(useSettingsStore.getState().serviceTimers["service-a"]).toEqual([
      {
        id: expect.any(String),
        label: "Communion prep",
        minutes: 8,
        owner: "stage",
      },
    ])
    expect(
      usePresentDraftsStore.getState().auxTimerDrafts["service-a"]
    ).toEqual({ label: "", minutes: "8", owner: "stage" })
  })
})
