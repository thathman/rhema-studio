// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

// jsdom has no ResizeObserver (the drag-and-drop library needs one at import), CSS.escape or scrollIntoView.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  ;(globalThis as { CSS?: { escape: (s: string) => string } }).CSS ??= { escape: (s: string) => s }
})
// Lists come back empty; anything else has nothing to say.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (cmd: string) => (cmd.endsWith("_list") ? [] : null)) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}), emit: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { PrepareWorkspace } from "./prepare-workspace"
import { saveStateOf } from "./save-state"
import { useQueueStore } from "@/stores/queue-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useServiceStore } from "@/stores/service-store"
import { useShellStore } from "@/studio/shell-store"
import { presentActions } from "@/studio/present-actions"
import type { QueueItem } from "@/types"

const slide = (id: string): QueueItem =>
  ({ id, kind: "slide", slide: { title: id, body: "words" }, reference: id, confidence: 1, source: "manual", added_at: 0, planned_minutes: 3 }) as unknown as QueueItem

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function renderPrepare() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const el = document.createElement("div")
  document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => root!.render(<PrepareWorkspace />))
  return el
}

describe("Prepare never takes anything live (#299)", () => {
  it("clicking, double-clicking and keys on rundown items only preview", async () => {
    useQueueStore.setState({
      items: [slide("Welcome"), slide("Notices"), slide("Blessing")],
      headers: [{ id: "main", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main", starts_at: "10:00" }],
      activeIndex: null,
    })
    useBroadcastStore.setState({ isLive: false, liveVerse: null, liveSlide: null, liveItemId: null })
    const goLive = (["showLive", "presentItem", "next", "prev", "quickScreen", "verseNext", "versePrev"] as const).map((k) => vi.spyOn(presentActions, k))

    const el = await renderPrepare()
    const rows = [...el.querySelectorAll<HTMLButtonElement>('ol[aria-label="Service rundown"] button[title="Click to preview"]')]
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      await act(async () => {
        row.click()
        row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
      })
    }
    // Present's keys do nothing here either.
    for (const key of ["ArrowRight", "PageDown", "ArrowLeft", " ", "Enter", "Escape"]) {
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
      })
    }
    // The phase strip only scrolls the rundown.
    Element.prototype.scrollIntoView ??= () => {}
    for (const phase of el.querySelectorAll<HTMLButtonElement>('[aria-label="Phases"] button')) {
      await act(async () => phase.click())
    }

    const b = useBroadcastStore.getState()
    expect(b.isLive).toBe(false)
    expect(b.liveVerse).toBeNull()
    expect(b.liveSlide).toBeNull()
    expect(b.liveItemId).toBeNull()
    for (const spy of goLive) expect(spy).not.toHaveBeenCalled()
    goLive.forEach((s) => s.mockRestore())
  })

  it("Present service opens the live console without showing anything", async () => {
    useQueueStore.setState({ items: [slide("Welcome")], headers: [], activeIndex: null })
    useBroadcastStore.setState({ isLive: false, liveVerse: null, liveItemId: null })
    useShellStore.setState({ workspace: "prepare" })
    const el = await renderPrepare()
    const present = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Present service"))!
    await act(async () => present.click())
    expect(useShellStore.getState().workspace).toBe("present")
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })

  it("says whether the service is saved, next to its name", async () => {
    useQueueStore.setState({ items: [slide("Welcome")], headers: [], activeIndex: null })
    useServiceStore.setState({ current: null, dirty: false, saving: false })
    const el = await renderPrepare()
    expect(el.textContent).toContain("Items not saved as a service")
    expect(el.textContent).toContain("Not saved as a service")
  })
})

describe("saveStateOf", () => {
  const svc = { title: "Sunday" }
  it("names each state in words", () => {
    expect(saveStateOf({ current: svc, dirty: false, saving: false, count: 3 }).label).toBe("Saved")
    expect(saveStateOf({ current: svc, dirty: true, saving: false, count: 3 }).label).toBe("Unsaved changes")
    expect(saveStateOf({ current: svc, dirty: true, saving: true, count: 3 }).label).toBe("Saving…")
    expect(saveStateOf({ current: null, dirty: false, saving: false, count: 2 }).label).toBe("Not saved as a service")
    expect(saveStateOf({ current: null, dirty: false, saving: false, count: 0 }).label).toBe("No service open")
  })
})
