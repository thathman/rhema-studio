// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { invoke } from "@tauri-apps/api/core"
import { buildLiveState, type LiveStateV1 } from "@/lib/live-state"
import { asAction, asTarget, isFor, sceneTargets, useNotices } from "@/stores/notices-store"
import { useJoin } from "@/stores/join-store"
import { useSettingsStore } from "@/stores/settings-store"
import { OperatorsPanel } from "@/studio/production/operators-panel"
import { NoticesPanel } from "./notices-panel"

const buttonNamed = (el: HTMLElement, text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent === text)!

/** Production notices (Rhema Comms C1, #251): private, addressed, answered, carried in the Live State. */
beforeEach(() => useNotices.setState({ notices: [], read: [] }))

describe("production notices", () => {
  it("are addressed, bounded and answered once per person", () => {
    const n = useNotices.getState().send({ from: "Femi (timekeeper)", to: "host", priority: "urgent", text: "  Five minutes over  " })!
    expect(n).toMatchObject({ to: "host", priority: "urgent", text: "Five minutes over" })
    expect(useNotices.getState().send({ from: "x", text: "   " })).toBeNull()
    expect(useNotices.getState().send({ from: "x", to: "everyone", text: "y".repeat(400) })).toMatchObject({ to: "all" })
    expect(useNotices.getState().notices[0].text).toHaveLength(280)
    useNotices.getState().answer(n.id, "Main desk", "seen")
    useNotices.getState().answer(n.id, "Main desk", "ready")
    useNotices.getState().answer(n.id, "Main desk", "shrug")
    expect(useNotices.getState().notices.find((x) => x.id === n.id)!.answers.map((a) => a.state)).toEqual(["ready"])
    for (let i = 0; i < 120; i++) useNotices.getState().send({ from: "x", text: `n${i}` })
    expect(useNotices.getState().notices).toHaveLength(100)
    expect(buildLiveState().notices).toHaveLength(50)
  })

  it("each desk sees what is for it and answers it; senders see their own", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const s = useNotices.getState()
    s.send({ from: "Main desk", to: "bible", text: "Next reading is Psalm 100" })
    s.send({ from: "Main desk", to: "screens", text: "Camera scene after the hymn" })
    s.send({ from: "Ade (Bible)", to: "host", text: "Psalm 100 is ready" })
    expect(isFor(useNotices.getState().notices[0], "bible")).toBe(false)
    const onAnswer = vi.fn()
    const onSend = vi.fn()
    const el = document.createElement("div")
    await act(async () => createRoot(el).render(<NoticesPanel notices={useNotices.getState().notices} role="bible" me="Ade (Bible)" onSend={onSend} onAnswer={onAnswer} onAction={vi.fn()} eventTitle="Opening prayer" />))
    expect(el.textContent).toContain("Next reading is Psalm 100")
    expect(el.textContent).toContain("Psalm 100 is ready")
    expect(el.textContent).not.toContain("Camera scene")
    const ready = [...el.querySelectorAll("button")].find((b) => b.textContent === "Ready")!
    await act(async () => ready.click())
    expect(onAnswer).toHaveBeenCalledWith(expect.any(String), "ready")
    const input = el.querySelector('[aria-label="Notice"]') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Reading after the hymn")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => (el.querySelector("form") as HTMLFormElement).requestSubmit())
    expect(onSend).toHaveBeenCalledWith({ to: "host", priority: "normal", text: "Reading after the hymn", action: null })
  })

  it("an action request is only a button on the recipient's desk; pressing it acts and answers Ready (C2)", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    expect(asAction({ kind: "shell", value: "rm" })).toBeNull()
    expect(asAction({ kind: "bible", value: "  " })).toBeNull()
    const n = useNotices.getState().send({ from: "Main desk", to: "bible", text: "Next reading", action: { kind: "bible", value: " Romans 8:28 " } })!
    expect(n.action).toEqual({ kind: "bible", value: "Romans 8:28" })
    const onAction = vi.fn()
    const onAnswer = vi.fn()
    const el = document.createElement("div")
    await act(async () => createRoot(el).render(<NoticesPanel notices={useNotices.getState().notices} role="bible" me="Ade (Bible)" onSend={vi.fn()} onAnswer={onAnswer} onAction={onAction} />))
    expect(onAction).not.toHaveBeenCalled()
    const show = [...el.querySelectorAll("button")].find((b) => b.textContent === "Show Romans 8:28")!
    await act(async () => show.click())
    expect(onAction).toHaveBeenCalledWith({ kind: "bible", value: "Romans 8:28" })
    expect(onAnswer).toHaveBeenCalledWith(n.id, "ready")
    // A scene request switches the outputs already showing a scene, else the main output.
    expect(sceneTargets([{ id: "main", sceneId: null }, { id: "obs", sceneId: "s1" }])).toEqual(["obs"])
    expect(sceneTargets([{ id: "side" }, { id: "main" }])).toEqual(["main"])
  })

  it("a refused action request answers Unable and shows the host's reason, not Ready", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const n = useNotices.getState().send({ from: "Main desk", to: "bible", text: "Camera after this", action: { kind: "scene", value: "split" } })!
    const live: LiveStateV1 = {
      v: 1, at: 0, church: "CAC", service: null, program: { onAir: false, reference: null, rehearsal: false }, sources: [], event: { mode: "own", currentId: null }, rundown: [], timing: null, stageMessage: "",
      scenes: [{ id: "split", name: "Sermon split" }], outputs: [{ id: "main", name: "Projector", sceneId: null }], notices: [n],
    }
    const why = "this device runs the Bible: it may activate, step and clear the Bible only"
    const sent: { command: string; value?: unknown }[] = []
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd !== "join_command") return null
      const c = (args as { command: { command: string; value?: unknown } }).command
      sent.push(c)
      if (c.command === "take_scene") throw why
      return null
    })
    useSettingsStore.setState({ joinAddress: "h:1", joinToken: "t" })
    useJoin.setState({ status: "connected", me: { name: "Ade (Bible)", role: "bible" }, live, error: null, paused: false, note: null })
    const el = document.createElement("div")
    await act(async () => createRoot(el).render(<OperatorsPanel />))
    await act(async () => buttonNamed(el, "Take Sermon split").click())
    await vi.waitFor(() => expect(sent.at(-1)).toEqual({ command: "notice_ack", value: { id: n.id, state: "unable" } }))
    expect(sent.map((c) => c.command)).toEqual(["take_scene", "notice_ack"])
    expect(el.querySelector('[aria-label="Notices desk"] [role="alert"]')?.textContent).toContain(why)

    // Done by the host: Ready, and the reason goes.
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "join_command") sent.push((args as { command: { command: string } }).command)
      return null
    })
    await act(async () => buttonNamed(el, "Take Sermon split").click())
    await vi.waitFor(() => expect(sent.at(-1)).toEqual({ command: "notice_ack", value: { id: n.id, state: "ready" } }))
    expect(el.querySelector('[aria-label="Notices desk"] [role="alert"]')).toBeNull()
    vi.mocked(invoke).mockImplementation(async () => null)
    useJoin.setState({ status: "off", live: null, me: null })
  })

  it("can go to one person by name; only that desk (and the main desk) sees it", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    expect(asTarget({ name: "  Ade's phone " })).toEqual({ name: "Ade's phone" })
    expect(asTarget({ name: "  " })).toBe("all")
    expect(asTarget({ id: 3 })).toBe("all")
    useSettingsStore.setState({ remoteDevices: [{ hash: "h-ade", name: "Ade's phone", role: "bible", paired_at: "" }] as never })
    const n = useNotices.getState().send({ from: "Main desk", fromId: "host", to: { name: "ade's phone" }, text: "Mic 2 is yours" })!
    // The host's server delivers it by the device's key, found from the name now, not by the name.
    expect(n).toMatchObject({ to: { name: "ade's phone" }, toId: "h-ade", fromId: "host" })
    expect(useNotices.getState().send({ from: "Main desk", to: { name: "Nobody" }, text: "x" })!.toId).toBeUndefined()
    useNotices.setState({ notices: [n] })
    useSettingsStore.setState({ remoteDevices: [] })
    expect([isFor(n, "bible", "ade's phone"), isFor(n, "bible", "Femi"), isFor(n, "bible")]).toEqual([true, false, false])
    const onSend = vi.fn()
    const el = document.createElement("div")
    await act(async () => createRoot(el).render(<NoticesPanel notices={useNotices.getState().notices} role="host" me="Main desk" people={["Ade's phone", "Femi"]} onSend={onSend} onAnswer={vi.fn()} onAction={vi.fn()} />))
    expect(el.textContent).toContain("→ ade's phone")
    const to = el.querySelector('[aria-label="Send to"]') as HTMLSelectElement
    expect([...to.querySelectorAll("optgroup option")].map((o) => o.textContent)).toEqual(["Ade's phone", "Femi"])
    await act(async () => {
      to.value = "name:Femi"
      to.dispatchEvent(new Event("change", { bubbles: true }))
      const input = el.querySelector('[aria-label="Notice"]') as HTMLInputElement
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Timer on 5")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => (el.querySelector("form") as HTMLFormElement).requestSubmit())
    expect(onSend).toHaveBeenCalledWith({ to: { name: "Femi" }, priority: "normal", text: "Timer on 5", action: null })
    // Another desk does not list it.
    const other = document.createElement("div")
    await act(async () => createRoot(other).render(<NoticesPanel notices={useNotices.getState().notices} role="bible" me="Femi" onSend={vi.fn()} onAnswer={vi.fn()} onAction={vi.fn()} />))
    expect(other.textContent).not.toContain("Mic 2 is yours")
  })
})
