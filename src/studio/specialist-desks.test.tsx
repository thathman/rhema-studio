// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sent: Record<string, unknown>[] = []
/** What the host answers the next join_command with: a note, or a refusal (as join.rs marks it). */
let answer: { note?: string; refuse?: string } = {}
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, a: { command?: Record<string, unknown>; asked?: Record<string, unknown> } = {}) => {
    // The host's song library, as join_lookup answers it (desk consoles).
    if (cmd === "join_lookup" && a.asked?.what === "songs") return { songs: [{ id: "s1", title: "Great Is Thy Faithfulness", numbers: ["CAC 12"], firstLine: "Great is thy faithfulness", hymn: false }] }
    if (cmd !== "join_command") return null
    sent.push(a.command ?? {})
    const { note, refuse } = answer
    answer = {}
    if (refuse) throw refuse
    return note ?? null
  }),
}))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { useJoin } from "@/stores/join-store"
import { OperatorsPanel } from "@/studio/production/operators-panel"
import type { LiveStateV1 } from "@/lib/live-state"
import { NoticesPanel } from "@/studio/notices-panel"
import type { Notice } from "@/stores/notices-store"

const roots: ReturnType<typeof createRoot>[] = []

/** The specialist desks (#215 G10, #243 VL.5) and editing scenes from a joined desk (#243 SC.16). */
const box = { x: 0, y: 0, w: 100, h: 100 }
const live: LiveStateV1 = {
  v: 1, at: 0, church: "CAC", service: null, program: { onAir: true, reference: null, rehearsal: false },
  sources: [{ id: "song", reference: "Amazing Grace", on: true, revision: 2 }, { id: "camera:pulpit", reference: "Pulpit", on: true, revision: 0, state: "sending" }],
  event: { mode: "own", currentId: null }, rundown: [], timing: null, stageMessage: "",
  scenes: [
    { id: "split", name: "Sermon split", onScreen: true, background: "#000000", layers: [{ id: "cam", name: "Pulpit camera", kind: "camera", box: { x: 0, y: 25, w: 50, h: 50 }, opacity: 1, visible: true }, { id: "bible", name: "Bible", kind: "feed", shows: ["bible"], box, opacity: 1, visible: true }] },
    { id: "welcome", name: "Welcome", onScreen: false, background: "#000000", layers: [] },
  ],
  outputs: [{ id: "main", name: "Projector", sceneId: "split" }], notices: [], requireApproval: false,
  obs: { connected: true, studioMode: true, scenes: ["Wide", "Pulpit"], program: "Wide", preview: "Wide" },
  cameraFeeds: [{ name: "pulpit", label: "Pulpit", url: "http://192.168.1.20:8889/pulpit/whep" }, { name: "choir", label: "Choir", url: "http://192.168.1.20:8889/choir/whep" }],
}

const render = async (role: string, state: LiveStateV1 = live) => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const el = document.createElement("div")
  const root = createRoot(el)
  roots.push(root)
  await act(async () => {
    useJoin.setState({ status: "connected", me: { name: "Op", role }, live: state, error: null, paused: false, note: null })
    root.render(<OperatorsPanel />)
  })
  return el
}
const has = (el: HTMLElement, name: string) => !!el.querySelector(`[aria-label="${name}"]`)
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === text || b.getAttribute("aria-label") === text)!
/** A submit button submits its form (jsdom does not do that for a click). */
const click = (b: HTMLButtonElement) => act(async () => (b.type === "submit" && b.form ? b.form.requestSubmit() : b.click()))
const type = async (input: HTMLInputElement | HTMLSelectElement, value: string) => {
  const proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }))
  })
}

beforeEach(() => {
  sent.length = 0
  answer = {}
})

afterEach(async () => {
  await act(async () => { for (const root of roots.splice(0)) root.unmount() })
})

describe("each specialist desk sees only its part", () => {
  it("shows a host Take attempt without confusing it with the current program or event clock", async () => {
    const state: LiveStateV1 = {
      ...live,
      program: { onAir: true, reference: "Welcome slide", rehearsal: false },
      event: { mode: "own", currentId: "event-welcome" },
      rundown: [{ id: "event-welcome", reference: "Welcome", plannedMinutes: 5 }],
      takeAttempts: [{ id: 9, itemId: "sermon", reference: "Psalm 23", status: "pending", startedAt: 10_000, by: "Main desk" }],
    }
    const el = await render("viewer", state)

    expect(el.textContent).toContain("Take pending: Psalm 23")
    expect(el.textContent).toContain("Welcome slide")
    expect(el.textContent).toContain("Welcome")
  })

  it("Worship, Stage, Camera and OBS director", async () => {
    const desks = ["Event clock desk", "Bible desk", "Worship desk", "Scenes desk", "Stage desk", "Camera desk", "OBS desk"]
    const seen = async (role: string) => { const el = await render(role); return desks.filter((d) => has(el, d)) }
    expect(await seen("worship")).toEqual(["Worship desk"])
    expect(await seen("stage")).toEqual(["Stage desk"])
    expect(await seen("camera")).toEqual(["Scenes desk", "Camera desk"])
    expect(await seen("obs")).toEqual(["OBS desk"])
    expect(await seen("present")).toEqual(["Event clock desk", "Bible desk", "Worship desk", "Scenes desk", "Stage desk"])
  })

  it("a worship desk finds a song in the host's library, shows it and takes the lyrics off", async () => {
    const el = await render("worship")
    await type(el.querySelector<HTMLInputElement>('[aria-label="Song title, words or hymn number"]')!, "CAC 12")
    await click(button(el, "Find"))
    expect(el.textContent).toContain("CAC 12")
    await click(button(el, "Show"))
    await click(button(el, "Take it off"))
    expect(sent).toEqual([{ command: "song_show", value: "Great Is Thy Faithfulness" }, { command: "clear_source", value: "song" }])
  })

  it("a stage desk sends the stage message", async () => {
    const el = await render("stage")
    await type(el.querySelector<HTMLInputElement>('[aria-label="Message to stage"]')!, "Wrap up")
    await click(button(el, "Send"))
    expect(sent).toEqual([{ command: "stage_message", value: "Wrap up" }])
  })

  it("an OBS director previews and takes on the host's OBS, and not in rehearsal", async () => {
    const el = await render("obs")
    await click(button(el, "Preview Pulpit"))
    expect(sent).toEqual([{ command: "obs_preview", value: "Pulpit" }])
    const rehearsing = await render("obs", { ...live, program: { ...live.program, rehearsal: true }, obs: { ...live.obs!, preview: "Pulpit" } })
    expect(rehearsing.textContent).toContain("Rehearsal is on at the host")
    expect(button(rehearsing, "Take Pulpit to the stream").disabled).toBe(true)
  })

  it("a camera desk hides a camera from scenes", async () => {
    const el = await render("camera")
    await click(button(el, "Hide from scenes"))
    expect(sent).toEqual([{ command: "clear_source", value: "camera:pulpit" }])
    expect(el.textContent).not.toContain("Take Sermon split")
  })
})

describe("editing a scene from a Screens desk", () => {
  it("saves through the host with the revision it started from, and says when it waits for the main desk", async () => {
    const el = await render("screens")
    await click(button(el, "Edit Sermon split"))
    expect(el.textContent).toContain("This scene is on a screen")
    await type(el.querySelector<HTMLInputElement>('[aria-label="Scene name"]')!, "Sermon wide")
    answer = { note: "Sent to the main desk to accept, because that scene is on a screen" }
    await click(button(el, "Save on the host"))
    expect(sent[0]).toMatchObject({ command: "save_scene", value: { scene: { id: "split", name: "Sermon wide" } } })
    expect(el.textContent).toContain("Sent to the main desk to accept, because that scene is on a screen.")
    expect(has(el, "Edit Sermon split")).toBe(true)
    expect(el.querySelector('[aria-label="Scene name"]')).toBeNull()
  })

  it("sends the scene's revision from when it opened; refused as stale, it starts again from the host's version", async () => {
    const el = await render("screens", { ...live, revisions: { "scene:welcome": 4, event: 9 } })
    await click(button(el, "Edit Welcome"))
    // The host's Live State moves on while the editor is open (another desk changed the scene).
    await act(async () => useJoin.setState({ live: { ...live, revisions: { "scene:welcome": 5, event: 9 }, scenes: live.scenes.map((x) => (x.id === "welcome" ? { ...x, name: "Welcome (main desk)" } : x)) } }))
    await type(el.querySelector<HTMLInputElement>('[aria-label="Scene name"]')!, "Mine")
    answer = { refuse: "stale: Someone changed this first — look again" }
    await click(button(el, "Save on the host"))
    expect(sent[0].seen).toEqual({ "scene:welcome": 4, event: 9 })
    expect(el.textContent).toContain("Someone changed this first")
    expect(el.querySelector<HTMLInputElement>('[aria-label="Scene name"]')!.value).toBe("Welcome (main desk)")
    await click(button(el, "Save on the host"))
    expect(sent[1].seen).toEqual({ "scene:welcome": 5, event: 9 })
  })

  it("makes a new scene from a ready-made arrangement, and deletes one", async () => {
    const el = await render("screens")
    await click(button(el, "New scene…"))
    await click(button(el, "Add on the host"))
    expect(sent[0]).toMatchObject({ command: "save_scene" })
    expect(el.textContent).toContain("New scene added on the host.")
    await click(button(el, "Edit Welcome"))
    await click(button(el, "Delete scene…"))
    await click(button(el, "Delete Welcome for everyone"))
    expect(sent[1]).toEqual({ command: "delete_scene", value: { id: "welcome" } })
  })

  it("a camera desk changes only the camera boxes", async () => {
    const el = await render("camera")
    await click(button(el, "Change the cameras in Sermon split"))
    expect(el.querySelector<HTMLInputElement>('[aria-label="Scene name"]')!.disabled).toBe(true)
    expect(button(el, "Remove Bible").disabled).toBe(true)
    expect(button(el, "Delete scene…")).toBeUndefined()
    await click(button(el, "Pulpit camera · camera"))
    await type(el.querySelector<HTMLSelectElement>('[aria-label="Camera"]')!, "choir")
    await click(button(el, "Save on the host"))
    const saved = (sent[0].value as { scene: { layers: { cameraUrl?: string }[] } }).scene
    expect(saved.layers[0].cameraUrl).toBe("http://192.168.1.20:8889/choir/whep")
  })

  it("a Present desk takes scenes but does not edit them", async () => {
    const el = await render("present")
    expect(el.textContent).toContain("Take Welcome")
    expect(has(el, "Edit Welcome")).toBe(false)
    expect(el.textContent).not.toContain("New scene…")
  })
})

describe("a desk's scene change on the main desk", () => {
  it("is answered Accept or Decline, and the desk reads Accepted or Declined", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const n: Notice = { id: "n1", from: "Ade screens", to: "host", priority: "normal", text: "Asks to change the scene “Sermon split”, because that scene is on a screen.", action: { kind: "sceneEdit", value: "r1" }, at: 0, answers: [] }
    const onAction = vi.fn(() => null)
    const onAnswer = vi.fn()
    const el = document.createElement("div")
    const root = createRoot(el)
    roots.push(root)
    await act(async () => root.render(<NoticesPanel notices={[n]} role="host" me="Main desk" onSend={() => {}} onAnswer={onAnswer} onAction={onAction} />))
    expect([...el.querySelectorAll('[aria-label="Answer Ade screens"] button')].map((b) => b.textContent)).toEqual(["Accept the scene change", "Decline"])
    await click(button(el, "Accept the scene change"))
    expect(onAction).toHaveBeenCalledWith({ kind: "sceneEdit", value: "r1" }, "show")
    expect(onAnswer).toHaveBeenCalledWith("n1", "ready")
    const answered = { ...n, answers: [{ by: "Main desk", state: "ready" as const, at: 1 }] }
    await act(async () => root.render(<NoticesPanel notices={[answered]} role="host" me="Main desk" onSend={() => {}} onAnswer={onAnswer} onAction={onAction} />))
    expect(el.querySelector('[aria-label="Answer Ade screens"]')).toBeNull()
    expect(el.textContent).toContain("Main desk: Accepted")
  })
})
