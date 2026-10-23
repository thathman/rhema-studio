// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

const { emitTo, feed } = vi.hoisted(() => ({ emitTo: vi.fn(async (...a: unknown[]) => void a), feed: { watching: 1, seq: 3, acked: 3 } }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (cmd: string) => (cmd === "feed_status" ? feed : null)) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo }))
vi.mock("@tauri-apps/api/window", () => ({ availableMonitors: vi.fn(async () => [{ name: "Built-in", size: { width: 2880, height: 1800 } }, { name: "Projector", size: { width: 1280, height: 720 } }]) }))
// jsdom has no canvas: the pattern is a fixed picture here (its drawing is tested in lib/test-pattern).
vi.mock("@/lib/test-pattern", async (orig) => ({ ...(await orig<typeof import("@/lib/test-pattern")>()), testPatternUrl: () => "data:image/png;base64,TEST" }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ScreenTestRow } from "./screen-test"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { usePhaseRun } from "@/stores/phase-run-store"
import type { BroadcastOutput } from "@/types"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ndi = { sourceName: "Rhema", resolution: "r720p", frameRate: "fps30", alphaMode: "straightAlpha" } as const
const projector: BroadcastOutput = { id: "main", name: "Projector", type: "display", themeId: "x", monitorIndex: 1, monitorName: "Projector", ndi }
const lobby: BroadcastOutput = { id: "tv", name: "Lobby TV", type: "browser", themeId: "x", monitorIndex: 0, ndi, feedToken: "0123456789abcdef0123" }

let root: Root | null = null
async function render(output: BroadcastOutput) {
  const el = document.createElement("div")
  document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => root!.render(<ul><ScreenTestRow output={output} item={undefined} /></ul>))
}
const button = (t: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(t)) as HTMLButtonElement | undefined
const click = async (t: string) => {
  const b = button(t)
  if (!b) throw new Error(`no button “${t}”`)
  await act(async () => b.click())
}
const frames = (label: string) => (emitTo.mock.calls as unknown[][]).filter((c) => c[0] === label && c[1] === "broadcast:verse-update").map((c) => c[2] as { theme: { id: string; resolution: { width: number; height: number } } })

beforeEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = null
  document.body.replaceChildren()
  const b = useBroadcastStore.getState()
  for (const id of Object.keys(b.outputTests)) b.endOutputTest(id)
  useBroadcastStore.setState({ outputs: [projector, lobby], outputStatus: { main: { previewOpen: true, ndiActive: false } }, isLive: false, liveVerse: null, rehearsal: false })
  usePhaseRun.setState({ run: null })
  Object.assign(feed, { watching: 1, seq: 3, acked: 3 })
  emitTo.mockClear()
})

describe("Test this screen (#298 scenario F)", () => {
  it("is offered only for an output that is on", async () => {
    useBroadcastStore.setState({ outputStatus: {} })
    await render(projector)
    expect(button("Test this screen")?.disabled).toBe(true)
  })

  it("shows nothing until it is confirmed; Cancel changes nothing", async () => {
    await render(projector)
    await click("Test this screen")
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Show a test pattern on Projector?")
    expect(frames("broadcast-main")).toEqual([])
    await click("Cancel")
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(frames("broadcast-main")).toEqual([])
    expect(useBroadcastStore.getState().outputTests).toEqual({})
  })

  it("after confirming, the pattern goes to this output only, at its screen's size, until End test", async () => {
    await render(projector)
    await click("Test this screen")
    await click("Show test pattern")
    const sent = frames("broadcast-main")
    expect(sent).toHaveLength(1)
    expect(sent[0].theme.id).toBe("screen-test")
    expect(sent[0].theme.resolution).toEqual({ width: 1280, height: 720 })
    expect(emitTo.mock.calls.every((c) => (c as unknown[])[0] === "broadcast-main")).toBe(true)
    expect(document.body.textContent).toContain("Test showing")
    expect(document.activeElement?.textContent).toContain("End test")
    await click("End test")
    expect(useBroadcastStore.getState().outputTests).toEqual({})
    expect(document.body.textContent).not.toContain("Test showing")
  })

  it("while something is on air it asks a second time before showing anything", async () => {
    useBroadcastStore.setState({ isLive: true, liveVerse: { reference: "John 3:16", segments: [] } })
    await render(projector)
    await click("Test this screen")
    await click("Show test pattern")
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("People may be watching this output")
    expect(document.body.textContent).toContain("Something is on air now")
    expect(useBroadcastStore.getState().outputTests).toEqual({})
    await click("Show it anyway")
    expect(useBroadcastStore.getState().outputTests.main).toBeTypeOf("number")
  })

  it("a running service (not a rehearsal) also asks again", async () => {
    usePhaseRun.setState({ run: { headerId: "h", itemId: null, startsAt: null, nextAt: null } as never })
    await render(projector)
    await click("Test this screen")
    await click("Show test pattern")
    expect(button("Show it anyway")).toBeDefined()
  })

  it("leaving the step (or closing the setup) ends the test", async () => {
    await render(projector)
    await click("Test this screen")
    await click("Show test pattern")
    expect(useBroadcastStore.getState().outputTests.main).toBeDefined()
    await act(async () => root!.unmount())
    root = null
    expect(useBroadcastStore.getState().outputTests).toEqual({})
  })

  it("an output switched off during the test ends it", async () => {
    await render(projector)
    await click("Test this screen")
    await click("Show test pattern")
    await act(async () => useBroadcastStore.setState({ outputStatus: { main: { previewOpen: false, ndiActive: false } } }))
    expect(useBroadcastStore.getState().outputTests).toEqual({})
  })

  it("a browser feed shows its render receipt, and a page showing it asks again", async () => {
    useBroadcastStore.setState({ outputStatus: { tv: { previewOpen: false, ndiActive: false, feedActive: true } } })
    await render(lobby)
    expect(document.body.textContent).toContain("Shown on 1 page")
    await click("Test this screen")
    await click("Show test pattern")
    expect(document.body.textContent).toContain("1 page is showing this feed now")
  })

  it("a feed whose page has not drawn the newest frame says Connected, not shown", async () => {
    Object.assign(feed, { watching: 1, seq: 5, acked: 3 })
    useBroadcastStore.setState({ outputStatus: { tv: { previewOpen: false, ndiActive: false, feedActive: true } } })
    await render(lobby)
    expect(document.body.textContent).toContain("Connected, not shown (1 page open)")
  })
})
