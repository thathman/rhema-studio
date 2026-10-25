// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sent: Record<string, unknown>[] = []
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, a: { command?: Record<string, unknown> } = {}) => {
    if (cmd === "join_lookup") return null
    if (cmd !== "join_command") return null
    sent.push(a.command ?? {})
    return null
  }),
}))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { useJoin } from "@/stores/join-store"
import { OperatorsPanel } from "@/studio/production/operators-panel"
import type { LiveStateV1 } from "@/lib/live-state"

/** The desk consoles' second round (#197) and Queue from a joined desk (#251). */
const live: LiveStateV1 = {
  v: 1, at: 0, church: "CAC", service: null, program: { onAir: true, reference: null, rehearsal: false },
  sources: [{ id: "ticker", reference: "Welcome to CAC", on: true, revision: 2, by: "Main desk", activatedAt: 0 }, { id: "lowerThird", reference: "Pastor Ade", on: false, revision: 1 }],
  event: { mode: "own", currentId: null }, rundown: [], timing: null, stageMessage: "", scenes: [], outputs: [], notices: [],
  revisions: { lyrics: 7, queue: 3, "obs:record": 4, "obs:transition": 5, "source:ticker": 2 },
  lyrics: { itemId: "i1", index: 2, title: "Amazing Grace", kind: "hymn", section: 2, sections: ["Verse 1", "Chorus", "Verse 2", "Chorus"], key: "G", choruses: [1, 3] },
  worshipSet: [{ id: "i0", title: "Great Is Thy Faithfulness", key: "D" }, { id: "i1", title: "Amazing Grace", key: "G", live: true }, { id: "i2", title: "Blessed Assurance" }],
  outputMap: [{ id: "main", name: "Projector", kind: "display", role: "congregation", on: true, scene: "Sermon split", by: "Femi's laptop", at: 0 }, { id: "side", name: "Side screen", kind: "display", role: "congregation", on: true, scene: null }],
  obs: {
    connected: true, studioMode: false, scenes: ["Wide", "Pulpit"], program: "Wide", preview: null, recording: false,
    stream: { text: "Live for 12:03 · 2.5 Mbit/s", tone: "live" }, record: { text: "Not recording", tone: "off" }, transitions: ["Fade", "Cut"], transition: "Fade",
  },
}

const render = async (role: string, state: LiveStateV1 = live) => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useJoin.setState({ status: "connected", me: { name: "Op", role }, live: state, error: null, paused: false, note: null })
  const el = document.createElement("div")
  await act(async () => (roots.push(createRoot(el)), roots[roots.length - 1]).render(<OperatorsPanel />))
  return el
}
const button = (el: Element, text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement
const click = (b: HTMLButtonElement) => act(async () => (b.type === "submit" && b.form ? b.form.requestSubmit() : b.click()))
const choose = (sel: HTMLSelectElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, value)
  sel.dispatchEvent(new Event("change", { bubbles: true }))
})

// Unmounted after each test, so no React work runs after the test environment closes.
const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => { for (const r of roots.splice(0)) r.unmount() })
  document.body.innerHTML = ""
})
beforeEach(() => { sent.length = 0 })

describe("worship desk: key, repeat chorus and the worship set", () => {
  it("shows the song's key and goes back to the chorus with what it saw", async () => {
    const el = await render("worship")
    const steps = el.querySelector('[aria-label="Sections of the song on the screens"]')!
    expect(steps.textContent).toContain("Key G")
    await click(button(el, "Repeat chorus"))
    expect(sent.at(-1)).toMatchObject({ command: "song_section", value: "chorus", seen: { lyrics: 7 } })
    const none = await render("worship", { ...live, lyrics: { ...live.lyrics!, key: undefined, choruses: [] } })
    expect(button(none, "Repeat chorus").disabled).toBe(true)
    expect(none.querySelector('[aria-label="Sections of the song on the screens"]')!.textContent).not.toContain("Key")
    const older = await render("worship", { ...live, lyrics: { ...live.lyrics!, choruses: undefined } })
    expect(button(older, "Repeat chorus")).toBeUndefined()
  })

  it("lists the service's songs in order with their keys, and which is on the screens", async () => {
    const el = await render("worship")
    const set = el.querySelector('[aria-label="Worship set"]')!
    const rows = [...set.querySelectorAll("li")].map((li) => li.textContent)
    expect(rows).toEqual(["1Great Is Thy FaithfulnessKey D", "2Amazing GraceKey GOn the screens", "3Blessed Assurance"])
    expect(set.querySelectorAll("button")).toHaveLength(0)
  })
})

describe("OBS desk: health, transition and recording", () => {
  it("shows the stream and recording health and chooses the transition", async () => {
    const el = await render("obs")
    const health = el.querySelector('[aria-label="OBS health"]')!
    expect(health.textContent).toContain("Live for 12:03 · 2.5 Mbit/s")
    expect(health.textContent).toContain("Not recording")
    await choose(el.querySelector<HTMLSelectElement>('[aria-label="OBS transition"]')!, "Cut")
    expect(sent.at(-1)).toMatchObject({ command: "obs_transition", value: "Cut", seen: { "obs:transition": 5 } })
  })

  it("starts the recording, stops it only when asked twice, and adds a marker while recording", async () => {
    const el = await render("obs")
    expect(button(el, "Add marker").disabled).toBe(true)
    await click(button(el, "Start recording"))
    expect(sent.at(-1)).toMatchObject({ command: "obs_record", value: { action: "start" }, seen: { "obs:record": 4 } })
    const rec = await render("obs", { ...live, obs: { ...live.obs!, recording: true, record: { text: "Recording at 0:42", tone: "live" } } })
    await click(button(rec, "Stop recording…"))
    expect(sent).toHaveLength(1)
    await click(button(rec, "Stop the recording"))
    expect(sent.at(-1)).toMatchObject({ command: "obs_record", value: { action: "stop" } })
    const input = rec.querySelector<HTMLInputElement>('[aria-label="Marker name"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Sermon starts")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await click(button(rec, "Add marker"))
    expect(sent.at(-1)).toMatchObject({ command: "obs_record", value: { action: "marker", label: "Sermon starts" } })
  })

  it("changes nothing in rehearsal, and an older host shows no recording controls", async () => {
    const el = await render("obs", { ...live, program: { ...live.program, rehearsal: true } })
    expect(button(el, "Start recording").disabled).toBe(true)
    expect(el.querySelector<HTMLSelectElement>('[aria-label="OBS transition"]')!.disabled).toBe(true)
    const older = await render("obs", { ...live, obs: { connected: true, studioMode: false, scenes: ["Wide"], program: "Wide", preview: null } })
    expect(older.querySelector('[aria-label="OBS recording"]')).toBeNull()
    expect(older.querySelector('[aria-label="OBS health"]')).toBeNull()
  })
})

describe("screens desk and the director's output map", () => {
  it("the output map says who took each output last", async () => {
    for (const role of ["screens", "present"]) {
      const map = (await render(role)).querySelector('[aria-label="Output map"]')!
      const rows = [...map.querySelectorAll("li")]
      expect(rows[0].textContent, role).toContain("by Femi's laptop")
      expect(rows[1].textContent, role).not.toContain("by ")
    }
  })

  it("the screens desk takes the ticker off and puts the lower third back, with what it saw", async () => {
    const el = await render("screens")
    const box = el.querySelector('[aria-label="Ticker and lower third"]')!
    expect(box.textContent).toContain("Ticker · on · Welcome to CAC")
    await click(button(box, "Take off"))
    expect(sent.at(-1)).toMatchObject({ command: "clear_source", value: "ticker", seen: { "source:ticker": 2 } })
    await click(button(box, "Put back"))
    expect(sent.at(-1)).toMatchObject({ command: "restore_source", value: "lowerThird" })
    expect((await render("worship")).querySelector('[aria-label="Ticker and lower third"]')).toBeNull()
  })
})

describe("Queue on a request from a joined desk (#251)", () => {
  const ask = { id: "n1", from: "Main desk", to: "all" as const, priority: "normal" as const, text: "Next hymn", at: 0, answers: [], action: { kind: "song" as const, value: "Amazing Grace" } }

  it("a Present or editor desk queues it on the host and answers Ready; other desks have no Queue", async () => {
    for (const role of ["present", "editor"]) {
      sent.length = 0
      const el = await render(role, { ...live, notices: [ask] })
      const q = el.querySelector<HTMLButtonElement>('[aria-label="Queue Amazing Grace"]')
      expect(q, role).not.toBeNull()
      await click(q!)
      expect(sent[0]).toMatchObject({ command: "queue_request", value: { kind: "song", value: "Amazing Grace" }, seen: { queue: 3 } })
      expect(sent[1]).toMatchObject({ command: "notice_ack", value: { id: "n1", state: "ready" } })
    }
    for (const role of ["worship", "bible", "screens", "viewer"]) {
      expect((await render(role, { ...live, notices: [ask] })).querySelector('[aria-label="Queue Amazing Grace"]'), role).toBeNull()
    }
  })
})
