// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const invokeMock = vi.hoisted(() => vi.fn())
const openSettingsMock = vi.hoisted(() => vi.fn())
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))
vi.mock("@/lib/settings-dialog", () => ({ openSettings: openSettingsMock }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { isOpenMode, OPEN_MODE_POLL_MS } from "./open-mode"
import { OpenModeWarning } from "./open-mode-warning"

type Status = { http: { running: boolean; lan?: boolean }; osc: { running: boolean; lan?: boolean }; auth: { required: boolean } }
let status: Status

let element: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  status = { http: { running: true, lan: true }, osc: { running: false }, auth: { required: false } }
  invokeMock.mockReset()
  invokeMock.mockImplementation(async (cmd: string) => cmd === "get_http_status" ? status.http : cmd === "get_osc_status" ? status.osc : cmd === "get_remote_auth_status" ? status.auth : null)
  openSettingsMock.mockReset()
  element = document.createElement("div")
  document.body.append(element)
  root = createRoot(element)
})

afterEach(() => {
  act(() => root.unmount())
  element.remove()
  vi.useRealTimers()
})

describe("open mode (#839 S15)", () => {
  it("is keys off with an HTTP or OSC listener actually on the LAN", () => {
    expect(isOpenMode({ running: true, lan: true }, null, { required: false })).toBe(true)
    expect(isOpenMode(null, { running: true, lan: true }, { required: false })).toBe(true)
    expect(isOpenMode({ running: true, lan: true }, null, { required: true })).toBe(false)
    expect(isOpenMode({ running: true, lan: false }, { running: false, lan: true }, { required: false })).toBe(false)
    // Unknown auth state is not reported as open mode by this warning (Show Health covers "unknown").
    expect(isOpenMode({ running: true, lan: true }, null, null)).toBe(false)
  })

  it("stands in Live's header with no way to dismiss it, and opens Remote control settings", async () => {
    await act(async () => root.render(<OpenModeWarning />))
    const warning = element.querySelector<HTMLElement>('[data-testid="open-mode-warning"]')!
    expect(warning.getAttribute("role")).toBe("alert")
    expect(warning.textContent).toContain("Remote keys are off on the network")
    const buttons = [...warning.querySelectorAll("button")]
    expect(buttons.map((b) => b.textContent)).toEqual(["Open Remote control settings"])
    await act(async () => buttons[0].click())
    expect(openSettingsMock).toHaveBeenCalledWith("remote")
    // Still there afterwards: only turning keys on or stopping the LAN listener ends it.
    expect(element.querySelector('[data-testid="open-mode-warning"]')).not.toBeNull()
  })

  it("a failed status read keeps the warning; a partial read that still shows keys off with a LAN listener shows it", async () => {
    await act(async () => root.render(<OpenModeWarning />))
    expect(element.querySelector('[data-testid="open-mode-warning"]')).not.toBeNull()
    const working = invokeMock.getMockImplementation()!
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_remote_auth_status") throw new Error("host busy")
      return working(cmd)
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(OPEN_MODE_POLL_MS) })
    expect(element.querySelector('[data-testid="open-mode-warning"]')).not.toBeNull()

    // Started with keys on, then the OSC read fails while HTTP shows keys off on the LAN.
    act(() => root.unmount())
    element.remove()
    element = document.createElement("div")
    document.body.append(element)
    root = createRoot(element)
    status.auth = { required: true }
    invokeMock.mockImplementation(working)
    await act(async () => root.render(<OpenModeWarning />))
    expect(element.querySelector('[data-testid="open-mode-warning"]')).toBeNull()
    status.auth = { required: false }
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_osc_status") throw new Error("host busy")
      return working(cmd)
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(OPEN_MODE_POLL_MS) })
    expect(element.querySelector('[data-testid="open-mode-warning"]')).not.toBeNull()
  })

  it("goes away when keys are turned on, and comes back if they are turned off again", async () => {
    await act(async () => root.render(<OpenModeWarning />))
    expect(element.querySelector('[data-testid="open-mode-warning"]')).not.toBeNull()
    status.auth = { required: true }
    await act(async () => { await vi.advanceTimersByTimeAsync(OPEN_MODE_POLL_MS) })
    expect(element.querySelector('[data-testid="open-mode-warning"]')).toBeNull()
    status.auth = { required: false }
    status.http = { running: true, lan: false }
    await act(async () => { await vi.advanceTimersByTimeAsync(OPEN_MODE_POLL_MS) })
    expect(element.querySelector('[data-testid="open-mode-warning"]')).toBeNull()
    status.osc = { running: true, lan: true }
    await act(async () => { await vi.advanceTimersByTimeAsync(OPEN_MODE_POLL_MS) })
    expect(element.querySelector('[data-testid="open-mode-warning"]')).not.toBeNull()
  })
})
