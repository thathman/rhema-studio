// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const calls: { cmd: string; args: Record<string, unknown> }[] = []
const handlers = new Map<string, (e: { payload: string }) => void>()
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args })
    if (cmd === "join_me") return { name: "Timekeeper desk", role: "timekeeper" }
    return null
  }),
}))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn(async () => {}),
  listen: vi.fn(async (name: string, h: (e: { payload: string }) => void) => {
    handlers.set(name, h)
    return () => {}
  }),
}))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { buildLiveState, type LiveStateV1 } from "@/lib/live-state"
import { deskFreshness, skewWords } from "@/lib/desk-freshness"
import { useRemoteControl } from "@/hooks/use-remote-control"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useHold } from "@/stores/hold-store"
import { useJoin } from "@/stores/join-store"
import { useJournalStore } from "@/stores/journal-store"
import { useSettingsStore } from "@/stores/settings-store"
import { OperatorsPanel } from "@/studio/production/operators-panel"

/**
 * #196: Hold / Resume from a joined desk, and a joined desk that says when what it shows may be
 * out of date (no word from the host, reconnecting, or the two clocks disagree).
 */
const labels = () => useJournalStore.getState().entries.filter((e) => e.kind === "timing").map((e) => e.label)
const base: LiveStateV1 = {
  v: 1, at: 0, church: "CAC", service: null, program: { onAir: false, reference: null, rehearsal: false }, sources: [],
  event: { mode: "own", currentId: "w" }, rundown: [{ id: "w", reference: "Welcome", plannedMinutes: 5 }], timing: null, stageMessage: "",
  scenes: [], outputs: [], notices: [], timer: { durationMs: 10 * 60_000, elapsedMs: 0, running: true }, hold: null, heartbeatMs: 2000,
}

let root: Root | null = null
async function renderDesk(live: LiveStateV1, extra: Partial<ReturnType<typeof useJoin.getState>> = {}) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useJoin.setState({ status: "connected", me: { name: "Timekeeper desk", role: "timekeeper" }, live, receivedAt: performance.now(), clockSkewMs: 0, error: null, paused: false, note: null, ...extra })
  const el = document.body.appendChild(document.createElement("div"))
  root = createRoot(el)
  await act(async () => root!.render(<OperatorsPanel />))
  return el
}
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent === text)
const sent = () => calls.filter((c) => c.cmd === "join_command").map((c) => c.args.command)

beforeEach(() => {
  calls.length = 0
  useJournalStore.setState({ entries: [] })
  useBroadcastStore.setState({ stageMessage: "", rehearsal: false })
  useSettingsStore.setState({ joinAddress: "192.168.1.20:8080", joinToken: "t" })
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
  useHold.getState().resume()
  vi.useRealTimers()
})

describe("Hold / Resume from a joined desk (the host)", () => {
  it("holds with the desk's reason and name, shows it in the Live State, and resumes as the desk", async () => {
    const el = document.createElement("div")
    const r = createRoot(el)
    function Host() {
      useRemoteControl()
      return null
    }
    await act(async () => r.render(<Host />))
    await vi.waitFor(() => expect(handlers.has("remote:hold")).toBe(true))
    expect(buildLiveState().hold).toBeNull()
    await act(async () => handlers.get("remote:hold")!({ payload: JSON.stringify({ reason: "Waiting for the pastor", by: "Timekeeper desk" }) }))
    expect(useHold.getState().hold).toMatchObject({ reason: "Waiting for the pastor", by: "Timekeeper desk" })
    expect(useBroadcastStore.getState().stageMessage).toBe("On hold: Waiting for the pastor")
    expect(buildLiveState().hold).toMatchObject({ reason: "Waiting for the pastor", by: "Timekeeper desk", since: expect.any(Number) })
    // A second hold while held changes nothing.
    await act(async () => handlers.get("remote:hold")!({ payload: JSON.stringify({ reason: "other", by: "Phone" }) }))
    expect(useHold.getState().hold?.reason).toBe("Waiting for the pastor")
    await act(async () => handlers.get("remote:resume")!({ payload: JSON.stringify({ by: "Femi's laptop" }) }))
    expect(useHold.getState().hold).toBeNull()
    expect(buildLiveState().hold).toBeNull()
    expect(labels()).toEqual(["Timekeeper desk: hold: Waiting for the pastor", expect.stringMatching(/^Femi's laptop: resumed after 0:0\d$/)])
    // No reason: "On hold", as on the main desk.
    await act(async () => handlers.get("remote:hold")!({ payload: JSON.stringify({ reason: "", by: "Timekeeper desk" }) }))
    expect(useHold.getState().hold?.reason).toBe("On hold")
    act(() => r.unmount())
  })
})

describe("Hold / Resume on the joined clock desk", () => {
  it("sends hold with the reason typed, then shows the host's hold with Resume", async () => {
    const el = await renderDesk(base)
    const input = el.querySelector<HTMLInputElement>('input[aria-label="Reason for the hold"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "  Waiting for the pastor ")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => button(el, "Hold")!.click())
    expect(sent()).toEqual([{ command: "hold", value: "Waiting for the pastor" }])
    await act(async () => button(el, "Hold")!.click())
    expect(sent()[1]).toEqual({ command: "hold" })
    await act(async () => useJoin.setState({ live: { ...base, hold: { reason: "Waiting for the pastor", since: Date.now(), by: "Timekeeper desk" } } }))
    expect(el.textContent).toContain("On hold since")
    expect(el.textContent).toContain("Waiting for the pastor · by Timekeeper desk")
    await act(async () => button(el, "Resume")!.click())
    expect(sent()[2]).toEqual({ command: "resume" })
    await act(async () => useJoin.setState({ paused: true }))
    expect(button(el, "Resume")!.disabled).toBe(true)
  })

  it("an older host that does not say about holds gets no Hold button", async () => {
    const old: LiveStateV1 = { ...base }
    delete old.hold
    const el = await renderDesk(old)
    expect(button(el, "Hold")).toBeUndefined()
    expect(el.querySelector('[aria-label="Event clock desk"]')).not.toBeNull()
  })
})

describe("a joined desk whose view may be out of date", () => {
  it("after 5 s with no word from the host: last update N s ago, the timer dimmed and marked", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date", "performance"] })
    const el = await renderDesk(base)
    expect(el.textContent).not.toContain("Last update")
    expect(el.textContent).not.toContain("may be out of date")
    await act(async () => vi.advanceTimersByTime(4000))
    expect(el.textContent).not.toContain("Last update")
    await act(async () => vi.advanceTimersByTime(3000))
    expect(el.textContent).toContain("Last update 7 s ago")
    expect(el.textContent).toContain("may be out of date")
    expect(el.querySelector('[role="timer"]')!.className).toContain("opacity-50")
    // The host is heard from again: all clear.
    await act(async () => useJoin.setState({ receivedAt: performance.now(), live: { ...base, at: Date.now() } }))
    expect(el.textContent).not.toContain("Last update")
    expect(el.textContent).not.toContain("may be out of date")
  })

  it("while reconnecting the clock is marked at once; an older host that sends only on a change is never called quiet", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date", "performance"] })
    const old: LiveStateV1 = { ...base }
    delete old.heartbeatMs
    const el = await renderDesk(old)
    await act(async () => vi.advanceTimersByTime(60_000))
    expect(el.textContent).not.toContain("may be out of date")
    await act(async () => useJoin.setState({ status: "reconnecting" }))
    expect(el.textContent).toContain("may be out of date")
    expect(el.textContent).toContain("Last update 60 s ago")
  })

  it("warns when this computer's clock and the host's differ by more than 2 s, from the freshest arrival", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date", "performance"] })
    vi.setSystemTime(new Date(2026, 9, 25, 10, 0, 0))
    useJoin.setState({ status: "off", me: null, live: null })
    await useJoin.getState().connect()
    const arrive = (at: number) => handlers.get("join:live")!({ payload: JSON.stringify({ ...base, at }) })
    // This computer is 3 s ahead; a snapshot that waited 2 s on the host does not make it 5.
    arrive(Date.now() - 5000)
    arrive(Date.now() - 3000)
    expect(useJoin.getState().clockSkewMs).toBe(3000)
    const el = await renderDesk(useJoin.getState().live!, { clockSkewMs: useJoin.getState().clockSkewMs })
    expect(el.textContent).toContain("This computer's clock is 3 s ahead of the host's")
    await act(async () => useJoin.setState({ clockSkewMs: 1500 }))
    expect(el.textContent).not.toContain("This computer's clock")
  })
})

describe("deskFreshness", () => {
  it("quiet only past 5 s from a host that beats; reconnecting is always stale; skew past 2 s either way", () => {
    const f = (o: Partial<Parameters<typeof deskFreshness>[0]>) => deskFreshness({ status: "connected", receivedAt: 1000, now: 1000, heartbeatMs: 2000, clockSkewMs: 0, ...o })
    expect(f({ now: 6000 })).toMatchObject({ stale: false, showSince: false, sinceMs: 5000 })
    expect(f({ now: 6001 })).toMatchObject({ stale: true, showSince: true })
    expect(f({ now: 60_000, heartbeatMs: undefined })).toMatchObject({ stale: false, showSince: false })
    expect(f({ status: "reconnecting", now: 2000 })).toMatchObject({ stale: true, showSince: false })
    expect([f({ clockSkewMs: 2000 }).skewMs, f({ clockSkewMs: -2500 }).skewMs, f({ clockSkewMs: null }).skewMs]).toEqual([null, -2500, null])
    expect([skewWords(3000), skewWords(-70_000), skewWords(120_000)]).toEqual(["3 s ahead of", "1 min 10 s behind", "2 min ahead of"])
  })
})
