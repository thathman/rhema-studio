// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.hoisted(() => {
  const context = { font: "", measureText: (value: string) => ({ width: value.length * 8 }) }
  if (typeof HTMLCanvasElement !== "undefined") HTMLCanvasElement.prototype.getContext = (() => context) as never
})

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { useObsStore } from "@/stores/obs-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useShellStore } from "@/studio/shell-store"
import { useProductionTab } from "@/studio/production/production-tab"
import { ObsChip } from "./obs-chip"

const initialObs = useObsStore.getState()
const initialSettings = useSettingsStore.getState().obs
let root: Root | null = null
let element: HTMLDivElement

async function render() {
  element = document.createElement("div")
  document.body.append(element)
  root = createRoot(element)
  await act(async () => root!.render(<ObsChip />))
}

describe("Live OBS status", () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useSettingsStore.setState({ obs: { ...initialSettings, enabled: false } })
    useObsStore.setState({ status: "off", error: null, recording: null })
    useProductionTab.setState({ requested: null, selected: "timekeeper", scene: null, open: false, liveToolsTab: "bible" })
    useShellStore.setState({ workspace: "home", goRequest: null })
  })

  afterEach(() => {
    if (root) act(() => root!.unmount())
    root = null
    element?.remove()
    useSettingsStore.setState({ obs: initialSettings })
    useObsStore.setState(initialObs)
    useProductionTab.setState({ requested: null, selected: "timekeeper", scene: null, open: false, liveToolsTab: "bible" })
    useShellStore.setState({ workspace: "home", goRequest: null })
  })

  it("hides healthy idle OBS but keeps recording and connection exceptions actionable", async () => {
    useSettingsStore.setState({ obs: { ...initialSettings, enabled: true } })
    useObsStore.setState({ status: "connected", error: null, recording: { active: false, paused: false, timecode: null } })
    await render()
    expect(element.querySelector("button")).toBeNull()

    await act(async () => useObsStore.setState({ recording: { active: true, paused: false, timecode: "00:05:01.000" } }))
    const recording = element.querySelector<HTMLButtonElement>("button")!
    expect(recording.textContent).toContain("OBS recording 00:05:01")
    await act(async () => recording.click())
    expect(useProductionTab.getState()).toMatchObject({ requested: "obs", selected: "obs", open: true, liveToolsTab: "production" })
    expect(useShellStore.getState().goRequest).toBe("present")

    await act(async () => useObsStore.setState({ status: "error", error: "Connection refused", recording: null }))
    const failed = element.querySelector<HTMLButtonElement>("button")!
    expect(failed.textContent).toContain("OBS unavailable")
    expect(failed.title).toContain("Connection refused")
  })

  it("keeps an enabled OBS connection with unknown recording state visible", async () => {
    useSettingsStore.setState({ obs: { ...initialSettings, enabled: true } })
    useObsStore.setState({ status: "connected", error: null, recording: null })
    await render()
    expect(element.querySelector("button")?.textContent).toContain("OBS status unknown")
  })
})
