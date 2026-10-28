// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))
vi.mock("@/lib/remote-actions", () => ({ presentQueueItem: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { PhaseStrip } from "./phase-strip"
import { useQueueStore } from "@/stores/queue-store"
import { usePhaseRun } from "@/stores/phase-run-store"
import type { QueueItem } from "@/types"

const slide = (id: string): QueueItem => ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0 }) as unknown as QueueItem

describe("Present's automated phases strip", () => {
  it("offers a start for each loop and the warm-up, never the main service, and Stop while one runs", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useQueueStore.setState({
      items: [slide("a"), slide("w"), slide("m")],
      headers: [
        { id: "pre", type: "phase", name: "Pre-service loop", at: 0, rule: "loop", role: "pre" },
        { id: "warm", type: "phase", name: "Warm-up", at: 1, rule: "auto_once", role: "warmup" },
        { id: "main", type: "phase", name: "Main service", at: 2, rule: "manual", role: "main" },
      ],
    })
    const el = document.createElement("div")
    await act(async () => createRoot(el).render(<PhaseStrip />))
    const labels = [...el.querySelectorAll("button")].map((b) => b.textContent?.trim())
    expect(labels).toEqual(["Start Pre-service loop", "Start Warm-up · once"])
    expect(el.textContent).toContain("Main service manual · safe")
    await act(async () => usePhaseRun.setState({ run: { headerId: "pre", itemId: "a", startsAt: null, nextAt: null } }))
    expect([...el.querySelectorAll("button")].map((b) => b.textContent?.trim())).toContain("Stop Pre-service loop")
    expect(el.textContent).toContain("Pre-service loop running · 1 of 1")
  })
})
