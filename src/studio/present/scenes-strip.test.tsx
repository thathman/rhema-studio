// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))
vi.mock("@/lib/scene-renderer", () => ({ drawScene: vi.fn() }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ScenesStrip } from "./scenes-strip"
import type { SceneTakeSelection } from "@/studio/present/live-scene-take-action"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { SCENE_PRESETS, newScene } from "@/lib/scenes"
import { MAIN_OUTPUT_ID, defaultNdiSettings, type BroadcastOutput, type QueueItem, type Verse } from "@/types"
import { useBibleStore } from "@/stores/bible-store"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"

const original = { takeScene: useBroadcastStore.getState().takeScene, releaseScene: useBroadcastStore.getState().releaseScene }
const camera = { ...newScene("Camera with the Bible", SCENE_PRESETS[3]), id: "cam" }
const lyrics = { ...newScene("Lyrics on a picture", SCENE_PRESETS[2]), id: "lyr" }
let element: HTMLDivElement
let root: Root
type State = ReturnType<typeof useBroadcastStore.getState>
let take: ReturnType<typeof vi.fn<State["takeScene"]>>
let release: ReturnType<typeof vi.fn<State["releaseScene"]>>

function outputs(): BroadcastOutput[] {
  const themeId = useBroadcastStore.getState().themes[0].id
  const base = { type: "display" as const, themeId, monitorIndex: 0, ndi: defaultNdiSettings() }
  return [
    { ...base, id: MAIN_OUTPUT_ID, name: "Sanctuary" },
    { ...base, id: "overflow", name: "Overflow", monitorIndex: 1 },
    { ...base, id: "stage", name: "Stage", role: "stage" },
  ]
}

const button = (label: string) => element.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement
const sceneButton = (name: string) => [...element.querySelectorAll('[aria-label^="Scenes for"] button')].find((b) => b.getAttribute("aria-label")?.startsWith(name)) as HTMLButtonElement
const output = (id: string) => useBroadcastStore.getState().outputs.find((o) => o.id === id)!
const click = (b: HTMLElement) => act(async () => b.click())

async function render(outputId = MAIN_OUTPUT_ID, onTakeSelectionChange?: (selection: SceneTakeSelection | null) => void) {
  await act(async () => root.render(<ScenesStrip outputId={outputId} onTakeSelectionChange={onTakeSelectionChange} />))
}

function latestSelection(callback: ReturnType<typeof vi.fn>) {
  return callback.mock.calls.at(-1)?.[0] as SceneTakeSelection | null | undefined
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  take = vi.fn<State["takeScene"]>(original.takeScene)
  release = vi.fn<State["releaseScene"]>(original.releaseScene)
  useBroadcastStore.setState({ outputs: outputs(), scenes: [camera, lyrics], sceneReturn: {}, sources: {}, isLive: false, liveVerse: null, rehearsal: false, takeScene: take, releaseScene: release })
  useServiceStore.setState({ current: null })
  element = document.createElement("div")
  document.body.appendChild(element)
  root = createRoot(element)
})

afterEach(() => {
  act(() => root.unmount())
  element.remove()
  useServiceStore.setState({ current: null })
  useQueueStore.setState({ items: [] })
  useBibleStore.setState({ selectedVerse: null, selectedSlide: null, selectedQueueItemId: null })
  useBroadcastStore.setState({ ...original, rehearsal: false })
})

describe("Present's private scene selection", () => {
  it("stays hidden until there is a congregation screen and saved scene", async () => {
    useBroadcastStore.setState({ scenes: [] })
    await render()
    expect(element.textContent).toBe("")
    await act(async () => useBroadcastStore.setState({ scenes: [camera], outputs: outputs().filter((o) => o.role === "stage") }))
    expect(element.textContent).toBe("")
    await act(async () => useBroadcastStore.setState({ outputs: outputs() }))
    expect(element.textContent).toContain("Sanctuary: its own feed")
  })

  it("selects a scene for the named congregation output without changing Program", async () => {
    const selection = vi.fn<(value: SceneTakeSelection | null) => void>()
    await render(MAIN_OUTPUT_ID, selection)
    expect(element.querySelector('[aria-label="Which screen"]')).toBeNull()
    await click(sceneButton("Camera with the Bible"))
    expect(latestSelection(selection)).toMatchObject({ outputId: MAIN_OUTPUT_ID, outputName: "Sanctuary", sceneId: "cam", sceneName: "Camera with the Bible" })
    expect(output(MAIN_OUTPUT_ID).sceneId).toBeUndefined()
    expect(output("overflow").sceneId).toBeUndefined()
    expect(output("stage").sceneId).toBeUndefined()
    expect(element.querySelectorAll('[aria-label^="Take scene"]')).toHaveLength(0)
    expect(take).not.toHaveBeenCalled()

    await render("overflow", selection)
    await click(sceneButton("Lyrics on a picture"))
    expect(latestSelection(selection)).toMatchObject({ outputId: "overflow", outputName: "Overflow", sceneId: "lyr" })
    expect(output(MAIN_OUTPUT_ID).sceneId).toBeUndefined()
  })

  it("refreshes only the private preview of the selected saved revision", async () => {
    original.takeScene(MAIN_OUTPUT_ID, camera.id)
    original.takeScene("overflow", camera.id)
    const before = structuredClone(useBroadcastStore.getState().outputs)
    await act(async () => useBroadcastStore.getState().saveScene({ ...camera, background: "#123456" }))
    const selection = vi.fn<(value: SceneTakeSelection | null) => void>()
    await render(MAIN_OUTPUT_ID, selection)
    await click(button("Refresh saved preview for Sanctuary"))

    expect(take).not.toHaveBeenCalled()
    expect(useBroadcastStore.getState().outputs).toEqual(before)
    expect(element.textContent).toContain("Preview refreshed for Sanctuary. Take scene to apply it.")
    expect(latestSelection(selection)?.revisionLabel).toBeTruthy()
    expect(output(MAIN_OUTPUT_ID).sceneSnapshot?.background).not.toBe("#123456")
    expect(output("overflow")).toEqual(before.find((o) => o.id === "overflow"))
  })

  it("previews a restore instead of applying the previous scene from the secondary control", async () => {
    original.takeScene(MAIN_OUTPUT_ID, lyrics.id)
    const selection = vi.fn<(value: SceneTakeSelection | null) => void>()
    await render(MAIN_OUTPUT_ID, selection)
    await click(button("Sanctuary: back to its own feed"))
    expect(release).toHaveBeenCalledExactlyOnceWith(MAIN_OUTPUT_ID)
    expect(output(MAIN_OUTPUT_ID).sceneId).toBeUndefined()

    await click(button("Preview restore Lyrics on a picture on Sanctuary"))
    expect(latestSelection(selection)).toMatchObject({ sceneId: "lyr", sceneName: "Lyrics on a picture", outputId: MAIN_OUTPUT_ID })
    expect(output(MAIN_OUTPUT_ID).sceneId).toBeUndefined()
    expect(take).not.toHaveBeenCalled()
  })

  it("keeps disabled own-feed and restore controls focusable with a reason", async () => {
    await render()
    const own = button("Sanctuary: back to its own feed")
    const restore = button("Preview restore scene")
    for (const control of [own, restore]) {
      expect(control.getAttribute("aria-disabled")).toBe("true")
      expect(document.getElementById(control.getAttribute("aria-describedby")!)?.textContent).toBeTruthy()
      await click(control)
    }
    expect(own.title).toBe("Sanctuary already shows its own feed")
    expect(restore.title).toBe("Sanctuary has not shown a scene yet")
    expect(take).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()
  })

  it("keeps the current output unchanged while a service has an approved design", async () => {
    original.takeScene(MAIN_OUTPUT_ID, camera.id)
    useServiceStore.setState({ current: { id: "svc", title: "Sunday", revision: 3, approved_revision: 3, service_date: null, created_at: "", updated_at: "", item_count: 0 } })
    await render()
    const own = button("Sanctuary: back to its own feed")
    expect(own.getAttribute("aria-disabled")).toBe("true")
    expect(document.getElementById(own.getAttribute("aria-describedby")!)?.textContent).toContain("approved design revision")
    await click(own)
    expect(output(MAIN_OUTPUT_ID).sceneId).toBe(camera.id)
    expect(release).not.toHaveBeenCalled()
  })

  it("folds scene details but keeps the Preview selection tied to the chosen output", async () => {
    const before = window.matchMedia
    window.matchMedia = ((q: string) => ({ matches: q === "(max-height: 900px)", media: q, addEventListener() {}, removeEventListener() {} })) as never
    try {
      const verse: Verse = { id: 1, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "Jn", chapter: 3, verse: 16, text: "For God so loved the world" }
      useQueueStore.setState({ items: [{ id: "it-1", reference: "John 3:16", confidence: 1, source: "manual", added_at: 0, verse, scene_id: "cam" }] })
      useBibleStore.setState({ selectedVerse: verse, selectedSlide: null })
      const selection = vi.fn<(value: SceneTakeSelection | null) => void>()
      await render("overflow", selection)

      const toggle = element.querySelector('section[aria-label="Scenes"] > button') as HTMLButtonElement
      const quick = element.querySelector<HTMLElement>('[aria-label="Quick scene controls for Overflow"]')!
      const select = quick.querySelector<HTMLSelectElement>('[aria-label="Choose scene for Overflow"]')!
      expect(toggle.getAttribute("aria-expanded")).toBe("false")
      expect(select.value).toBe("cam")
      expect(latestSelection(selection)).toMatchObject({ outputId: "overflow", sceneId: "cam" })
      expect(quick.textContent).toContain("Private Preview: Camera with the Bible")
      expect(quick.textContent).toContain("Layout: own feed")
      expect(take).not.toHaveBeenCalled()
    } finally {
      window.matchMedia = before
    }
  })

  it("pre-picks the planned scene privately and follows the item shown in Preview", async () => {
    const verse: Verse = { id: 1, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "Jn", chapter: 3, verse: 16, text: "For God so loved the world" }
    const planned: QueueItem = { id: "it-1", reference: "John 3:16", confidence: 1, source: "manual", added_at: 0, verse, scene_id: "lyr" }
    const plain: QueueItem = { ...planned, id: "it-2", reference: "John 3:17", verse: { ...verse, verse: 17 }, scene_id: undefined }
    useQueueStore.setState({ items: [planned, plain] })
    useBibleStore.setState({ selectedVerse: verse, selectedSlide: null, selectedQueueItemId: null })
    const selection = vi.fn<(value: SceneTakeSelection | null) => void>()
    await render(MAIN_OUTPUT_ID, selection)
    expect(sceneButton("Lyrics on a picture").getAttribute("aria-pressed")).toBe("true")
    expect(sceneButton("Lyrics on a picture").getAttribute("aria-label")).toBe("Lyrics on a picture, planned for the item in Preview")
    expect(latestSelection(selection)).toMatchObject({ sceneId: "lyr" })

    await act(async () => useBibleStore.setState({ selectedVerse: { ...verse, verse: 17 }, selectedQueueItemId: null }))
    expect(element.querySelector('[aria-label^="Scenes for"] [aria-pressed="true"]')).toBeNull()
    expect(latestSelection(selection)).toBeNull()
    expect(take).not.toHaveBeenCalled()
  })

  it("rehearsal scene picks stay local until the separate Program action, and revert when rehearsal ends", async () => {
    useBroadcastStore.setState({ outputs: outputs().map((o) => (o.id === MAIN_OUTPUT_ID ? { ...o, sceneId: "lyr" } : o)) })
    useBroadcastStore.getState().setRehearsal(true)
    const selection = vi.fn<(value: SceneTakeSelection | null) => void>()
    await render(MAIN_OUTPUT_ID, selection)
    expect(element.textContent).toContain("Rehearsal: a Take here is practice")
    await click(sceneButton("Camera with the Bible"))
    expect(output(MAIN_OUTPUT_ID).sceneId).toBe("lyr")
    expect(latestSelection(selection)).toMatchObject({ sceneId: "cam" })
    expect(take).not.toHaveBeenCalled()
    await click(button("Sanctuary: back to its own feed"))
    expect(release).toHaveBeenCalledExactlyOnceWith(MAIN_OUTPUT_ID)
    await act(async () => useBroadcastStore.getState().setRehearsal(false))
    expect(output(MAIN_OUTPUT_ID).sceneId).toBe("lyr")
  })
})
