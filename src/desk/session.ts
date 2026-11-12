import { create } from "zustand"
import type { LiveStateV1 } from "@/lib/live-state"
import { STALE_AFTER_MS } from "@/lib/desk-freshness"
import { setJoinTransport, useJoin, type JoinTransport } from "@/stores/join-store"
import { SseParser } from "@/desk/sse"

/**
 * The browser operator desk's connection to the host it was served from (#845 G1). It pairs with
 * the same code as the phone remote, keeps the key in this browser, follows the host's Live State
 * (the `/api/v1/live/events` stream, or a look every 2 s when a stream cannot be kept open) and
 * fills the same `useJoin` state a joined Rhema Studio's desk reads, so the desktop blocks render
 * here unchanged. The host stays the only authority: every read is filtered for this key's role and
 * every command is checked again there. Nothing here changes Program or Preview by itself.
 */

/** Shared with the phone remote on the same address: one pairing per device, listed once on the host. */
export const TOKEN_KEY = "rhema-remote-token"

export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function writeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // A browser that keeps nothing (private mode): the desk works until the page closes.
  }
}

/** "checking": finding out how to reach the host; "insecure": plain http while the host runs https. */
export type DeskPhase = "checking" | "insecure" | "pair" | "desk"

interface DeskSession {
  phase: DeskPhase
  /** Why the pairing screen shows (removed on the host, pairing off…), in plain words. */
  reason: string | null
  /** The host's secure desk address, when this page was opened over plain http. */
  secureUrl: string | null
  /** This page is plain http and the host has no secure page: the key crosses the network in the clear. */
  plain: boolean
  /** How the desk follows the host now. */
  following: "stream" | "poll" | null
  /** When the host last answered (wall clock, for "since 10:42:13"); 0 before it has. */
  lastHeard: number
}

export const useDeskSession = create<DeskSession>(() => ({ phase: "checking", reason: null, secureUrl: null, plain: false, following: null, lastHeard: 0 }))

/** A refusal or failure, in words; `String(e)` is the message, as `join_command`'s errors are. */
export class HostRefusal extends Error {
  override toString(): string {
    return this.message
  }
}

const UNPAIRED = "This device is no longer paired with the host: it was removed there, or the host forgot it. Pair it again with a new code."
const NO_ANSWER = "No answer from the host. Check the screens before pressing again."

const auth = (): Record<string, string> => {
  const token = readToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** A LAN request to a computer that went away can hang instead of failing: give up after `ms`. */
async function timed(url: string, init: RequestInit, ms: number): Promise<Response> {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), ms)
  try {
    return await fetch(url, { cache: "no-store", ...init, signal: c.signal })
  } finally {
    clearTimeout(t)
  }
}

const body = async (r: Response): Promise<Record<string, unknown>> => {
  const v: unknown = await r.json().catch(() => null)
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}
}

/** The words for a refused command, as the installed app's `join_command` gives them (src-tauri/src/commands/join.rs `refusal`). */
export function refusalWords(status: number, error: unknown, code: unknown): string {
  const msg = typeof error === "string" && error ? error : status === 429 ? "Too many presses: wait a second and try again." : `The host refused (${status})`
  if (status === 423) return `paused: ${msg}`
  if (status === 409) return code === "stale" ? `stale: ${msg}` : `other-service: ${msg}`
  return msg
}

/** One id per press: a retry after a lost answer carries the same id and the host does it once. */
export function pressId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  } catch {
    // Not a secure page: below.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

const validId = (id: unknown): id is string => typeof id === "string" && id.trim() === id && id.length > 0 && id.length <= 128

/** Calls one host route with this desk's key; 401 unpairs the desk. A network failure is a refusal in words. */
async function call(path: string, init: RequestInit, ms: number, retries = 0): Promise<{ r: Response; j: Record<string, unknown> }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await timed(path, { ...init, headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...auth() } }, ms)
      if (r.status === 401) {
        unpair(UNPAIRED)
        throw new HostRefusal(UNPAIRED)
      }
      return { r, j: r.status === 204 ? {} : await body(r) }
    } catch (e) {
      if (e instanceof HostRefusal) throw e
      if (attempt < retries) await new Promise((done) => setTimeout(done, 700))
    }
  }
  throw new HostRefusal(NO_ANSWER)
}

/** The browser desk's way to the host: the same routes the installed app's Rust calls, from this page's origin. */
export const DESK_TRANSPORT: JoinTransport = {
  command: async (command, service) => {
    const sent = { ...command, ...(validId(command.id) ? {} : { id: pressId() }), ...(service !== undefined ? { service } : {}) }
    // Retried with the same id when the answer is lost on Wi-Fi: the host does it once.
    const { r, j } = await call("/api/v1/command", { method: "POST", body: JSON.stringify(sent) }, 10_000, 2)
    if (r.ok) return j
    throw new HostRefusal(refusalWords(r.status, j.error, j.code))
  },
  lookup: async (asked) => {
    const { r, j } = await call("/api/v1/lookup", { method: "POST", body: JSON.stringify(asked) }, 8_000)
    if (r.ok) return j
    throw new HostRefusal(typeof j.error === "string" ? j.error : `The host answered ${r.status}`)
  },
  receivers: async () => {
    const { r, j } = await call("/api/v1/receivers", {}, 6_000)
    if (r.status === 204) return { outputs: [] }
    if (r.ok) return j
    throw new HostRefusal(`The host could not report receiver status (${r.status})`)
  },
  requests: async () => {
    const { r, j } = await call("/api/v1/requests", {}, 8_000)
    if (r.ok) return j
    throw new HostRefusal(typeof j.error === "string" ? j.error : `The host answered ${r.status}`)
  },
  withdrawRequest: async (id) => {
    const { r, j } = await call(`/api/v1/requests/${encodeURIComponent(id)}/withdraw`, { method: "POST", body: "{}" }, 8_000)
    if (r.ok) return j
    throw new HostRefusal(typeof j.error === "string" ? j.error : `The host answered ${r.status}`)
  },
}

// --- Following the host ---

/** Bumped by every start and every stop, so a loop overtaken by either ends. */
let run = 0
let stream: AbortController | null = null
/** The last few arrivals' (this browser's wall time − the host's "at"), for the clock warning. */
let gaps: number[] = []
let meAt = 0
/** Answers missed in a row: two, and the desk says it is not updating and holds its controls. */
let missed = 0

/** How long the stream may stay silent (the host sends every 2 s and a comment every 15 s) before it counts as lost. */
export const STREAM_QUIET_MS = 6_000
const POLL_MS = 2_000
const ME_EVERY_MS = 10_000

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

function resetJoin(): void {
  gaps = []
  useJoin.setState({ status: "off", live: null, me: null, error: null, paused: false, note: null, receivedAt: 0, clockSkewMs: null, secure: null })
}

/** A Live State from the host, into the desk's state (as the installed app's `join:live` listener does). */
export function applyLive(live: LiveStateV1 | null): void {
  missed = 0
  useDeskSession.setState({ lastHeard: Date.now() })
  const was = useJoin.getState()
  if (!live) {
    // 204: the host has not published a service yet. Connected, nothing to show.
    useJoin.setState({ status: "connected", receivedAt: performance.now() })
    return
  }
  if (live.v !== 1) return
  const name = was.me?.name
  // The host lists the desks it has taken back control from.
  const paused = Array.isArray(live.paused) && name ? live.paused.includes(name) : was.paused
  if (typeof live.at === "number") gaps = [...gaps, Date.now() - live.at].slice(-5)
  // A command's refusal stays until the next command; a lost connection's reason goes now.
  const error = was.status === "connected" ? was.error : null
  useJoin.setState({ live, receivedAt: performance.now(), clockSkewMs: gaps.length ? Math.min(...gaps) : null, status: "connected", error, paused })
}

/** An answer did not come: after two, the desk is not updating and its controls wait. */
export function missedAnswer(): void {
  missed++
  if (missed >= 2 && useJoin.getState().status === "connected") useJoin.setState({ status: "reconnecting" })
}

type Me = { name?: unknown; role?: unknown; paused?: unknown; outputScope?: unknown; groupTakeScope?: unknown }

/** Who the host says this desk is now; the main desk may change its role or take back control mid-service. */
export function applyMe(me: Me): boolean {
  if (typeof me.name !== "string" || typeof me.role !== "string") return false
  const strings = (v: unknown): string[] | undefined => Array.isArray(v) && v.every((id) => typeof id === "string") ? v : undefined
  const outputScope = strings(me.outputScope)
  const groupTakeScope = outputScope ? strings(me.groupTakeScope)?.filter((id) => outputScope.includes(id)) : undefined
  useJoin.setState({
    me: { name: me.name, role: me.role, ...(outputScope ? { outputScope } : {}), ...(groupTakeScope ? { groupTakeScope } : {}) },
    paused: me.paused === true,
  })
  meAt = Date.now()
  return true
}

/** Ask the host who this desk is. False when the desk must stop (unpaired, or refused). */
async function refreshMe(mine: number): Promise<"ok" | "missed" | "stop"> {
  try {
    const r = await timed("/api/v1/me", { headers: auth() }, 4_000)
    if (mine !== run) return "stop"
    if (r.status === 401) {
      unpair(UNPAIRED)
      return "stop"
    }
    if (r.status === 403) {
      unpair("The host is not asking devices to pair (Remote control is open on the host), so it does not share the service with a browser. Ask the main desk to turn on pairing.")
      return "stop"
    }
    if (!r.ok || !applyMe(await body(r))) return "missed"
    return "ok"
  } catch {
    return mine === run ? "missed" : "stop"
  }
}

/** One look at the Live State. */
async function pollOnce(mine: number): Promise<"ok" | "missed" | "stop"> {
  if (Date.now() - meAt > ME_EVERY_MS || !useJoin.getState().me) {
    const me = await refreshMe(mine)
    if (me === "stop") return "stop"
    if (me === "missed" && !useJoin.getState().me) {
      missedAnswer()
      return "missed"
    }
  }
  try {
    const r = await timed("/api/v1/live", { headers: auth() }, 4_000)
    if (mine !== run) return "stop"
    if (r.status === 401) {
      unpair(UNPAIRED)
      return "stop"
    }
    if (!r.ok) throw new Error(`live ${r.status}`)
    applyLive(r.status === 204 ? null : await r.json() as LiveStateV1)
    return "ok"
  } catch {
    if (mine !== run) return "stop"
    missedAnswer()
    return "missed"
  }
}

/** Follow the stream until it ends: "rejoin" when the host changed this desk, "failed" when the stream was lost. */
async function streamOnce(mine: number): Promise<"rejoin" | "failed" | "stop"> {
  const c = new AbortController()
  stream = c
  let heard = performance.now()
  const watchdog = setInterval(() => {
    if (performance.now() - heard > STREAM_QUIET_MS) c.abort()
  }, 1_000)
  try {
    const r = await fetch("/api/v1/live/events", { cache: "no-store", headers: { Accept: "text/event-stream", ...auth() }, signal: c.signal })
    if (mine !== run) return "stop"
    if (r.status === 401) {
      unpair(UNPAIRED)
      return "stop"
    }
    if (!r.ok || !r.body) return "failed"
    useDeskSession.setState({ following: "stream" })
    const reader = r.body.getReader()
    const text = new TextDecoder()
    const parser = new SseParser()
    for (;;) {
      const { done, value } = await reader.read()
      if (mine !== run) return "stop"
      if (done) return "failed"
      heard = performance.now()
      for (const e of parser.push(text.decode(value, { stream: true }))) {
        if (e.event === "rejoin") return "rejoin"
        if (e.event !== "live") continue
        try {
          applyLive(JSON.parse(e.data) as LiveStateV1)
        } catch {
          // A snapshot this build cannot read: keep the last one.
        }
      }
    }
  } catch {
    return mine === run ? "failed" : "stop"
  } finally {
    clearInterval(watchdog)
    c.abort()
    if (stream === c) stream = null
  }
}

const streams = () => typeof ReadableStream !== "undefined" && typeof TextDecoder !== "undefined"

async function follow(mine: number): Promise<void> {
  let wait = 0
  while (mine === run) {
    const me = await refreshMe(mine)
    if (me === "stop") return
    if (me === "ok" && streams()) {
      const outcome = await streamOnce(mine)
      if (outcome === "stop") return
      if (outcome === "rejoin") {
        // The host changed this desk (role, control): ask who it is now and follow again.
        wait = 0
        continue
      }
      missedAnswer()
      wait = Math.min(30_000, wait ? wait * 2 : 4_000)
    } else if (me === "missed") {
      missedAnswer()
      wait = Math.max(wait, 4_000)
    }
    // Look every 2 s until it is time to try the stream again.
    useDeskSession.setState({ following: "poll" })
    const until = Date.now() + wait
    do {
      if ((await pollOnce(mine)) === "stop") return
      await sleep(POLL_MS)
    } while (mine === run && Date.now() < until)
  }
}

/** The desk's view went quiet (a host that sends every 2 s has not for 5 s): it says so and holds its controls. */
let quietTimer: ReturnType<typeof setInterval> | null = null
function watchQuiet(): void {
  if (quietTimer) return
  quietTimer = setInterval(() => {
    const j = useJoin.getState()
    if (j.status === "connected" && j.live?.heartbeatMs !== undefined && performance.now() - j.receivedAt > STALE_AFTER_MS) useJoin.setState({ status: "reconnecting" })
  }, 1_000)
}

function stop(): void {
  run++
  stream?.abort()
  stream = null
  missed = 0
  useDeskSession.setState({ following: null })
}

/** Begin following the host with the kept key. */
export function begin(): void {
  stop()
  const mine = run
  resetJoin()
  // This computer itself (loopback) never crosses the network: neither encrypted nor a warning.
  useJoin.setState({ status: "connecting", secure: location.protocol === "https:" ? true : LOOPBACK.has(location.hostname) ? null : false })
  useDeskSession.setState({ phase: "desk", reason: null })
  watchQuiet()
  void follow(mine)
}

/** Forget the key here and go back to pairing, saying why. */
export function unpair(reason: string | null): void {
  stop()
  writeToken(null)
  resetJoin()
  useDeskSession.setState({ phase: "pair", reason, lastHeard: 0 })
}

/** Pair with the code from the host's pairing window. Null when paired, else the host's reason. */
export async function pairDesk(code: string, name: string): Promise<string | null> {
  try {
    const r = await timed("/api/v1/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code.trim(), name: name.trim() || "Browser desk" }) }, 8_000)
    const j = await body(r)
    if (r.ok && typeof j.token === "string" && j.token) {
      writeToken(j.token)
      begin()
      return null
    }
    return typeof j.error === "string" && j.error ? j.error : `Pairing failed (${r.status})`
  } catch {
    return "Cannot reach the host. Is this device on the church network?"
  }
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])

/**
 * Start the desk: the browser desk uses only this desk's transport (never the installed app's), a
 * plain http page goes to the host's secure page when there is one, and a kept key starts following.
 */
export async function startDesk(where: Pick<Location, "protocol" | "hostname" | "hash"> = location): Promise<void> {
  setJoinTransport(DESK_TRANSPORT)
  // A joined desk's "Leave" and a refresh after the host moved to another service.
  useJoin.setState({
    connect: async () => begin(),
    leave: async (forget = false) => {
      if (forget) unpair("Unpaired on this device. Remove it on the host too, in Permissions.")
      else {
        stop()
        resetJoin()
      }
    },
  })
  if (where.protocol === "http:" && !LOOPBACK.has(where.hostname)) {
    try {
      const r = await timed("/api/v1/health", {}, 4_000)
      const j = await body(r)
      const port = j.tls_port
      if (typeof port === "number" && Number.isInteger(port) && port > 0 && port < 65536) {
        const host = where.hostname.includes(":") && !where.hostname.startsWith("[") ? `[${where.hostname}]` : where.hostname
        useDeskSession.setState({ phase: "insecure", secureUrl: `https://${host}:${port}/desk${where.hash}` })
        return
      }
    } catch {
      // No answer: carry on; pairing says if the host cannot be reached.
    }
    useDeskSession.setState({ plain: true })
  }
  if (readToken()) begin()
  else useDeskSession.setState({ phase: "pair" })
}

/** For tests: stop following and forget this module's counters. */
export function resetDeskSession(): void {
  stop()
  if (quietTimer) clearInterval(quietTimer)
  quietTimer = null
  gaps = []
  meAt = 0
  useDeskSession.setState({ phase: "checking", reason: null, secureUrl: null, plain: false, following: null, lastHeard: 0 })
}
