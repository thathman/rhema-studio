// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/studio/present/rundown-list", () => ({ SlideList: () => null }))
vi.mock("@/components/panels/preview-panel", () => ({ PreviewPanel: () => null }))
vi.mock("@/studio/prepare/timing-rules", () => ({ TimingRules: () => null }))
vi.mock("@/studio/prepare/item-editor-parts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/studio/prepare/item-editor-parts")>()
  return {
    ...actual,
    ...Object.fromEntries([
      "BackgroundPicker", "CommentsEditor", "CueItemEditor", "CustomSlideEditor", "ImageItemControls", "ItemCuesEditor",
      "NoteEditor", "GoLiveCues", "PlannedMinutes", "SongApprovalNote", "TimedAdvance", "SongItemControls",
    ].map((name) => [name, () => null])),
    LookAndScene: () => "LOOK_AND_SCENE_CONTROLS",
    TakeSteps: () => "TAKE_STEPS_CONTROLS",
  }
})

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { AudioQueueItem } from "@/types"
import { useBibleStore } from "@/stores/bible-store"
import { useMediaStore } from "@/stores/media-store"
import { useQueueStore } from "@/stores/queue-store"
import { ItemEditor } from "./item-editor"

const audio: AudioQueueItem = {
  id: "opening-track",
  kind: "audio",
  audio: { media_id: "walkin", name: "Opening track", output_device_id: "usb-output", volume: 0.65, loop: true, fade_in_ms: 500, fade_out_ms: 1500 },
  reference: "Opening track",
  confidence: 1,
  source: "manual",
  added_at: 0,
}

let root: Root | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useQueueStore.setState({ items: [audio], headers: [], activeIndex: null })
  useBibleStore.setState({ selectedVerse: null, selectedSlide: { item: audio, index: 0 }, selectedQueueItemId: audio.id })
  useMediaStore.setState({ assets: [], urls: {}, loaded: true, loading: false, error: null })
  root = createRoot(document.body.appendChild(document.createElement("div")))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe("audio cue editor", () => {
  it("shows local playback settings without scene or Take controls", async () => {
    await act(async () => root!.render(<ItemEditor />))

    expect(document.body.textContent).toContain("Local audio cue · congregation and OBS screens stay unchanged.")
    expect(document.querySelector('[aria-label="Audio cue volume"]')).toHaveProperty("value", "0.65")
    expect(document.querySelector('[aria-label="Audio fade in seconds"]')).toHaveProperty("value", "0.5")
    expect(document.querySelector('[aria-label="Audio fade out seconds"]')).toHaveProperty("value", "1.5")
    expect(document.body.textContent).not.toContain("LOOK_AND_SCENE_CONTROLS")

    const signalsTab = Array.from(document.querySelectorAll('[role="tab"]')).find((tab) => tab.textContent === "Signals")
    expect(signalsTab).toBeTruthy()
    await act(async () => (signalsTab as HTMLElement).click())
    expect(document.body.textContent).not.toContain("TAKE_STEPS_CONTROLS")
  })
})
