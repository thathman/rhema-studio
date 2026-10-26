// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ScenesStrip, SCENES_FOLDED_QUERY, SCENES_REHEARSAL_NOTE } from "./scenes-strip"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { SCENE_PRESETS, newScene } from "@/lib/scenes"
import { MAIN_OUTPUT_ID, defaultNdiSettings, type BroadcastOutput, type QueueItem, type Verse } from "@/types"
import { useBibleStore } from "@/stores/bible-store"
import { useQueueStore } from "@/stores/queue-store"
import { useSettingsStore } from "@/stores/settings-store"

const original = { takeScene: useBroadcastStore.getState().takeScene, releaseScene: useBroadcastStore.getState().releaseScene }
const camera = { ...newScene("Camera with the Bible", SCENE_PRESETS[3]), id: "cam" }
const lyrics = { ...newScene("Lyrics on a picture", SCENE_PRESETS[2]), id: "lyr" }
let el: HTMLDivElement
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

const button = (label: string) => el.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement
const sceneButton = (name: string) => [...el.querySelectorAll('[aria-label^="Scenes for"] button')].find((b) => b.getAttribute("aria-label")?.startsWith(name)) as HTMLButtonElement
const output = (id: string) => useBroadcastStore.getState().outputs.find((o) => o.id === id)!
const click = (b: HTMLElement) => act(async () => b.click())

async function render() {
  await act(async () => root.render(<ScenesStrip />))
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  take = vi.fn<State["takeScene"]>(original.takeScene)
  release = vi.fn<State["releaseScene"]>(original.releaseScene)
  useBroadcastStore.setState({ outputs: outputs(), scenes: [camera, lyrics], sceneReturn: {}, sources: {}, isLive: false, liveVerse: null, rehearsal: false, takeScene: take, releaseScene: release })
  el = document.createElement("div")
  document.body.appendChild(el)
  root = createRoot(el)
})

afterEach(() => {
  act(() => root.unmount())
  el.remove()
  useQueueStore.setState({ items: [] })
  useBibleStore.setState({ selectedVerse: null, selectedSlide: null })
  useBroadcastStore.setState({ ...original, rehearsal: false })
})

describe("Present's scenes", () => {
  it("stays out of the way until there is a congregation screen and a saved scene", async () => {
    useBroadcastStore.setState({ scenes: [] })
    await render()
    expect(el.textContent).toBe("")
    await act(async () => useBroadcastStore.setState({ scenes: [camera], outputs: outputs().filter((o) => o.role === "stage") }))
    expect(el.textContent).toBe("")
    await act(async () => useBroadcastStore.setState({ outputs: outputs() }))
    expect(el.textContent).toContain("Sanctuary: its own feed")
  })

  it("takes the picked scene to the chosen congregation screen, and only there", async () => {
    await render()
    // Only congregation screens can take scenes: the stage screen is not offered.
    const screens = [...el.querySelectorAll('[aria-label="Which screen"] button')].map((b) => b.textContent)
    expect(screens).toEqual(["Sanctuary", "Overflow"])
    await click(sceneButton("Camera with the Bible"))
    await click(button("Take scene Camera with the Bible to Sanctuary"))
    expect(take).toHaveBeenCalledExactlyOnceWith(MAIN_OUTPUT_ID, "cam")
    expect(output(MAIN_OUTPUT_ID).sceneId).toBe("cam")
    expect(output("overflow").sceneId).toBeUndefined()
    expect(sceneButton("Camera with the Bible").getAttribute("aria-label")).toBe("Camera with the Bible, on air")

    await click([...el.querySelectorAll('[aria-label="Which screen"] button')].find((b) => b.textContent === "Overflow") as HTMLButtonElement)
    await click(sceneButton("Lyrics on a picture"))
    await click(button("Take scene Lyrics on a picture to Overflow"))
    expect(take).toHaveBeenLastCalledWith("overflow", "lyr")
    expect(output(MAIN_OUTPUT_ID).sceneId).toBe("cam")
    expect(el.textContent).toContain("Sanctuary: Camera with the Bible · Overflow: Lyrics on a picture")
  })

  it("goes back to the screen's own feed and restores the last scene", async () => {
    await render()
    await click(sceneButton("Lyrics on a picture"))
    await click(button("Take scene Lyrics on a picture to Sanctuary"))
    await click(button("Sanctuary: back to its own feed"))
    expect(release).toHaveBeenCalledExactlyOnceWith(MAIN_OUTPUT_ID)
    expect(output(MAIN_OUTPUT_ID).sceneId).toBeUndefined()
    await click(button("Restore Lyrics on a picture on Sanctuary"))
    expect(take).toHaveBeenLastCalledWith(MAIN_OUTPUT_ID, "lyr")
    expect(output(MAIN_OUTPUT_ID).sceneId).toBe("lyr")
  })

  it("shows the taken revision and permits an explicit Take of a saved edit", async () => {
    useSettingsStore.setState({ operatorName: "Tolu" })
    const taken = { ...camera, name: "Taken camera layout", updatedAt: Date.UTC(2026, 9, 25, 10) }
    const saved = { ...camera, name: "Edited camera layout", updatedAt: Date.UTC(2026, 9, 26, 11) }
    await act(async () => useBroadcastStore.setState({
      scenes: [saved],
      outputs: outputs().map((o) => o.id === MAIN_OUTPUT_ID ? { ...o, sceneId: camera.id, sceneSnapshot: taken } : o),
    }))
    await render()
    expect(el.textContent).toContain("Shows Taken camera layout")
    await click(sceneButton("Edited camera layout"))
    const takeUpdated = button("Take scene Edited camera layout to Sanctuary")
    const details = el.querySelector('[aria-label="Take details"]')
    expect(details?.textContent).toContain("Affected output: Sanctuary only")
    expect(details?.textContent).toContain(`Revision: ${new Date(saved.updatedAt).toLocaleString()}`)
    expect(details?.textContent).toContain("Actor: Tolu")
    expect(takeUpdated.getAttribute("aria-describedby")).toBe(details?.id)
    expect(takeUpdated.getAttribute("aria-disabled")).toBeNull()
    expect(take).not.toHaveBeenCalled()
    await click(takeUpdated)
    expect(take).toHaveBeenLastCalledWith(MAIN_OUTPUT_ID, camera.id)
    expect(output(MAIN_OUTPUT_ID).sceneSnapshot?.name).toBe("Edited camera layout")
  })

  it("says why a button cannot act, and a click on it does nothing", async () => {
    await render()
    const takeBtn = button("Take scene")
    const own = button("Sanctuary: back to its own feed")
    const restore = button("Restore scene")
    for (const b of [takeBtn, own, restore]) {
      expect(b.getAttribute("aria-disabled")).toBe("true")
      expect(document.getElementById(b.getAttribute("aria-describedby")!)?.textContent).toBeTruthy()
      await click(b)
    }
    expect(takeBtn.title).toBe("Pick a scene above first")
    expect(own.title).toBe("Sanctuary already shows its own feed")
    expect(restore.title).toBe("Sanctuary has not shown a scene yet")
    expect(take).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()
    // The scene already on the screen cannot be taken again.
    await act(async () => useBroadcastStore.setState({ outputs: outputs().map((o) => (o.id === MAIN_OUTPUT_ID ? { ...o, sceneId: "cam" } : o)) }))
    await click(sceneButton("Camera with the Bible"))
    expect(button("Take scene Camera with the Bible to Sanctuary").title).toBe("Sanctuary already shows Camera with the Bible")
  })

  it("in rehearsal, a Take is practice: it shows here, and the real scene comes back after", async () => {
    useBroadcastStore.setState({ outputs: outputs().map((o) => (o.id === MAIN_OUTPUT_ID ? { ...o, sceneId: "lyr" } : o)) })
    useBroadcastStore.getState().setRehearsal(true)
    await render()
    expect(el.textContent).toContain(SCENES_REHEARSAL_NOTE)
    await click(sceneButton("Camera with the Bible"))
    expect(el.querySelector('[aria-label="Take details"]')?.textContent).toContain("Scope: rehearsal only; the public screen stays unchanged")
    const takeBtn = button("Take scene Camera with the Bible to Sanctuary")
    expect(takeBtn.getAttribute("aria-disabled")).toBeNull()
    await click(takeBtn)
    expect(take).toHaveBeenCalledExactlyOnceWith(MAIN_OUTPUT_ID, "cam")
    // Never called on air while rehearsing.
    expect(sceneButton("Camera with the Bible").getAttribute("aria-label")).toBe("Camera with the Bible, in rehearsal")
    expect(el.textContent).not.toContain("On air")
    await click(button("Sanctuary: back to its own feed"))
    expect(release).toHaveBeenCalledExactlyOnceWith(MAIN_OUTPUT_ID)
    await act(async () => useBroadcastStore.getState().setRehearsal(false))
    expect(output(MAIN_OUTPUT_ID).sceneId).toBe("lyr")
    expect(el.textContent).not.toContain(SCENES_REHEARSAL_NOTE)
  })

  it("a scene Take changes the layout only: nothing else goes live", async () => {
    const verse = { reference: "Romans 8:28", segments: [], content: "bible" as const }
    useBroadcastStore.getState().activateSource(verse)
    useBroadcastStore.getState().clearSource("bible")
    const before = useBroadcastStore.getState()
    await render()
    await click(sceneButton("Camera with the Bible"))
    // Distinct from Take live: its own words and a scene icon, never the solid Take live button.
    const takeBtn = button("Take scene Camera with the Bible to Sanctuary")
    expect(takeBtn.textContent).toBe("Take scene")
    expect(takeBtn.className).not.toContain("bg-primary ")
    await click(takeBtn)
    const after = useBroadcastStore.getState()
    expect(after.isLive).toBe(false)
    expect(after.liveVerse).toBeNull()
    expect(after.sources).toBe(before.sources)
    expect(after.sources.bible?.on).toBe(false)
    expect(after.outputs.filter((o) => o.sceneId).map((o) => o.id)).toEqual([MAIN_OUTPUT_ID])
  })

  it("starts folded on a short window, so the Live panel keeps its room, and opens with one click", async () => {
    const before = window.matchMedia
    window.matchMedia = ((q: string) => ({ matches: q === SCENES_FOLDED_QUERY, media: q, addEventListener() {}, removeEventListener() {} })) as never
    try {
      await render()
      const toggle = el.querySelector('section[aria-label="Scenes"] > button') as HTMLButtonElement
      expect(toggle.getAttribute("aria-expanded")).toBe("false")
      expect(el.querySelector('[aria-label^="Scenes for"]')).toBeNull()
      // The fold still says what each screen shows.
      expect(toggle.textContent).toContain("Sanctuary: its own feed")
      await click(toggle)
      expect(toggle.getAttribute("aria-expanded")).toBe("true")
      expect(el.querySelector('[aria-label^="Scenes for"]')).not.toBeNull()
    } finally {
      window.matchMedia = before
    }
  })

  it("pre-picks the scene planned for the item in Preview, and leaves the Take to the operator", async () => {
    const verse: Verse = { id: 1, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "Jn", chapter: 3, verse: 16, text: "For God so loved the world" }
    const sermon: QueueItem = { id: "it-1", reference: "John 3:16", confidence: 1, source: "manual", added_at: 0, verse, scene_id: "lyr" }
    const plain: QueueItem = { ...sermon, id: "it-2", reference: "John 3:17", verse: { ...verse, verse: 17 }, scene_id: undefined }
    useQueueStore.setState({ items: [sermon, plain] })
    useBibleStore.setState({ selectedVerse: verse, selectedSlide: null })
    await render()
    expect(sceneButton("Lyrics on a picture").getAttribute("aria-pressed")).toBe("true")
    expect(sceneButton("Lyrics on a picture").getAttribute("aria-label")).toBe("Lyrics on a picture, planned for the item in Preview")
    expect(take).not.toHaveBeenCalled()

    // The operator's own pick holds while Preview stays on that item.
    await click(sceneButton("Camera with the Bible"))
    expect(sceneButton("Camera with the Bible").getAttribute("aria-pressed")).toBe("true")
    expect(sceneButton("Lyrics on a picture").getAttribute("aria-pressed")).toBe("false")
    await click(sceneButton("Camera with the Bible"))
    expect(button("Take scene").getAttribute("aria-disabled")).toBe("true")

    // A different item in Preview: its plan (none here) decides again.
    await act(async () => useBibleStore.setState({ selectedVerse: { ...verse, verse: 17 } }))
    expect(el.querySelector('[aria-label^="Scenes for"] [aria-pressed="true"]')).toBeNull()
    await act(async () => useBibleStore.setState({ selectedVerse: verse }))
    await click(button("Take scene Lyrics on a picture to Sanctuary"))
    expect(take).toHaveBeenCalledExactlyOnceWith(MAIN_OUTPUT_ID, "lyr")
    // Now on the screen: nothing left to pre-pick.
    expect(el.querySelector('[aria-label^="Scenes for"] [aria-pressed="true"]')).toBeNull()
  })

  it("folded, says which scene the item in Preview is planned with", async () => {
    const before = window.matchMedia
    window.matchMedia = ((q: string) => ({ matches: q === SCENES_FOLDED_QUERY, media: q, addEventListener() {}, removeEventListener() {} })) as never
    try {
      const verse: Verse = { id: 1, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "Jn", chapter: 3, verse: 16, text: "" }
      useQueueStore.setState({ items: [{ id: "it-1", reference: "John 3:16", confidence: 1, source: "manual", added_at: 0, verse, scene_id: "cam" }] })
      useBibleStore.setState({ selectedVerse: verse, selectedSlide: null })
      await render()
      expect(el.querySelector('section[aria-label="Scenes"] > button')?.textContent).toContain("Preview's item: Camera with the Bible")
    } finally {
      window.matchMedia = before
    }
  })
})
