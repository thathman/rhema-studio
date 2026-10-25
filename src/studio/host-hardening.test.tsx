// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

const FP = "3f2a9c11" + "0".repeat(56)
const calls: { cmd: string; args: Record<string, unknown> }[] = []
let hostStatus: unknown = null
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push({ cmd, args })
    if (cmd === "host_status") return hostStatus
    if (cmd === "join_pair") return { token: "tok-1", secure: { port: 8081, fingerprint: FP } }
    if (cmd === "join_me") return { name: "Ade", role: "editor" }
    return null
  }),
}))
const handlers = new Map<string, (e: { payload: string }) => void>()
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async (n: string, h: (e: { payload: string }) => void) => { handlers.set(n, h); return () => {} }) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { presenceRows, readHostStatus, seenWords } from "@/lib/host-presence"
import { REMOTE_ROLES, editsScenes, roleLabel } from "@/lib/remote-roles"
import { useJoin } from "@/stores/join-store"
import { useSettingsStore } from "@/stores/settings-store"
import { OperatorsPanel } from "@/studio/production/operators-panel"
import type { LiveStateV1 } from "@/lib/live-state"

const live: LiveStateV1 = {
  v: 1, at: 0, church: "CAC", service: null, program: { onAir: false, reference: null, rehearsal: false }, sources: [],
  event: { mode: "own", currentId: null }, rundown: [], timing: null, stageMessage: "",
  scenes: [{ id: "split", name: "Sermon split" }], outputs: [{ id: "main", name: "Projector", sceneId: null }], notices: [],
}

const render = async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const el = document.createElement("div")
  await act(async () => createRoot(el).render(<OperatorsPanel />))
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  return el
}

beforeEach(() => {
  calls.length = 0
  hostStatus = null
  useJoin.setState({ status: "off", me: null, live: null, error: null, paused: false, note: null, secure: null })
})

describe("the host card's words", () => {
  it("says who is connected now and when the others were last seen", () => {
    const at = (ms: number) => `t${ms}`
    expect(seenWords({ connected: true, lastSeenMs: 0 }, 10_000, at)).toBe("Connected now")
    expect(seenWords({ connected: false, lastSeenMs: 9_000 }, 10_000, at)).toBe("Seen just now")
    expect(seenWords({ connected: false, lastSeenMs: 0 }, 5 * 60_000, at)).toBe("Seen 5 min ago")
    expect(seenWords({ connected: false, lastSeenMs: 1 }, 3 * 3600_000, at)).toBe("Seen at t1")
    expect(seenWords(undefined, 0, at)).toBe("Not connected")
  })
  it("reads only a well-formed status and lists paired devices first, then the shared key", () => {
    expect(readHostStatus(null)).toBeNull()
    expect(readHostStatus({ running: "yes" })).toBeNull()
    const s = readHostStatus({ running: true, lan: true, port: 8080, tlsPort: 0, addresses: ["192.168.1.20:8080", 3], desks: [{ hash: "k", name: "Shared key", address: "10.0.0.2", connected: true, lastSeenMs: 1 }, { bad: 1 }] })!
    expect(s.tlsPort).toBeNull()
    expect(s.addresses).toEqual(["192.168.1.20:8080"])
    const rows = presenceRows([{ hash: "a" }, { hash: "b" }], [...s.desks, { hash: "b", name: "Femi", address: "10.0.0.3", connected: false, lastSeenMs: 2 }])
    expect(rows.map((r) => [r.hash, r.device !== null, r.seen?.address ?? null])).toEqual([["a", true, null], ["b", true, "10.0.0.3"], ["k", false, "10.0.0.2"]])
  })
})

describe("Production → Operators while hosting", () => {
  it("shows this computer's addresses, the secure link, who is connected, and stops hosting after a confirm", async () => {
    useSettingsStore.setState({ remoteDevices: [{ hash: "h1", name: "Femi's laptop", paired_at: "2026-10-24T09:00:00Z", role: "timekeeper" }, { hash: "h2", name: "Ade's phone", paired_at: "2026-10-24T09:00:00Z", role: "viewer" }] })
    hostStatus = { running: true, lan: true, port: 8080, tlsPort: 8081, caFingerprint: FP, addresses: ["192.168.1.20:8080", "10.0.0.5:8080"], desks: [{ hash: "h1", name: "Femi's laptop", address: "192.168.1.31", connected: true, lastSeenMs: Date.now() }] }
    const el = await render()
    expect(el.textContent).toContain("192.168.1.20:8080")
    expect(el.textContent).toContain("10.0.0.5:8080")
    expect(el.textContent).toContain("Secure link on port 8081")
    expect(el.textContent).toContain("3F2A 9C11 0000 0000 0000")
    const rows = [...el.querySelectorAll('[aria-label="Paired operators"] li')].map((li) => li.textContent)
    expect(rows[0]).toContain("Connected now")
    expect(rows[0]).toContain("192.168.1.31")
    expect(rows[1]).toContain("Not connected")
    expect(rows[1]).toContain("View only")
    const stop = () => [...el.querySelectorAll("button")].filter((b) => b.textContent === "Stop hosting")
    await act(async () => stop()[0].click())
    expect(calls.some((c) => c.cmd === "stop_http")).toBe(false)
    expect(el.textContent).toContain("Every joined computer and phone is disconnected")
    useSettingsStore.getState().setRemoteListeners({ http: true })
    await act(async () => stop().at(-1)!.click())
    expect(calls.some((c) => c.cmd === "stop_http")).toBe(true)
    expect(useSettingsStore.getState().remoteListeners.http).toBe(false)
  })

  it("warns when the host has no secure link", async () => {
    hostStatus = { running: true, lan: true, port: 8080, tlsPort: null, caFingerprint: null, addresses: ["192.168.1.20:8080"], desks: [] }
    const el = await render()
    expect(el.textContent).toContain("No secure link")
  })
})

describe("a joined desk over https, and the new roles", () => {
  it("pairing keeps the host's certificate and says it again before connecting", async () => {
    await useJoin.getState().pair("192.168.1.20:8080", "123456", "Ade")
    expect(useSettingsStore.getState().joinSecure).toEqual({ port: 8081, fingerprint: FP })
    expect(calls.map((c) => c.cmd)).toEqual(["join_pair", "join_secure", "join_me", "join_connect"])
    expect(calls[1].args).toEqual({ address: "192.168.1.20:8080", secure: { port: 8081, fingerprint: FP } })
    // The host changed this desk while it was away: the new role arrives with the connection.
    handlers.get("join:state")!({ payload: JSON.stringify({ state: "connected", secure: true, me: { name: "Ade", role: "viewer", paused: true } }) })
    expect(useJoin.getState()).toMatchObject({ status: "connected", secure: true, me: { name: "Ade", role: "viewer" }, paused: true })
    await useJoin.getState().leave(true)
    expect(useSettingsStore.getState().joinSecure).toBeNull()
  })

  it("an unencrypted host is warned about; an encrypted one shows its certificate", async () => {
    useSettingsStore.setState({ joinAddress: "h:1", joinSecure: { port: 2, fingerprint: FP } })
    useJoin.setState({ status: "connected", me: { name: "Op", role: "viewer" }, live, secure: false })
    const el = await render()
    expect(el.textContent).toContain("Not encrypted.")
    await act(async () => useJoin.setState({ secure: true }))
    expect(el.textContent).not.toContain("Not encrypted.")
    expect(el.textContent).toContain("Encrypted · certificate 3F2A 9C11 0000 0000 0000")
  })

  it("an editor prepares and never takes a scene; view only gets no controls", async () => {
    expect(REMOTE_ROLES.map((r) => r.id)).toEqual(expect.arrayContaining(["editor", "viewer"]))
    expect([roleLabel("editor"), roleLabel("viewer")]).toEqual(["Editor", "View only"])
    expect(REMOTE_ROLES.find((r) => r.id === "viewer")!.may).toContain("Changes nothing")
    expect([editsScenes("editor"), editsScenes("viewer")]).toEqual([true, false])
    useJoin.setState({ status: "connected", me: { name: "Op", role: "editor" }, live, secure: true })
    const ed = await render()
    expect(ed.querySelector('[aria-label="Prepare desk"]')).not.toBeNull()
    expect(ed.querySelector('[aria-label="Scenes desk"]')).not.toBeNull()
    expect(ed.textContent).not.toContain("Take Sermon split")
    const input = ed.querySelector<HTMLInputElement>('[aria-label="Bible reference to preview"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Romans 8:28")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => input.form!.requestSubmit())
    expect(calls.find((c) => c.cmd === "join_command")?.args.command).toMatchObject({ command: "bible_preview", value: "Romans 8:28" })
    useJoin.setState({ me: { name: "Op", role: "viewer" } })
    const v = await render()
    for (const desk of ["Prepare desk", "Scenes desk", "Bible desk", "Event clock desk"]) expect(v.querySelector(`[aria-label="${desk}"]`)).toBeNull()
    expect(v.querySelector('[aria-label="Talk desk"]')).not.toBeNull()
  })
})
