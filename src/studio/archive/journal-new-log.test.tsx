// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(async () => null), open: vi.fn(async () => null) }))
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: vi.fn(async () => {}), readTextFile: vi.fn(async () => "") }))
const startNewJournal = vi.fn(async () => {})
vi.mock("@/stores/journal-store", async (orig) => ({ ...(await orig<typeof import("@/stores/journal-store")>()), startNewJournal }))

import { act } from "react"
import { createRoot } from "react-dom/client"
const { JournalBlock } = await import("@/studio/archive/service-runs")
const { useJournalStore } = await import("@/stores/journal-store")
const { useTranscriptStore } = await import("@/stores/transcript-store")

const button = (host: HTMLElement, name: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(name))!

describe("a new log never throws away what was said without asking (#411)", () => {
  it("asks first when passages are not kept with a log, and clears only on 'Clear and start'", async () => {
    useJournalStore.setState({ entries: [{ kind: "verse", at: 1, reference: "John 3:16" } as never] })
    useTranscriptStore.setState({ segments: [{ id: "s", text: "said this", is_final: true, confidence: 1, timestamp: 0 } as never] })
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => root.render(<JournalBlock />))
    await act(async () => button(host, "Start a new log").click())
    expect(startNewJournal).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("not kept with a log")
    await act(async () => button(host, "Clear and start").click())
    expect(startNewJournal).toHaveBeenCalledTimes(1)
    act(() => root.unmount())
  })
})
