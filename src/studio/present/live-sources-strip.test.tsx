// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { LiveSourcesStrip } from "./live-sources-strip"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import { MAIN_OUTPUT_ID, defaultNdiSettings } from "@/types"

describe("Present's live sources strip", () => {
  it("appears only when an output follows chosen sources, and takes one source off and back", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const themeId = useBroadcastStore.getState().themes[0].id
    const main = { id: MAIN_OUTPUT_ID, name: "Main", type: "display" as const, themeId, monitorIndex: 0, ndi: defaultNdiSettings() }
    useBroadcastStore.setState({ outputs: [main], sources: {}, isLive: false, liveVerse: null, rehearsal: false })
    const el = document.createElement("div")
    const root = createRoot(el)
    await act(async () => root.render(<LiveSourcesStrip />))
    expect(el.textContent).toBe("")
    await act(async () => {
      useBroadcastStore.setState({ outputs: [main, { ...main, id: "l3", name: "Bible L3", type: "ndi", shows: ["bible"] }] })
      useBroadcastStore.getState().activateSource({ reference: "Romans 8:28", segments: [], content: "bible" })
    })
    expect(el.textContent).toContain("Romans 8:28")
    expect(el.textContent).toContain("1 feed")
    await act(async () => (el.querySelector('[aria-label^="Take Bible"]') as HTMLButtonElement).click())
    expect(useBroadcastStore.getState().sources.bible?.on).toBe(false)
    await act(async () => (el.querySelector('[aria-label^="Restore Bible"]') as HTMLButtonElement).click())
    expect(useBroadcastStore.getState().sources.bible?.on).toBe(true)
    root.unmount()
  })

  it("reviews exact saved-scene and current-output camera impact before Hide or Restore", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const themeId = useBroadcastStore.getState().themes[0].id
    const main = { id: MAIN_OUTPUT_ID, name: "Sanctuary", type: "display" as const, themeId, monitorIndex: 0, ndi: defaultNdiSettings(), sceneId: "sermon" }
    const overflow = { ...main, id: "overflow", name: "Overflow", type: "ndi" as const, sceneId: "wide" }
    const stage = { ...main, id: "stage", name: "Stage Confidence", role: "stage" as const, sceneId: "stage" }
    const layers = [{ id: "pulpit", name: "Pulpit camera", kind: "camera" as const, cameraUrl: "http://192.168.1.20:8889/pulpit/whep", box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, visible: true }]
    useSettingsStore.getState().setCameras([{ name: "pulpit", label: "Pulpit", token: "test-only" }])
    useBroadcastStore.setState({
      outputs: [main, overflow, stage],
      scenes: [
        { id: "sermon", name: "Sermon split", background: "#000000", createdAt: 0, updatedAt: 0, layers },
        { id: "wide", name: "Wide shot", background: "#000000", createdAt: 0, updatedAt: 0, layers },
        { id: "stage", name: "Stage close-up", background: "#000000", createdAt: 0, updatedAt: 0, layers },
        { id: "unused", name: "Unused design", background: "#000000", createdAt: 0, updatedAt: 0, layers: [] },
      ],
      stateSources: { "camera:pulpit": { revision: 4, activatedAt: 0, on: true } },
      rehearsal: false,
    })
    const el = document.createElement("div")
    const root = createRoot(el)
    await act(async () => root.render(<LiveSourcesStrip />))

    await act(async () => (el.querySelector('[aria-label="Review hiding Pulpit camera from scenes"]') as HTMLButtonElement).click())
    const review = el.querySelector('[role="alertdialog"]')!
    expect(review.textContent).toContain("Sermon split")
    expect(review.textContent).toContain("Wide shot")
    expect(review.textContent).toContain("Sanctuary (Sermon split)")
    expect(review.textContent).toContain("Overflow (Wide shot)")
    expect(review.textContent).toContain("Stage Confidence (Stage close-up)")
    expect(review.textContent).toContain("OBS camera inputs are unchanged")
    expect(review.textContent).not.toContain("Unused design")
    expect(useBroadcastStore.getState().stateSources["camera:pulpit"]?.on).toBe(true)

    await act(async () => ([...review.querySelectorAll("button")].find((button) => button.textContent?.includes("Hide in all listed scenes")) as HTMLButtonElement).click())
    expect(useBroadcastStore.getState().stateSources["camera:pulpit"]?.on).toBe(false)

    await act(async () => (el.querySelector('[aria-label="Review showing Pulpit camera in scenes"]') as HTMLButtonElement).click())
    expect(el.querySelector('[role="alertdialog"]')?.textContent).toContain("will restore this source")
    await act(async () => ([...el.querySelectorAll('[role="alertdialog"] button')].find((button) => button.textContent?.includes("Restore in all listed scenes")) as HTMLButtonElement).click())
    expect(useBroadcastStore.getState().stateSources["camera:pulpit"]?.on).toBe(true)
    root.unmount()
  })

  it("includes the exact scene snapshot currently assigned to an output", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const themeId = useBroadcastStore.getState().themes[0].id
    const atTake = { id: "sermon", name: "Sermon at Take", background: "#000000", createdAt: 0, updatedAt: 1, layers: [{ id: "pulpit", name: "Pulpit camera", kind: "camera" as const, cameraUrl: "http://192.168.1.20:8889/pulpit/whep", box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, visible: true }] }
    const main = { id: MAIN_OUTPUT_ID, name: "Sanctuary", type: "display" as const, themeId, monitorIndex: 0, ndi: defaultNdiSettings(), sceneId: "sermon", sceneSnapshot: atTake }
    useSettingsStore.getState().setCameras([{ name: "pulpit", label: "Pulpit", token: "test-only" }])
    useBroadcastStore.setState({
      outputs: [main],
      scenes: [{ id: "sermon", name: "Current saved scene", background: "#000000", createdAt: 0, updatedAt: 2, layers: [] }],
      stateSources: { "camera:pulpit": { revision: 4, activatedAt: 0, on: true } },
      rehearsal: false,
    })
    const el = document.createElement("div")
    const root = createRoot(el)
    await act(async () => root.render(<LiveSourcesStrip />))
    await act(async () => (el.querySelector('[aria-label="Review hiding Pulpit camera from scenes"]') as HTMLButtonElement).click())
    const review = el.querySelector('[role="alertdialog"]')!
    expect(review.textContent).toContain("None in the saved scene list.")
    expect(review.textContent).toContain("Sanctuary (Sermon at Take)")
    root.unmount()
  })

  it("blocks camera availability changes when scene usage changes during impact review", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const themeId = useBroadcastStore.getState().themes[0].id
    const main = { id: MAIN_OUTPUT_ID, name: "Sanctuary", type: "display" as const, themeId, monitorIndex: 0, ndi: defaultNdiSettings(), sceneId: "sermon" }
    const layers = [{ id: "pulpit", name: "Pulpit camera", kind: "camera" as const, cameraUrl: "http://192.168.1.20:8889/pulpit/whep", box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, visible: true }]
    useSettingsStore.getState().setCameras([{ name: "pulpit", label: "Pulpit", token: "test-only" }])
    useBroadcastStore.setState({
      outputs: [main],
      scenes: [{ id: "sermon", name: "Sermon split", background: "#000000", createdAt: 0, updatedAt: 0, layers }],
      stateSources: { "camera:pulpit": { revision: 4, activatedAt: 0, on: true } },
      rehearsal: false,
    })
    const el = document.createElement("div")
    const root = createRoot(el)
    await act(async () => root.render(<LiveSourcesStrip />))
    await act(async () => (el.querySelector('[aria-label="Review hiding Pulpit camera from scenes"]') as HTMLButtonElement).click())
    await act(async () => useBroadcastStore.setState({ outputs: [{ ...main, sceneId: undefined }] }))

    const confirm = [...el.querySelectorAll('[role="alertdialog"] button')].find((button) => button.textContent?.includes("Hide in all listed scenes")) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("changed while you were reviewing")
    expect(useBroadcastStore.getState().stateSources["camera:pulpit"]?.on).toBe(true)
    root.unmount()
  })
})
