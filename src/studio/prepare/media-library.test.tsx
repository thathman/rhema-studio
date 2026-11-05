// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MediaLibrary } from "./media-library"
import { useMediaStore } from "@/stores/media-store"
import type { MediaAssetStatus } from "@/types/content"

/** #447: Library has a Sounds section of its own; Pictures & videos shows no sounds; Prepare's Add picker shows all. */
let element: HTMLDivElement
let root: Root

const asset = (id: string, kind: MediaAssetStatus["kind"], name: string): MediaAssetStatus => ({
  id, kind, name, file: `${id}.bin`, hash: id, size: 10, mime: kind === "audio" ? "audio/mpeg" : "image/png", width: kind === "image" ? 1920 : null, height: kind === "image" ? 1080 : null,
  duration_ms: null, source: "import", source_ref: "", path: `/media/${id}`, present: true,
} as MediaAssetStatus)

const assets = [asset("a1", "audio", "Walk-in music.mp3"), asset("i1", "image", "Welcome.png")]

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  element = document.createElement("div")
  document.body.appendChild(element)
  root = createRoot(element)
  useMediaStore.setState({ assets, urls: {}, loaded: true, loading: false, error: null, list: vi.fn(async () => assets), dataUrl: vi.fn(async () => null) } as never)
})

afterEach(() => {
  act(() => root.unmount())
  element.remove()
})

const text = () => element.textContent ?? ""

describe("the media library's kinds (#447)", () => {
  it("Sounds: only the sounds, with Add, and an import for sounds", async () => {
    const onUseItem = vi.fn()
    await act(async () => root.render(<MediaLibrary kinds="audio" onUseItem={onUseItem} />))
    expect(element.querySelector('[aria-label="Sounds"]')).not.toBeNull()
    expect(element.querySelector('[aria-label="Pictures"]')).toBeNull()
    expect(text()).toContain("Walk-in music.mp3")
    expect(text()).not.toContain("Welcome.png")
    expect(text()).toContain("Import sounds…")
    act(() => [...element.querySelectorAll("button")].find((b) => b.textContent?.includes("Add"))!.click())
    expect(onUseItem).toHaveBeenCalledWith(expect.objectContaining({ kind: "audio" }), expect.anything())
  })

  it("Pictures & videos: no sounds", async () => {
    await act(async () => root.render(<MediaLibrary kinds="visual" />))
    expect(text()).toContain("Welcome.png")
    expect(text()).not.toContain("Walk-in music.mp3")
    expect(text()).toContain("Import pictures or videos…")
  })

  it("Prepare's Add picker: everything, as before", async () => {
    await act(async () => root.render(<MediaLibrary />))
    expect(text()).toContain("Welcome.png")
    expect(text()).toContain("Walk-in music.mp3")
  })

  it("Sounds says so when there are none", async () => {
    useMediaStore.setState({ assets: [assets[1]!], list: vi.fn(async () => [assets[1]!]) } as never)
    await act(async () => root.render(<MediaLibrary kinds="audio" />))
    expect(text()).toContain("No sounds yet")
  })
})
