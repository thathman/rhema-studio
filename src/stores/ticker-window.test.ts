import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}), emitTo: vi.fn(async () => {}) }))
const take = vi.fn(async () => {})
const stop = vi.fn(() => {})
vi.mock("@/lib/cues", () => ({ CUE_ACTIONS: { "ticker.take": { run: () => take() }, "ticker.stop": { run: () => stop() } } }))

import { checkTickerWindow, useTickerWindow } from "@/stores/ticker-window-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"

// 13 Nov 2026 at hh:mm on this computer's clock (no church time zone).
const at = (hh: number, mm: number) => new Date(2026, 10, 13, hh, mm).getTime()

beforeEach(() => {
  take.mockClear(); stop.mockClear()
  useTickerWindow.setState({ armed: null, took: false, started: false })
  useBroadcastStore.setState({ ticker: null, rehearsal: false })
  useSettingsStore.getState().setSetup({ timeZone: "" })
})

describe("the ticker on a clock window (#187)", () => {
  it("takes the ticker at From and stops what it took at Until, then is over", () => {
    expect(useTickerWindow.getState().arm("10:00", "10:30", "Ade", at(9, 50))).toBeNull()
    checkTickerWindow(at(9, 59))
    expect(take).not.toHaveBeenCalled()
    checkTickerWindow(at(10, 0))
    expect(take).toHaveBeenCalledTimes(1)
    checkTickerWindow(at(10, 1))
    expect(take).toHaveBeenCalledTimes(1)
    useBroadcastStore.setState({ ticker: { backing: null } as never })
    checkTickerWindow(at(10, 30))
    expect(stop).toHaveBeenCalledTimes(1)
    expect(useTickerWindow.getState().armed).toBeNull()
  })

  it("takes at once when armed inside the window; refuses a window that has passed or runs backwards", () => {
    expect(useTickerWindow.getState().arm("10:00", "10:30", "Ade", at(10, 10))).toBeNull()
    expect(take).toHaveBeenCalledTimes(1)
    useTickerWindow.setState({ armed: null, took: false, started: false })
    expect(useTickerWindow.getState().arm("09:00", "09:30", "Ade", at(10, 0))).toContain("has passed")
    expect(useTickerWindow.getState().arm("10:30", "10:00", "Ade", at(9, 0))).toContain("after it starts")
  })

  it("waits in rehearsal, and never stops a ticker someone else took", () => {
    useTickerWindow.getState().arm("10:00", "10:30", "Ade", at(9, 0))
    useBroadcastStore.setState({ rehearsal: true })
    checkTickerWindow(at(10, 5))
    expect(take).not.toHaveBeenCalled()
    // An operator took it themself during rehearsal's wait: the window finds it on, leaves it, and leaves it on.
    useBroadcastStore.setState({ rehearsal: false, ticker: { backing: null } as never })
    checkTickerWindow(at(10, 6))
    expect(take).not.toHaveBeenCalled()
    checkTickerWindow(at(10, 31))
    expect(stop).not.toHaveBeenCalled()
  })
})
