// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The browser desk has no Tauri: any block that reached the installed app's IPC would be a bug.
const tauri = vi.hoisted(() => ({ invoke: vi.fn(async () => { throw new Error("no Tauri in a browser") }) }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn(), success: vi.fn() } }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { LiveStateV1 } from "@/lib/live-state"
import { setJoinTransport, useJoin } from "@/stores/join-store"
import { DeskApp } from "@/desk/desk-app"
import { DESK_TRANSPORT, readToken, resetDeskSession, useDeskSession, writeToken } from "@/desk/session"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Call = { url: string; init: RequestInit }
let calls: Call[] = []
let answer: (url: string, init: RequestInit) => Response
const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } })
let root: Root | null = null
let host: HTMLDivElement

const live = (over: Partial<LiveStateV1> = {}) => ({
  v: 1, at: Date.now(), church: "Grace Chapel", service: { id: "svc-1", title: "Sunday service" }, program: { onAir: true, reference: "John 3:16", rehearsal: false },
  sources: [{ id: "bible", reference: "John 3:16", on: true, revision: 2 }],
  event: { currentId: "e1", mode: "own" }, rundown: [{ id: "e1", reference: "Welcome", plannedMinutes: 5 }, { id: "e2", reference: "Sermon", plannedMinutes: 30 }],
  timing: null, stageMessage: "", scenes: [], outputs: [], notices: [], revisions: { event: 1 }, heartbeatMs: 2000,
  timer: { durationMs: 300_000, elapsedMs: 0, running: false },
  ...over,
}) as unknown as LiveStateV1

async function render(): Promise<void> {
  await act(async () => {
    root = createRoot(host)
    root.render(<DeskApp />)
  })
}

const text = () => host.textContent ?? ""
const button = (name: string | RegExp) => [...host.querySelectorAll("button")].find((b) => typeof name === "string" ? b.textContent === name : name.test(b.textContent ?? ""))

/** A desk for this role, as the host has said who it is and sent its Live State. */
function deskAs(role: string, over: Partial<LiveStateV1> = {}, status: "connected" | "reconnecting" = "connected") {
  useDeskSession.setState({ phase: "desk", lastHeard: Date.now() })
  useJoin.setState({ status, me: { name: "Media laptop", role }, live: live(over), receivedAt: performance.now(), paused: false, error: null, note: null, secure: true, clockSkewMs: null })
}

beforeEach(() => {
  const kept = new Map<string, string>()
  vi.stubGlobal("localStorage", { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k), clear: () => kept.clear() })
  calls = []
  answer = (url) => url === "/api/v1/lookup" ? json(200, { active: 1, translations: [{ id: 1, abbreviation: "KJV", name: "King James", language: "en" }], songs: [] }) : json(200, { success: true })
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    return answer(url, init)
  }))
  resetDeskSession()
  setJoinTransport(DESK_TRANSPORT)
  writeToken("tok-1")
  host = document.createElement("div")
  document.body.append(host)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host.remove()
  resetDeskSession()
  setJoinTransport(null)
  useJoin.setState({ status: "off", me: null, live: null, paused: false })
  vi.unstubAllGlobals()
  expect(tauri.invoke).not.toHaveBeenCalled()
})

describe("the browser desk", () => {
  it("pairs with the code from the main computer, then follows it as this desk", async () => {
    writeToken(null)
    useDeskSession.setState({ phase: "pair", reason: "This device is no longer paired with the main computer" })
    answer = (url) => url === "/api/v1/pair" ? json(200, { success: true, token: "fresh", name: "Media laptop" }) : url === "/api/v1/me" ? json(200, { name: "Media laptop", role: "bible" }) : json(503, {})
    await render()
    expect(text()).toContain("Pair this device")
    expect(text()).toContain("no longer paired")
    const [code, name] = [...host.querySelectorAll("input")]
    await act(async () => {
      for (const [input, value] of [[code!, "123456"], [name!, "Media laptop"]] as const) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
        input.dispatchEvent(new Event("input", { bubbles: true }))
      }
    })
    await act(async () => host.querySelector("form")!.requestSubmit())
    await vi.waitFor(() => expect(useDeskSession.getState().phase).toBe("desk"))
    const pair = calls.find((c) => c.url === "/api/v1/pair")!
    expect(JSON.parse(String(pair.init.body))).toEqual({ code: "123456", name: "Media laptop" })
    expect(readToken()).toBe("fresh")
  })

  it("gives the Bible role its own page, and its commands go to the main computer with its key", async () => {
    deskAs("bible")
    await render()
    expect(host.querySelector('[data-desk-page="bible"]')).not.toBeNull()
    expect(text()).toContain("Bible operator")
    expect(host.querySelector('[aria-label="Bible desk"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="Run of show (read only)"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="Notices desk"]')).not.toBeNull()
    // Nothing of another role's desk.
    expect(host.querySelector('[aria-label="Event clock desk"]')).toBeNull()
    expect(host.querySelector(`[aria-label="Director's board"]`)).toBeNull()
    await vi.waitFor(() => expect(calls.some((c) => c.url === "/api/v1/lookup")).toBe(true))
    await act(async () => button("Next verse")!.click())
    const sent = calls.find((c) => c.url === "/api/v1/command")!
    expect(new Headers(sent.init.headers).get("Authorization")).toBe("Bearer tok-1")
    expect(JSON.parse(String(sent.init.body))).toMatchObject({ command: "verse_next", service: "svc-1", seen: { event: 1 } })
  })

  it("gives the Timekeeper the main computer's clock, and holds its controls while it is not updating", async () => {
    deskAs("timekeeper", {}, "reconnecting")
    await render()
    expect(text()).toContain("Timekeeper")
    expect(host.querySelector('[aria-label="Event clock desk"]')).not.toBeNull()
    expect(text()).toContain("Not updating")
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/controls wait until the main computer answers/)
    expect(button("Start Sermon")?.disabled).toBe(true)
    expect(button("Start")?.disabled).toBe(true)
    await act(async () => useJoin.setState({ status: "connected", receivedAt: performance.now() }))
    expect(button("Start Sermon")?.disabled).toBe(false)
    await act(async () => button("Start Sermon")!.click())
    expect(JSON.parse(String(calls.find((c) => c.url === "/api/v1/command")!.init.body))).toMatchObject({ command: "event_next" })
  })

  it("holds the controls while the main computer has taken back control", async () => {
    deskAs("timekeeper")
    useJoin.setState({ paused: true })
    await render()
    expect(text()).toContain("Paused by the main computer")
    expect(button("Start Sermon")?.disabled).toBe(true)
  })

  it("gives View only the service clock and running order, without production state", async () => {
    deskAs("viewer", { program: { onAir: true, reference: "Private pastor note", rehearsal: false } })
    await render()
    expect(text()).toContain("View only · production controls are not available")
    expect(host.querySelector('[aria-label="Now and next"]')).not.toBeNull()
    expect(text()).not.toContain("Private pastor note")
    expect(host.querySelector('[aria-label="On the screens"]')).toBeNull()
    expect(host.querySelector('[aria-label="Bible desk"]')).toBeNull()
  })

  it("gives the Stage and Worship roles their desks", async () => {
    deskAs("stage")
    await render()
    expect(text()).toContain("Stage operator")
    expect(host.querySelector('[aria-label="Stage desk"]')).not.toBeNull()
    await act(async () => root?.unmount())
    deskAs("worship")
    await render()
    expect(text()).toContain("Worship operator")
    expect(host.querySelector('[aria-label="Worship desk"]')).not.toBeNull()
  })

  it("gives Present and Configure the director's board and every desk they may use", async () => {
    for (const role of ["present", "configure"]) {
      deskAs(role)
      await render()
      expect(text()).toContain(role === "present" ? "Main presenter" : "Configure")
      for (const label of ["Director's board", "On the screens", "Bible desk", "Worship desk", "Stage desk", "Event clock desk", "Scenes desk"]) {
        expect(host.querySelector(`[aria-label="${label}"]`), `${role}: ${label}`).not.toBeNull()
      }
      await act(async () => root?.unmount())
      root = null
    }
  })

  it("sends a plain http page to the secure desk instead of pairing there", async () => {
    useDeskSession.setState({ phase: "insecure", secureUrl: "https://192.168.1.20:8081/desk" })
    await render()
    expect(text()).toContain("Open the secure desk")
    expect(host.querySelector("a")?.getAttribute("href")).toBe("https://192.168.1.20:8081/desk")
    expect(host.querySelector("form")).toBeNull()
  })
})
