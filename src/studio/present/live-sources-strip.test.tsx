// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { LiveSourcesStrip } from "./live-sources-strip"
import { useBroadcastStore } from "@/stores/broadcast-store"
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
})
