import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}), emitTo: vi.fn(async () => {}) }))
const take = vi.fn(async () => { useBroadcastStore.setState({ ticker: { items: ["Welcome"], startedAt: 111 } as never }) })
const stop = vi.fn(() => { useBroadcastStore.setState({ ticker: null }) })
vi.mock("@/lib/cues", () => ({ CUE_ACTIONS: { "ticker.take": { run: () => take() }, "ticker.stop": { run: () => stop() } } }))

import { checkTickerWindow, useTickerWindow } from "@/stores/ticker-window-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useHold } from "@/stores/hold-store"
import { useSettingsStore } from "@/stores/settings-store"

// 13 Nov 2026 at hh:mm on this computer's clock (no church time zone).
const at = (hh: number, mm: number, day = 13) => new Date(2026, 10, day, hh, mm).getTime()
const settle = () => new Promise<void>((r) => setTimeout(r, 0))

beforeEach(() => {
  take.mockClear(); stop.mockClear()
  useTickerWindow.setState({ armed: null, mine: null, started: false })
  useBroadcastStore.setState({ ticker: null, rehearsal: false, tickerItems: ["Welcome"] })
  useSettingsStore.getState().setSetup({ timeZone: "" })
  if (useHold.getState().hold) useHold.getState().resume()
})

describe("the ticker on a clock window (#187)", () => {
  it("takes the ticker at From and stops the one it took at Until, then is over", async () => {
    expect(useTickerWindow.getState().arm("10:00", "10:30", "Ade", at(9, 50))).toBeNull()
    checkTickerWindow(at(9, 59))
    expect(take).not.toHaveBeenCalled()
    checkTickerWindow(at(10, 0))
    await settle()
    expect(take).toHaveBeenCalledTimes(1)
    checkTickerWindow(at(10, 1))
    expect(take).toHaveBeenCalledTimes(1)
    checkTickerWindow(at(10, 30))
    expect(stop).toHaveBeenCalledTimes(1)
    expect(useTickerWindow.getState().armed).toBeNull()
  })

  it("refuses a window that has passed, runs backwards, or has no words to show", () => {
    expect(useTickerWindow.getState().arm("09:00", "09:30", "Ade", at(10, 0))).toContain("has passed")
    expect(useTickerWindow.getState().arm("10:30", "10:00", "Ade", at(9, 0))).toContain("after it starts")
    useBroadcastStore.setState({ tickerItems: [" "] })
    expect(useTickerWindow.getState().arm("10:00", "10:30", "Ade", at(9, 0))).toContain("words first")
  })

  it("waits in rehearsal and on a Hold, at either end", async () => {
    useTickerWindow.getState().arm("10:00", "10:30", "Ade", at(9, 0))
    useHold.getState().start("Waiting for the pastor")
    checkTickerWindow(at(10, 5))
    expect(take).not.toHaveBeenCalled()
    useHold.getState().resume()
    checkTickerWindow(at(10, 6))
    await settle()
    expect(take).toHaveBeenCalledTimes(1)
    useBroadcastStore.setState({ rehearsal: true })
    checkTickerWindow(at(10, 31))
    expect(stop).not.toHaveBeenCalled()
    expect(useTickerWindow.getState().armed).not.toBeNull()
    // Rehearsal over (the real ticker back): stopped then.
    useBroadcastStore.setState({ rehearsal: false })
    checkTickerWindow(at(10, 32))
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it("never stops a ticker it did not take: one already on, or a new one an operator took", async () => {
    useTickerWindow.getState().arm("10:00", "10:30", "Ade", at(9, 0))
    useBroadcastStore.setState({ ticker: { items: ["Mine"], startedAt: 5 } as never })
    checkTickerWindow(at(10, 0))
    checkTickerWindow(at(10, 30))
    expect(take).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
    // Took one, an operator stopped it and took their own: theirs stays on.
    useBroadcastStore.setState({ ticker: null })
    useTickerWindow.getState().arm("11:00", "11:30", "Ade", at(10, 40))
    checkTickerWindow(at(11, 0))
    await settle()
    useBroadcastStore.setState({ ticker: { items: ["Theirs"], startedAt: 999 } as never })
    checkTickerWindow(at(11, 30))
    expect(stop).not.toHaveBeenCalled()
  })

  it("is today's: a computer asleep past it ends it without going on", () => {
    useTickerWindow.getState().arm("22:30", "23:00", "Ade", at(22, 0))
    checkTickerWindow(at(22, 40, 14))
    expect(take).not.toHaveBeenCalled()
    expect(useTickerWindow.getState().armed).toBeNull()
  })
})
