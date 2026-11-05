// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MediaLibrary } from "@/studio/prepare/media-library"
import { useMediaStore } from "@/stores/media-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useSoundStore } from "@/stores/sound-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useListening } from "@/stores/listening-store"
import type { MediaAssetStatus } from "@/types/content"

/**
 * #447, owner decision 5 Nov 2026: Listen plays only on a private output the operator chose and
 * confirmed; never the default. Browsing plays nothing, Live's sound and outputs are untouched, and
 * Stop or a changed output ends it.
 */
let element: HTMLDivElement
let root: Root
const calls: string[] = []
const sound = { id: "a1", kind: "audio", name: "Walk-in.mp3", file: "a1.mp3", hash: "a1", size: 1, mime: "audio/mpeg", width: null, height: null, duration_ms: null, source: "import", source_ref: "", path: "/m/a1", present: true } as MediaAssetStatus

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  calls.length = 0
  const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>
  proto.setSinkId = vi.fn(async function (this: HTMLMediaElement, id: string) { calls.push(`sink:${id}`) })
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async function (this: HTMLMediaElement) { calls.push(`play:${this.getAttribute("src") ?? this.src}`) })
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => { calls.push("pause") })
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {})
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { enumerateDevices: vi.fn(async () => [{ kind: "audiooutput", deviceId: "hp", label: "Desk headphones" }, { kind: "audiooutput", deviceId: "default", label: "Default" }]), addEventListener() {}, removeEventListener() {} } })
  useMediaStore.setState({ assets: [sound], urls: {}, loaded: true, loading: false, error: null, list: vi.fn(async () => [sound]), dataUrl: vi.fn(async () => null), fileUrl: vi.fn(async () => "asset://a1.mp3") } as never)
  useSettingsStore.setState({ auditionOutputId: "", auditionOutputLabel: "", auditionConfirmed: false })
  useListening.setState({ id: null, paused: false, controls: null, error: null })
  element = document.createElement("div")
  document.body.appendChild(element)
  root = createRoot(element)
})

afterEach(() => {
  act(() => root.unmount())
  element.remove()
  vi.restoreAllMocks()
  delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>).setSinkId
})

const listenButton = () => element.querySelector<HTMLButtonElement>('button[aria-label^="Listen to Walk-in.mp3"]')!
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

describe("Library → Sounds: Listen on a private output only (#447)", () => {
  it("browsing plays nothing, and with no private output chosen Listen is off and says why", async () => {
    await act(async () => root.render(<MediaLibrary kinds="audio" />))
    await settle()
    expect(calls).toEqual([])
    expect(listenButton().disabled).toBe(true)
    expect(listenButton().getAttribute("aria-label")).toContain("Choose a private listening output")
    expect(element.textContent).toContain("Set up")
  })

  it("an output chosen but not confirmed off the PA still cannot play", async () => {
    useSettingsStore.setState({ auditionOutputId: "hp", auditionOutputLabel: "Desk headphones", auditionConfirmed: false })
    await act(async () => root.render(<MediaLibrary kinds="audio" />))
    await settle()
    expect(listenButton().disabled).toBe(true)
    expect(listenButton().getAttribute("aria-label")).toContain("not connected to the PA")
  })

  it("on a confirmed private output it sets the output before playing, and leaves Live's sound and outputs alone", async () => {
    useSettingsStore.setState({ auditionOutputId: "hp", auditionOutputLabel: "Desk headphones", auditionConfirmed: true })
    const soundBefore = useSoundStore.getState()
    const live = { isLive: useBroadcastStore.getState().isLive, liveVerse: useBroadcastStore.getState().liveVerse, outputs: useBroadcastStore.getState().outputs }
    await act(async () => root.render(<MediaLibrary kinds="audio" />))
    await settle()
    expect(listenButton().getAttribute("aria-label")).toBe("Listen to Walk-in.mp3 on Desk headphones")
    await act(async () => listenButton().click())
    await settle()
    expect(calls).toEqual(["sink:hp", "play:asset://a1.mp3"])
    expect(useSoundStore.getState()).toEqual(soundBefore)
    expect({ isLive: useBroadcastStore.getState().isLive, liveVerse: useBroadcastStore.getState().liveVerse, outputs: useBroadcastStore.getState().outputs }).toEqual(live)

    await act(async () => element.querySelector<HTMLButtonElement>('button[aria-label="Stop Walk-in.mp3"]')!.click())
    expect(useListening.getState()).toMatchObject({ id: null, controls: null })
    expect(calls).toContain("pause")
  })

  it("changing the private output, or leaving Sounds, ends a listen", async () => {
    useSettingsStore.setState({ auditionOutputId: "hp", auditionOutputLabel: "Desk headphones", auditionConfirmed: true })
    await act(async () => root.render(<MediaLibrary kinds="audio" />))
    await settle()
    await act(async () => listenButton().click())
    await settle()
    expect(useListening.getState().id).toBe("a1")
    await act(async () => useSettingsStore.getState().setAuditionOutput({ auditionOutputId: "other", auditionOutputLabel: "Other" }))
    expect(useListening.getState().id).toBeNull()
    // The new output is not confirmed by the old one's tick.
    expect(useSettingsStore.getState().auditionConfirmed).toBe(false)

    useSettingsStore.setState({ auditionOutputId: "hp", auditionOutputLabel: "Desk headphones", auditionConfirmed: true })
    await settle()
    await act(async () => listenButton().click())
    await settle()
    expect(useListening.getState().id).toBe("a1")
    act(() => root.render(<div />))
    expect(useListening.getState().id).toBeNull()
  })
})
