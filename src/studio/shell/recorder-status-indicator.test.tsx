// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const native = vi.hoisted(() => ({
  status: null as unknown,
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  invoke: vi.fn(),
  listenFails: false,
}))

vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
    if (native.listenFails) throw new Error("event stream unavailable")
    native.handlers.set(event, handler)
    return () => { native.handlers.delete(event) }
  }),
}))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { useRecorderAlertStore } from "@/stores/recorder-alert-store"
import { useShellStore } from "@/studio/shell-store"
import { RecorderStatusIndicator } from "./recorder-status-indicator"

const recording = { state: "recording", sessionActive: true, outputId: "sanctuary", problem: null }
const failed = { state: "failed", sessionActive: true, outputId: "sanctuary", problem: { message: "Encoder stopped unexpectedly." } }

let host: HTMLDivElement
let root: Root

async function render(workspace: "home" | "present" = "home") {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<RecorderStatusIndicator workspace={workspace} />)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return host
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  native.handlers.clear()
  native.listenFails = false
  native.status = recording
  native.invoke.mockReset().mockImplementation(async (command: string) => command === "recorder_status" ? native.status : null)
  useRecorderAlertStore.getState().reset()
})

afterEach(async () => {
  if (root) await act(async () => root.unmount())
  host?.remove()
})

describe("RecorderStatusIndicator", () => {
  it("keeps recording and failure status visible outside Live and links to recovery", async () => {
    const goTo = vi.fn()
    useShellStore.setState({ goTo } as never)
    const el = await render("home")

    expect(el.querySelector('[aria-label="Recorder status"]')?.textContent).toContain("Recording is active · sanctuary")
    await act(async () => {
      native.handlers.get("recorder:status")?.({ payload: failed })
      await Promise.resolve()
    })
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("Recording failed · Encoder stopped unexpectedly.")
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Open History")?.click())
    expect(goTo).toHaveBeenCalledWith("archive")
  })

  it("does not duplicate the Live recorder status beside the full recorder dock", async () => {
    const el = await render("present")
    expect(el.querySelector('[aria-label="Recorder status"]')).toBeNull()
    expect(native.invoke).toHaveBeenCalledWith("recorder_status")
  })

  it("keeps backend automatic-stop notices visible and actionable after leaving Live", async () => {
    const goTo = vi.fn()
    useShellStore.setState({ goTo } as never)
    const el = await render("home")
    await act(async () => native.handlers.get("recorder:output_left")?.({ payload: { outputId: "sanctuary", stopped: true } }))

    expect(useRecorderAlertStore.getState().alerts.safety).toContain("Recording stopped automatically because sanctuary is no longer a congregation screen")
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("Recording stopped automatically because sanctuary is no longer a congregation screen")
    expect(el.textContent).toContain("Review the saved recording in History")
    await act(async () => native.handlers.get("recorder:status")?.({ payload: { state: "idle", sessionActive: false, outputId: null, problem: null } }))
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("Recording stopped automatically")
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Open Live")?.click())
    expect(goTo).toHaveBeenCalledWith("present")
  })

  it("keeps a recorder action alert visible until it is dismissed", async () => {
    useRecorderAlertStore.getState().report("action", "Recording did not start: encoder unavailable")
    const el = await render("home")

    expect(el.querySelector('[role="alert"]')?.textContent).toContain("Recording did not start: encoder unavailable")
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.getAttribute("aria-label") === "Dismiss recorder alert")?.click())
    expect(useRecorderAlertStore.getState().alerts.action).toBeNull()
    expect(el.querySelector('[role="alert"]')).toBeNull()
    expect(el.textContent).toContain("Recording is active")
  })

  it("polls for a new recording when recorder status events cannot connect", async () => {
    native.listenFails = true
    native.status = { state: "idle", sessionActive: false, outputId: null, problem: null }
    const el = await render("home")
    expect(el.querySelector('[aria-label="Recorder status"]')).toBeNull()

    native.status = recording
    await act(async () => new Promise((resolve) => setTimeout(resolve, 1100)))
    expect(el.querySelector('[role="status"]')?.textContent).toContain("Recording is active · sanctuary")
  })
})
