// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const receiverState = vi.hoisted(() => {
  if (globalThis.HTMLCanvasElement) {
    const context = new Proxy({ font: "" }, {
      get: (target, property) => property === "measureText"
        ? (text: string) => ({ width: text.length * 8 })
        : property === "canvas"
          ? { width: 1920, height: 1080 }
          : Reflect.get(target, property) ?? (() => undefined),
      set: (target, property, value) => Reflect.set(target, property, value),
    })
    globalThis.HTMLCanvasElement.prototype.getContext = (() => context) as unknown as typeof globalThis.HTMLCanvasElement.prototype.getContext
  }
  return { health: null as null | { watching: number; current: boolean; behind: boolean; tvs?: Record<string, number> } }
})

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))
vi.mock("@/lib/browser-feeds", () => ({ useFeedHealth: () => receiverState.health }))
vi.mock("@/studio/present/live-sources-strip", () => ({ LiveSourcesStrip: () => null }))
// The picture itself needs a real canvas; these tests are about the words around it.
vi.mock("@/components/ui/canvas-verse", () => ({ CanvasVerse: () => null }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { LiveOutputPanel } from "./live-output-panel"
import { PreviewPanel } from "./preview-panel"
import { useBibleStore, useBroadcastStore, useQueueStore } from "@/stores"
import type { QueueItem, Verse } from "@/types"
import { SCENE_PRESETS, newScene } from "@/lib/scenes"

let el: HTMLDivElement
let root: Root
const originalViewport = { width: window.innerWidth, height: window.innerHeight }
const verse: Verse = { id: 1, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "Jn", chapter: 3, verse: 16, text: "For God so loved the world" }

async function render(node: React.ReactNode) {
  el = document.createElement("div")
  document.body.append(el)
  root = createRoot(el)
  await act(async () => root.render(node))
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  receiverState.health = null
  useBroadcastStore.setState({ isLive: false, liveVerse: null, rehearsal: false })
  useBibleStore.setState({ selectedVerse: null, selectedSlide: null })
  useQueueStore.setState({ items: [] })
})

afterEach(() => {
  act(() => root.unmount())
  el.remove()
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalViewport.width })
  Object.defineProperty(window, "innerHeight", { configurable: true, value: originalViewport.height })
})

describe("Present's Program and Preview panels", () => {
  it.each([
    { width: 1024, height: 700 },
    { width: 1366, height: 768 },
    { width: 1702, height: 895 },
    { width: 1920, height: 1080 },
  ])("keeps the selected output's named scene action structurally attached to Program at $width×$height", async ({ width, height }) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width })
    Object.defineProperty(window, "innerHeight", { configurable: true, value: height })
    await render(<LiveOutputPanel outputId="main" sceneTakeAction={<div data-slot="live-scene-take-action" data-program-context-row className="flex shrink-0"><button type="button">Take Welcome to Sanctuary</button></div>} />)
    const panel = el.querySelector('[data-slot="live-output-panel"]')!
    const header = panel.querySelector('[data-slot="panel-header"]')!
    const contextRow = panel.querySelector('[data-program-context-row]')!
    const picture = panel.querySelector('[data-slot="live-picture"]')!
    const action = panel.querySelector('[data-slot="live-scene-take-action"] button')!
    expect(window.innerWidth).toBe(width)
    expect(window.innerHeight).toBe(height)
    expect(action.textContent).toBe("Take Welcome to Sanctuary")
    expect(panel.querySelectorAll('[data-program-context-row]')).toHaveLength(1)
    expect(contextRow.className).toContain("shrink-0")
    expect(contextRow.hasAttribute("hidden")).toBe(false)
    expect(header.compareDocumentPosition(contextRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(contextRow.compareDocumentPosition(picture) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(action.closest('[role="toolbar"]')).toBeNull()
  })

  it("Program has no second go-live switch and reports whether the screens are on air", async () => {
    await render(<LiveOutputPanel />)
    expect(el.querySelector('[role="switch"]')).toBeNull()
    const header = el.querySelector('[data-slot="panel-header"]')!
    expect(header.textContent).toContain("Program")
    expect(header.textContent).toContain("Off air")
    // Auto stays: where heard verses go is not a go-live control.
    expect(el.querySelector('[aria-label="Auto: where heard verses go by themselves"]')).not.toBeNull()
    await act(async () => useBroadcastStore.setState({ isLive: true, liveVerse: { reference: "John 3:16", segments: [] } }))
    expect(header.textContent).toContain("On air")
    await act(async () => useBroadcastStore.setState({ rehearsal: true }))
    expect(header.textContent).toContain("Rehearsal")
    expect(el.querySelector("[data-program-delivery-state]")?.getAttribute("data-program-delivery-state")).toBe("Rehearsal")
  })

  it("shows the empty Program once while keeping its off-air detail available to assistive tech", async () => {
    await render(<LiveOutputPanel />)

    expect(el.textContent).toContain("Nothing on air")
    const delivery = el.querySelector<HTMLElement>('[data-program-delivery-state="Off air"]')!
    expect(delivery.textContent).toContain("Off air")
    const detail = delivery.querySelector<HTMLElement>('[role="status"]')!
    expect(detail.textContent).toContain("Host Program is off air.")
    expect(detail.className).toContain("sr-only")
  })

  it("the one-line Preview says what Take live will put up, and the item's plan", async () => {
    await render(<PreviewPanel compact />)
    const line = el.querySelector('section[aria-label="Preview"]')!
    expect(line.textContent).toContain("Nothing in Preview")
    const scene = { ...newScene("Sermon split", SCENE_PRESETS[0]), id: "split" }
    const item: QueueItem = { id: "it-1", reference: "John 3:16", confidence: 1, source: "manual", added_at: 0, verse, scene_id: "split" }
    await act(async () => {
      useBroadcastStore.setState({ scenes: [scene] })
      useQueueStore.setState({ items: [item] })
      useBibleStore.setState({ selectedVerse: verse })
    })
    expect(line.textContent).toContain("John 3:16")
    expect(line.textContent).toContain("Only you see this")
    expect(line.textContent).toContain("Planned · Scene: Sermon split")
  })

  it("a video item on air has Pause video / Resume video, held on every output without a new activation (#36)", async () => {
    await render(<LiveOutputPanel />)
    expect(el.textContent).not.toContain("Pause video")
    const clip = { kind: "image" as const, content: "picture" as const, reference: "", segments: [], video: { url: "asset://localhost/m/a.mp4", fit: "cover" as const, loop: false, sound: true, name: "Welcome clip", token: 3 } }
    await act(async () => useBroadcastStore.getState().setLiveVerse(clip, null, { goLive: true }))
    const before = useBroadcastStore.getState().sources.picture!
    const pause = [...el.querySelectorAll("button")].find((b) => b.textContent === "Pause video")!
    expect(pause.getAttribute("aria-pressed")).toBe("false")
    await act(async () => pause.click())
    const s = useBroadcastStore.getState()
    expect(s.liveVerse?.video).toMatchObject({ paused: true, token: 3 })
    // The live source is the same item paused: same revision, still on, its value the paused one (feeds follow it).
    expect(s.sources.picture).toMatchObject({ revision: before.revision, on: true })
    expect(s.sources.picture!.value).toBe(s.liveVerse)
    const resume = [...el.querySelectorAll("button")].find((b) => b.textContent === "Resume video")!
    await act(async () => resume.click())
    expect(useBroadcastStore.getState().liveVerse?.video?.paused).toBe(false)
    // Nothing for a verse, or with nothing on air.
    await act(async () => useBroadcastStore.getState().setVideoPaused(true))
    await act(async () => useBroadcastStore.setState({ isLive: false }))
    expect(el.textContent).not.toContain("video")
    useBroadcastStore.setState({ liveVerse: { reference: "John 3:16", segments: [] }, isLive: true })
    useBroadcastStore.getState().setVideoPaused(true)
    expect(useBroadcastStore.getState().liveVerse?.video).toBeUndefined()
  })

  it("reports a current browser page acknowledgement for the selected Program output", async () => {
    const base = useBroadcastStore.getState().outputs[0]!
    const output = { ...base, id: "foyer", name: "Foyer TV", type: "browser" as const, role: "congregation" as const }
    receiverState.health = { watching: 1, current: true, behind: false, tvs: { livingRoom: 1 } }
    useBroadcastStore.setState({
      outputs: [output],
      outputStatus: { foyer: { previewOpen: false, ndiActive: false, feedActive: true } },
      isLive: true,
      rehearsal: false,
      liveVerse: { reference: "John 3:16", segments: [{ text: "For God so loved the world" }] },
    })

    await render(<LiveOutputPanel outputId="foyer" />)

    expect(el.textContent).toContain("Foyer TV")
    expect(el.querySelector("[data-program-delivery-state]")?.getAttribute("data-program-delivery-state")).toBe("Receiver confirmed")
    expect(el.querySelector('[role="status"]')?.textContent).toBe("Receiver confirmed. 1 browser page showing the latest Program frame · 1 Google TV.")
    expect(el.textContent).not.toContain("Host applied")
  })

  it("distinguishes a publishing browser feed from receiver confirmation and lag", async () => {
    const base = useBroadcastStore.getState().outputs[0]!
    const output = { ...base, id: "foyer", name: "Foyer TV", type: "browser" as const, role: "congregation" as const }
    useBroadcastStore.setState({
      outputs: [output],
      outputStatus: { foyer: { previewOpen: false, ndiActive: false, feedActive: true } },
      isLive: true,
      rehearsal: false,
      liveVerse: { reference: "John 3:16", segments: [] },
    })
    receiverState.health = { watching: 2, current: false, behind: true, tvs: { sanctuary: 1 } }

    await render(<LiveOutputPanel outputId="foyer" />)

    expect(el.querySelector("[data-program-delivery-state]")?.getAttribute("data-program-delivery-state")).toBe("Behind")
    expect(el.querySelector('[role="status"]')?.textContent).toBe("Behind. 2 browser pages connected; the latest Program frame is not confirmed · 1 Google TV.")
  })

  it.each([
    ["no receiver", { watching: 0, current: false, behind: false }, "No receiver", "Feed is publishing; no receiver is connected."],
    ["waiting for a draw", { watching: 1, current: false, behind: false }, "Waiting", "1 browser page connected; waiting for a draw acknowledgement."],
  ] as const)("reports a browser feed that is %s", async (_name, health, label, detail) => {
    const base = useBroadcastStore.getState().outputs[0]!
    const output = { ...base, id: "foyer", name: "Foyer TV", type: "browser" as const, role: "congregation" as const }
    useBroadcastStore.setState({
      outputs: [output],
      outputStatus: { foyer: { previewOpen: false, ndiActive: false, feedActive: true } },
      isLive: true,
      rehearsal: false,
      liveVerse: { reference: "John 3:16", segments: [] },
    })
    receiverState.health = health

    await render(<LiveOutputPanel outputId="foyer" />)

    expect(el.querySelector("[data-program-delivery-state]")?.getAttribute("data-program-delivery-state")).toBe(label)
    expect(el.querySelector('[role="status"]')?.textContent).toBe(`${label}. ${detail}`)
  })

  it("reports a host-side feed failure without implying that a receiver saw the frame", async () => {
    const base = useBroadcastStore.getState().outputs[0]!
    const output = { ...base, id: "foyer", name: "Foyer TV", type: "browser" as const, role: "congregation" as const }
    useBroadcastStore.setState({
      outputs: [output],
      outputStatus: { foyer: { previewOpen: false, ndiActive: false, feedActive: false } },
      isLive: true,
      rehearsal: false,
      liveVerse: { reference: "John 3:16", segments: [] },
    })

    await render(<LiveOutputPanel outputId="foyer" />)

    expect(el.querySelector("[data-program-delivery-state]")?.getAttribute("data-program-delivery-state")).toBe("Not sending")
    expect(el.querySelector('[role="status"]')?.textContent).toBe("Not sending. Host is not sending to this browser feed.")
  })

  it("reports NDI errors as errors rather than host-applied success", async () => {
    const base = useBroadcastStore.getState().outputs[0]!
    const output = { ...base, id: "stream", name: "Stream NDI", type: "ndi" as const, role: "congregation" as const }
    useBroadcastStore.setState({
      outputs: [output],
      outputStatus: { stream: { previewOpen: false, ndiActive: false, ndiError: "Frame send failed" } },
      isLive: true,
      rehearsal: false,
      liveVerse: { reference: "John 3:16", segments: [] },
    })

    await render(<LiveOutputPanel outputId="stream" />)

    expect(el.querySelector("[data-program-delivery-state]")?.getAttribute("data-program-delivery-state")).toBe("NDI error")
    expect(el.querySelector('[role="status"]')?.textContent).toBe("NDI error. NDI sender error · Frame send failed")
  })

  it("does not claim receiver confirmation for a local host display window", async () => {
    const output = useBroadcastStore.getState().outputs[0]!
    useBroadcastStore.setState({
      outputs: [{ ...output, id: "sanctuary", name: "Sanctuary", type: "display" }],
      outputStatus: { sanctuary: { previewOpen: true, ndiActive: false } },
      isLive: true,
      rehearsal: false,
      liveVerse: { reference: "John 3:16", segments: [{ text: "For God so loved the world" }] },
    })

    await render(<LiveOutputPanel outputId="sanctuary" />)

    const status = el.querySelector('[role="status"]')?.textContent ?? ""
    expect(status).toContain("Host output window is open")
    expect(status).toContain("local displays do not report receiver acknowledgement")
    expect(status).not.toContain("Receiver confirmed")
  })

  it("the scene presets keep their ids and order; Closing announcements and Countdown over a live camera come after (#208 U3)", () => {
    expect(SCENE_PRESETS.map((p) => p.id)).toEqual(["full", "bible-lyrics", "picture-lyrics", "camera-bible", "full-camera", "pip-camera", "sermon-split", "welcome", "lyrics-video", "closing-announcements", "countdown-camera"])
    const closing = newScene("", SCENE_PRESETS.find((p) => p.id === "closing-announcements"))
    expect(closing.name).toBe("Closing announcements")
    expect(closing.layers.map((l) => l.kind)).toEqual(["color", "feed", "logo", "ticker"])
    expect(closing.layers[1].shows).toEqual(["slide", "picture"])
    const countdown = newScene("", SCENE_PRESETS.find((p) => p.id === "countdown-camera"))
    expect(countdown.layers.map((l) => l.kind)).toEqual(["camera", "color", "clock"])
    expect(countdown.layers[2]).toMatchObject({ clockShows: "until" })
    expect(countdown.layers[1].opacity).toBeLessThan(1)
  })
})
