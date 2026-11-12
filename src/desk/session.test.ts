// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The browser desk has no Tauri: anything that reached the installed app's IPC would be a bug.
const tauri = vi.hoisted(() => ({ invoke: vi.fn(async () => { throw new Error("no Tauri in a browser") }) }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn(), warning: vi.fn(), success: vi.fn() } }))

import { setJoinTransport, useJoin } from "@/stores/join-store"
import type { LiveStateV1 } from "@/lib/live-state"
import { applyLive, applyMe, begin, DESK_TRANSPORT, missedAnswer, readToken, refusalWords, resetDeskSession, startDesk, TOKEN_KEY, useDeskSession, writeToken } from "@/desk/session"

type Call = { url: string; init: RequestInit }
let calls: Call[] = []
let answer: (url: string, init: RequestInit) => Response | Promise<Response>
const json = (status: number, value: unknown) => new Response(status === 204 ? null : JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } })
const sent = (c: Call) => JSON.parse(String(c.init.body)) as Record<string, unknown>
const header = (c: Call, name: string) => new Headers(c.init.headers).get(name)

const live = (over: Partial<LiveStateV1> = {}) => ({
  v: 1, at: Date.now(), church: "Grace", service: { id: "svc-1", title: "Sunday" }, program: { onAir: true, reference: "John 3:16", rehearsal: false },
  sources: [], event: { currentId: null }, rundown: [], timing: null, stageMessage: "", scenes: [], outputs: [], notices: [], revisions: { queue: 3, "source:bible": 7 },
  heartbeatMs: 2000, ...over,
}) as unknown as LiveStateV1

beforeEach(() => {
  const kept = new Map<string, string>()
  vi.stubGlobal("localStorage", { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k), clear: () => kept.clear() })
  calls = []
  answer = () => json(500, {})
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    return answer(url, init)
  }))
  localStorage.clear()
  resetDeskSession()
  setJoinTransport(DESK_TRANSPORT)
  useJoin.setState({ status: "connected", live: live(), me: { name: "Media laptop", role: "bible" }, paused: false, error: null, note: null })
  writeToken("tok-1")
})

afterEach(() => {
  resetDeskSession()
  setJoinTransport(null)
  vi.unstubAllGlobals()
  expect(tauri.invoke).not.toHaveBeenCalled()
})

describe("the browser desk's commands", () => {
  it("go to the host's command route with this desk's key, what it saw and the service it is looking at", async () => {
    answer = () => json(200, { success: true, note: "Sent to the main desk" })
    const r = await useJoin.getState().send({ command: "verse_next" })
    expect(r).toEqual({ ok: true, note: "Sent to the main desk" })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe("/api/v1/command")
    expect(calls[0]!.init.method).toBe("POST")
    expect(header(calls[0]!, "Authorization")).toBe("Bearer tok-1")
    const body = sent(calls[0]!)
    expect(body).toMatchObject({ command: "verse_next", service: "svc-1", seen: { queue: 3, "source:bible": 7 } })
    expect(typeof body.id).toBe("string")
  })

  it("say paused, stale and another service as the installed desk does", async () => {
    expect(refusalWords(423, "Paused by the main desk", undefined)).toBe("paused: Paused by the main desk")
    expect(refusalWords(409, "changed", "stale")).toBe("stale: changed")
    expect(refusalWords(409, "other", "other-service")).toBe("other-service: other")
    expect(refusalWords(403, "Not allowed for this desk's role", undefined)).toBe("Not allowed for this desk's role")
    expect(refusalWords(429, undefined, undefined)).toMatch(/Too many/)

    answer = () => json(423, { error: "The main desk has taken back control" })
    expect(await useJoin.getState().send({ command: "verse_next" })).toEqual({ ok: false, error: "The main desk has taken back control" })
    expect(useJoin.getState().paused).toBe(true)

    useJoin.setState({ paused: false })
    answer = () => json(409, { error: "Someone changed the Bible first", code: "stale" })
    expect(await useJoin.getState().send({ command: "verse_next" })).toEqual({ ok: false, error: "Someone changed the Bible first", stale: true })

    answer = () => json(403, { error: "Not allowed for this desk's role" })
    expect(await useJoin.getState().send({ command: "next" })).toEqual({ ok: false, error: "Not allowed for this desk's role" })
  })

  it("ask again with the same id when the answer is lost, then say there was no answer", async () => {
    vi.useFakeTimers()
    try {
      answer = () => { throw new TypeError("network") }
      const pending = useJoin.getState().send({ command: "verse_next" })
      await vi.advanceTimersByTimeAsync(5_000)
      const r = await pending
      expect(r.ok).toBe(false)
      expect(calls).toHaveLength(3)
      expect(new Set(calls.map((c) => sent(c).id)).size).toBe(1)
      expect(!r.ok && r.error).toMatch(/No answer from the host/)
    } finally {
      vi.useRealTimers()
    }
  })

  it("unpair the desk when the host no longer knows its key", async () => {
    answer = () => json(401, {})
    const r = await useJoin.getState().send({ command: "verse_next" })
    expect(r.ok).toBe(false)
    expect(readToken()).toBeNull()
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(useDeskSession.getState().phase).toBe("pair")
    expect(useDeskSession.getState().reason).toMatch(/no longer paired/)
    expect(useJoin.getState()).toMatchObject({ status: "off", live: null, me: null })
  })

  it("look things up in the host's library through the same route as a joined desk", async () => {
    answer = (url) => url === "/api/v1/lookup" ? json(200, { translations: [{ id: 1, abbreviation: "KJV" }], active: 1 }) : json(500, {})
    expect(await DESK_TRANSPORT.lookup({ what: "translations" })).toEqual({ translations: [{ id: 1, abbreviation: "KJV" }], active: 1 })
    expect(sent(calls[0]!)).toEqual({ what: "translations" })
    answer = () => json(403, { error: "This desk's role does not search the Bible" })
    await expect(DESK_TRANSPORT.lookup({ what: "search", query: "love" })).rejects.toThrow("This desk's role does not search the Bible")
  })
})

describe("following the host", () => {
  it("is held after two missed answers, and live again with the next Live State", () => {
    applyLive(live())
    expect(useJoin.getState().status).toBe("connected")
    missedAnswer()
    expect(useJoin.getState().status).toBe("connected")
    missedAnswer()
    expect(useJoin.getState().status).toBe("reconnecting")
    applyLive(live())
    expect(useJoin.getState().status).toBe("connected")
    expect(useDeskSession.getState().lastHeard).toBeGreaterThan(0)
  })

  it("is paused when the host lists this desk, and takes the role and scopes the host gives it", () => {
    expect(applyMe({ name: "Media laptop", role: "screens", paused: false, outputScope: ["main", 3], groupTakeScope: ["main"] })).toBe(true)
    expect(useJoin.getState().me).toEqual({ name: "Media laptop", role: "screens" })
    applyMe({ name: "Media laptop", role: "screens", outputScope: ["main", "side"], groupTakeScope: ["main", "foyer"] })
    expect(useJoin.getState().me).toEqual({ name: "Media laptop", role: "screens", outputScope: ["main", "side"], groupTakeScope: ["main"] })
    applyLive(live({ paused: ["Media laptop"] }))
    expect(useJoin.getState().paused).toBe(true)
    expect(applyMe({ name: 3 })).toBe(false)
  })

  it("reads the Live State stream with its key, and asks who it is again when the host changes it", async () => {
    let meCalls = 0
    answer = (url) => {
      if (url === "/api/v1/me") {
        meCalls++
        return json(200, { name: "Media laptop", role: meCalls === 1 ? "bible" : "timekeeper", paused: false })
      }
      if (url === "/api/v1/live/events") {
        const text = meCalls === 1
          ? `event: live\ndata: ${JSON.stringify(live({ program: { onAir: true, reference: "Romans 8:28", rehearsal: false } }))}\n\nevent: rejoin\ndata: the host changed this desk\n\n`
          : `event: live\ndata: ${JSON.stringify(live({ program: { onAir: false, reference: null, rehearsal: false } }))}\n\n`
        const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); if (meCalls > 1) return; c.close() } })
        return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })
      }
      return json(500, {})
    }
    begin()
    await vi.waitFor(() => expect(useJoin.getState().me?.role).toBe("timekeeper"))
    await vi.waitFor(() => expect(useJoin.getState().live?.program.onAir).toBe(false))
    expect(useJoin.getState().status).toBe("connected")
    expect(useDeskSession.getState().following).toBe("stream")
    const stream = calls.find((c) => c.url === "/api/v1/live/events")!
    expect(header(stream, "Authorization")).toBe("Bearer tok-1")
    expect(calls.filter((c) => c.url === "/api/v1/live/events")).toHaveLength(2)
  })

  it("looks every 2 s when the stream cannot be kept open", async () => {
    answer = (url) => url === "/api/v1/me" ? json(200, { name: "Media laptop", role: "bible" })
      : url === "/api/v1/live" ? json(200, live({ program: { onAir: true, reference: "Psalm 23:1", rehearsal: false } }))
        : json(503, {})
    useJoin.setState({ live: null })
    begin()
    await vi.waitFor(() => expect(useJoin.getState().live?.program.reference).toBe("Psalm 23:1"))
    expect(useDeskSession.getState().following).toBe("poll")
    expect(header(calls.find((c) => c.url === "/api/v1/live")!, "Authorization")).toBe("Bearer tok-1")
  })

  it("goes back to pairing, saying why, when the host has removed this device", async () => {
    answer = (url) => url === "/api/v1/me" ? json(401, {}) : json(500, {})
    begin()
    await vi.waitFor(() => expect(useDeskSession.getState().phase).toBe("pair"))
    expect(useDeskSession.getState().reason).toMatch(/no longer paired/)
    expect(readToken()).toBeNull()
  })
})

describe("starting the desk", () => {
  it("sends a plain http page on the network to the host's secure desk", async () => {
    answer = (url) => url === "/api/v1/health" ? json(200, { status: "ok", service: "rhema", tls_port: 8081 }) : json(500, {})
    await startDesk({ protocol: "http:", hostname: "192.168.1.20", hash: "#code=123456" })
    expect(useDeskSession.getState()).toMatchObject({ phase: "insecure", secureUrl: "https://192.168.1.20:8081/desk#code=123456" })
    expect(calls.map((c) => c.url)).toEqual(["/api/v1/health"])
  })

  it("pairs first without a key, and warns on plain http when the host has no secure page", async () => {
    writeToken(null)
    answer = (url) => url === "/api/v1/health" ? json(200, { status: "ok", service: "rhema" }) : json(500, {})
    await startDesk({ protocol: "http:", hostname: "192.168.1.20", hash: "" })
    expect(useDeskSession.getState()).toMatchObject({ phase: "pair", plain: true })
  })

  it("follows the host straight away over https with a kept key", async () => {
    answer = (url) => url === "/api/v1/me" ? json(200, { name: "Media laptop", role: "viewer" }) : json(503, {})
    await startDesk({ protocol: "https:", hostname: "192.168.1.20", hash: "" })
    expect(useDeskSession.getState().phase).toBe("desk")
    expect(calls.some((c) => c.url === "/api/v1/health")).toBe(false)
    await vi.waitFor(() => expect(useJoin.getState().me?.role).toBe("viewer"))
  })
})
