// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sent: Record<string, unknown>[] = []
/** What the host answers the next join_command with: a note, or a refusal (as join.rs marks it). */
let answer: { note?: string; refuse?: string; revision?: number } = {}
let receiverReport: { outputs: { id: string; feed: boolean; watching?: number; seq?: number; acked?: number; confirmed?: boolean }[] } = { outputs: [] }
let receiverReadQueue: { outputs: { id: string; feed: boolean; watching?: number; seq?: number; acked?: number; confirmed?: boolean }[] }[] = []
let receiverError: string | null = null
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, a: { command?: Record<string, unknown>; asked?: Record<string, unknown> } = {}) => {
    // The host's song library, as join_lookup answers it (desk consoles).
    if (cmd === "join_lookup" && a.asked?.what === "songs") return { songs: [{ id: "s1", title: "Great Is Thy Faithfulness", numbers: ["CAC 12"], firstLine: "Great is thy faithfulness", hymn: false }] }
    if (cmd === "join_receivers") {
      if (receiverError) throw receiverError
      return receiverReadQueue.shift() ?? receiverReport
    }
    if (cmd !== "join_command") return null
    sent.push(a.command ?? {})
    const { note, refuse, revision } = answer
    answer = {}
    if (refuse) throw refuse
    if (revision !== undefined) return { note: note ?? null, revision }
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

const render = async (role: string, state: LiveStateV1 = live, outputScope?: string[]) => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const el = document.createElement("div")
  const root = createRoot(el)
  roots.push(root)
  await act(async () => {
    useJoin.setState({ status: "connected", me: { name: "Op", role, ...(outputScope ? { outputScope } : {}) }, live: state, error: null, paused: false, note: null })
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
  receiverReport = { outputs: [] }
  receiverReadQueue = []
  receiverError = null
})

afterEach(async () => {
  await act(async () => { for (const root of roots.splice(0)) root.unmount() })
})

describe("each specialist desk sees only its part", () => {
  it("keeps Viewer service awareness separate from private Program and Take details", async () => {
    const state: LiveStateV1 = {
      ...live,
      program: { onAir: true, reference: "Welcome slide", rehearsal: false },
      event: { mode: "own", currentId: "event-welcome" },
      rundown: [{ id: "event-welcome", reference: "Welcome", plannedMinutes: 5 }],
      takeAttempts: [{ id: 9, itemId: "sermon", reference: "Psalm 23", status: "pending", startedAt: 10_000, by: "Main desk" }],
    }
    const el = await render("viewer", state)

    expect(el.textContent).not.toContain("Take pending: Psalm 23")
    expect(el.textContent).not.toContain("Psalm 23")
    expect(el.textContent).not.toContain("Welcome slide")
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

  it("Worship changes the temporary order through the host, without changing the saved plan", async () => {
    const state: LiveStateV1 = {
      ...live,
      service: { id: "service-1", title: "Sunday" },
      worshipSet: [{ id: "a", title: "Alpha" }, { id: "b", title: "Beta", live: true }, { id: "c", title: "Gamma" }],
    }
    const el = await render("worship", state)
    await click(button(el, "Move Gamma earlier"))
    expect(sent[0]).toMatchObject({ command: "worship_set", value: { op: "move", item: "c", before: "b" } })
    expect(el.textContent).toContain("not saved to Prepare")
    expect(el.textContent).toContain("On the screens")
    expect(button(el, "Skip Beta today").disabled).toBe(true)
    await click(button(el, "Repeat Beta today"))
    expect(sent).toContainEqual({ command: "worship_set", value: { op: "repeat", item: "b" } })
  })

  it("a stage desk sends the stage message", async () => {
    const el = await render("stage")
    await type(el.querySelector<HTMLInputElement>('[aria-label="Message to stage"]')!, "Wrap up")
    await click(button(el, "Send"))
    expect(sent).toEqual([{ command: "stage_message", value: "Wrap up" }])
  })

  it("a Stage desk can send privately only to one assigned display", async () => {
    const state: LiveStateV1 = {
      ...live,
      outputs: [
        ...live.outputs.filter((output) => output.id === "main"),
        { id: "stage-east", name: "Stage East", role: "stage", sceneId: null },
      ],
    }
    const el = await render("stage", state)
    expect(el.textContent).toContain("Stage East")
    expect(el.textContent).not.toContain("Projector")
    await type(el.querySelector<HTMLSelectElement>('[aria-label="Stage display for private message"]')!, "stage-east")
    await type(el.querySelector<HTMLInputElement>('[aria-label="Private message text"]')!, "Choir enters now")
    await click(button(el, "Send privately"))
    expect(sent).toContainEqual({ command: "stage_send", value: { target: "stage-east", text: "Choir enters now" } })
    expect(sent).not.toContainEqual({ command: "stage_message", value: "Choir enters now" })
    await click(button(el, "Clear private message from Stage East"))
    expect(sent).toContainEqual({ command: "stage_send", value: { target: "stage-east", text: "" } })
  })

  it("shows the host service clock read only and does not claim the Stage display received a cue", async () => {
    const state: LiveStateV1 = {
      ...live,
      timer: { durationMs: 600_000, elapsedMs: 120_000, running: false },
      event: { mode: "own", currentId: "sermon" },
      rundown: [{ id: "sermon", reference: "Sermon", plannedMinutes: 10 }],
    }
    const el = await render("stage", state)
    const clock = el.querySelector('[aria-label="Host service clock"]')!
    expect(clock.querySelector('[role="timer"]')?.textContent).toBe("8:00")
    expect(clock.textContent).toContain("Current event: Sermon")

    const receiver = el.querySelector('[aria-label="Stage receiver status"]')!
    expect(receiver.textContent).toContain("Display not confirmed")
    expect(receiver.textContent).toContain("does not currently send Stage display receipts")
    expect(receiver.textContent).toContain("Host connection: current")
    expect([...el.querySelectorAll("button")].map((item) => item.textContent?.trim())).not.toContain("Pause")
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
  it("shows Takes only for assigned congregation outputs and never offers group Take", async () => {
    const state: LiveStateV1 = {
      ...live,
      outputs: [
        { id: "main", name: "Sanctuary", sceneId: "split" },
        { id: "overflow", name: "Overflow", sceneId: null },
      ] as never,
      outputMap: [
        { id: "main", name: "Sanctuary", kind: "display", role: "congregation", on: true, scene: "Sermon split" },
        { id: "overflow", name: "Overflow", kind: "ndi", role: "congregation", on: true, scene: null },
        { id: "stage", name: "Stage Confidence", kind: "display", role: "stage", on: true, scene: null },
        { id: "lobby", name: "Lobby", kind: "display", role: "signage", on: true, scene: null },
      ],
    }
    const el = await render("screens", state, ["overflow"])
    expect(el.querySelector('[aria-label="Congregation output"]')?.textContent).toBe("Overflow")
    expect(el.textContent).toContain("Take Welcome")
    const map = el.querySelector('[aria-label="Output map"]')
    expect(map?.textContent).toContain("Overflow")
    expect(map?.textContent).not.toContain("Sanctuary")
    expect(map?.textContent).not.toContain("Stage Confidence")
    expect(map?.textContent).not.toContain("Lobby")
    await click(button(el, "Take Welcome"))
    expect(sent).toEqual([{ command: "take_scene", value: { output: "overflow", scene: "welcome" } }])
  })

  it("separates host-applied Program state from a receiver confirming its latest frame", async () => {
    receiverReport = { outputs: [{ id: "overflow", feed: true, watching: 1, seq: 1, acked: 1, confirmed: true }] }
    receiverReadQueue = [
      { outputs: [{ id: "overflow", feed: true, watching: 1, seq: 1, acked: 1, confirmed: true }] },
      { outputs: [{ id: "overflow", feed: true, watching: 1, seq: 2, acked: 2, confirmed: true }] },
    ]
    const state: LiveStateV1 = {
      ...live,
      revisions: { "output:overflow": 3 },
      outputs: [{ id: "overflow", name: "Overflow", sceneId: "split", sceneRevision: 5 }],
    }
    const el = await render("screens", state, ["overflow"])
    expect(el.textContent).not.toContain("Receiver confirms")
    expect(el.textContent).toContain("Current Program on Overflow: Sermon split")

    await click(button(el, "Take Welcome"))
    expect(sent).toEqual([{ command: "take_scene", value: { output: "overflow", scene: "welcome" }, seen: { "output:overflow": 3 } }])
    expect(el.textContent).toContain("The host accepted Welcome for Overflow; waiting for Current Program to confirm.")

    const applied: LiveStateV1 = {
      ...state,
      revisions: { "output:overflow": 4 },
      outputs: [{ id: "overflow", name: "Overflow", sceneId: "welcome", sceneName: "Welcome", sceneRevision: 6 }],
    }
    await act(async () => {
      useJoin.setState({ live: applied })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(el.textContent).toContain("Host applied Welcome to Overflow.")
    expect(el.textContent).toContain("Receiver confirms the new Program frame on Overflow was drawn.")

    await act(async () => useJoin.setState({
      live: {
        ...applied,
        revisions: { "output:overflow": 5 },
        outputs: [{ id: "overflow", name: "Overflow", sceneId: "split", sceneRevision: 7 }],
      },
    }))
    expect(el.textContent).not.toContain("Receiver confirms the new Program frame on Overflow was drawn.")
  })

  it("does not treat a confirmed frame at the post-Take baseline as the new scene frame", async () => {
    receiverReport = { outputs: [{ id: "main", feed: true, watching: 1, seq: 10, acked: 10, confirmed: true }] }
    receiverReadQueue = [
      { outputs: [{ id: "main", feed: true, watching: 1, seq: 10, acked: 10, confirmed: true }] },
      { outputs: [{ id: "main", feed: true, watching: 1, seq: 10, acked: 10, confirmed: true }] },
    ]
    const state: LiveStateV1 = { ...live, revisions: { "output:main": 3 }, outputs: [{ id: "main", name: "Sanctuary", sceneId: "split", sceneRevision: 5 }] }
    const el = await render("screens", state, ["main"])
    answer = { revision: 4 }
    await click(button(el, "Take Welcome"))
    await act(async () => {
      useJoin.setState({ live: { ...state, revisions: { "output:main": 4 }, outputs: [{ id: "main", name: "Sanctuary", sceneId: "welcome", sceneRevision: 6 }] } })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(el.textContent).toContain("Waiting for a new receiver frame on Sanctuary.")
    expect(el.textContent).not.toContain("Receiver confirms")
  })

  it("shows an approval request as pending without claiming Program changed", async () => {
    const state: LiveStateV1 = { ...live, outputs: [{ id: "main", name: "Sanctuary", sceneId: "split", sceneRevision: 5 }] }
    const el = await render("screens", state, ["main"])
    answer = { note: "Sent to the main desk to accept, because approvals are required" }
    await click(button(el, "Take Welcome"))
    expect(el.textContent).toContain("Approval request sent for Welcome on Sanctuary.")
    expect(el.textContent).toContain("Current Program is unchanged until the host approves it.")
    expect(el.textContent).toContain("Current Program on Sanctuary: Sermon split")
    expect(el.textContent).not.toContain("Host applied Welcome")
  })

  it("keeps stale Take refusals visible without claiming the receiver confirmed a frame", async () => {
    const state: LiveStateV1 = { ...live, outputs: [{ id: "main", name: "Sanctuary", sceneId: "split", sceneRevision: 5 }] }
    const el = await render("screens", state, ["main"])

    answer = { refuse: "stale: Someone changed this first — look again" }
    await click(button(el, "Take Welcome"))
    const alerts = [...el.querySelectorAll('[role="alert"]')].map((alert) => alert.textContent).join(" ")
    expect(alerts).toContain("Someone changed this first")
    expect(alerts).toContain("The host did not apply Welcome")
    expect(el.textContent).not.toContain("Host applied Welcome to Sanctuary")
  })

  it("reports receiver errors after the host applies the selected-output Take", async () => {
    receiverReport = { outputs: [{ id: "main", feed: true, watching: 1, seq: 1, acked: 1, confirmed: true }] }
    const state: LiveStateV1 = { ...live, revisions: { "output:main": 3 }, outputs: [{ id: "main", name: "Sanctuary", sceneId: "split", sceneRevision: 5 }] }
    const el = await render("screens", state, ["main"])
    answer = { revision: 4 }
    await click(button(el, "Take Welcome"))
    receiverError = "The host could not report receiver status (401 Unauthorized)"
    await act(async () => {
      useJoin.setState({ live: { ...state, revisions: { "output:main": 4 }, outputs: [{ id: "main", name: "Sanctuary", sceneId: "welcome", sceneRevision: 6 }] } })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("Receiver status unavailable")
  })

  it("does not block an explicit Take when the receiver baseline is unavailable", async () => {
    receiverError = "The host could not report receiver status (401 Unauthorized)"
    const state: LiveStateV1 = { ...live, revisions: { "output:main": 3 }, outputs: [{ id: "main", name: "Sanctuary", sceneId: "split", sceneRevision: 5 }] }
    const el = await render("screens", state, ["main"])
    answer = { revision: 4 }
    await click(button(el, "Take Welcome"))
    expect(sent).toContainEqual({ command: "take_scene", value: { output: "main", scene: "welcome" }, seen: { "output:main": 3 } })
    await act(async () => useJoin.setState({ live: { ...state, revisions: { "output:main": 4 }, outputs: [{ id: "main", name: "Sanctuary", sceneId: "welcome", sceneRevision: 6 }] } }))
    expect(el.textContent).toContain("Receiver confirmation is unavailable for this Take")
    expect(el.textContent).toContain("The host can still apply the Take.")
  })

  it("explains when the host no longer reports the selected output", async () => {
    receiverReport = { outputs: [{ id: "main", feed: true, watching: 1, seq: 1, acked: 1, confirmed: true }] }
    receiverReadQueue = [
      { outputs: [{ id: "main", feed: true, watching: 1, seq: 1, acked: 1, confirmed: true }] },
      { outputs: [] },
    ]
    const state: LiveStateV1 = { ...live, revisions: { "output:main": 3 }, outputs: [{ id: "main", name: "Sanctuary", sceneId: "split", sceneRevision: 5 }] }
    const el = await render("screens", state, ["main"])
    answer = { revision: 4 }
    await click(button(el, "Take Welcome"))
    await act(async () => {
      useJoin.setState({ live: { ...state, revisions: { "output:main": 4 }, outputs: [{ id: "main", name: "Sanctuary", sceneId: "welcome", sceneRevision: 6 }] } })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("The host did not report this output")
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("Confirm it is still assigned and connected")
  })

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
