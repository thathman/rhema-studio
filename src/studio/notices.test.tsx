// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { buildLiveState } from "@/lib/live-state"
import { isFor, useNotices } from "@/stores/notices-store"
import { NoticesPanel } from "./notices-panel"

/** Production notices (Rhema Comms C1, #251): private, addressed, answered, carried in the Live State. */
beforeEach(() => useNotices.setState({ notices: [], read: [] }))

describe("production notices", () => {
  it("are addressed, bounded and answered once per person", () => {
    const n = useNotices.getState().send({ from: "Femi (timekeeper)", to: "host", priority: "urgent", text: "  Five minutes over  " })!
    expect(n).toMatchObject({ to: "host", priority: "urgent", text: "Five minutes over" })
    expect(useNotices.getState().send({ from: "x", text: "   " })).toBeNull()
    expect(useNotices.getState().send({ from: "x", to: "everyone", text: "y".repeat(400) })).toMatchObject({ to: "all" })
    expect(useNotices.getState().notices[0].text).toHaveLength(280)
    useNotices.getState().answer(n.id, "Main desk", "seen")
    useNotices.getState().answer(n.id, "Main desk", "ready")
    useNotices.getState().answer(n.id, "Main desk", "shrug")
    expect(useNotices.getState().notices.find((x) => x.id === n.id)!.answers.map((a) => a.state)).toEqual(["ready"])
    for (let i = 0; i < 120; i++) useNotices.getState().send({ from: "x", text: `n${i}` })
    expect(useNotices.getState().notices).toHaveLength(100)
    expect(buildLiveState().notices).toHaveLength(50)
  })

  it("each desk sees what is for it and answers it; senders see their own", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const s = useNotices.getState()
    s.send({ from: "Main desk", to: "bible", text: "Next reading is Psalm 100" })
    s.send({ from: "Main desk", to: "screens", text: "Camera scene after the hymn" })
    s.send({ from: "Ade (Bible)", to: "host", text: "Psalm 100 is ready" })
    expect(isFor(useNotices.getState().notices[0], "bible")).toBe(false)
    const onAnswer = vi.fn()
    const onSend = vi.fn()
    const el = document.createElement("div")
    await act(async () => createRoot(el).render(<NoticesPanel notices={useNotices.getState().notices} role="bible" me="Ade (Bible)" onSend={onSend} onAnswer={onAnswer} eventTitle="Opening prayer" />))
    expect(el.textContent).toContain("Next reading is Psalm 100")
    expect(el.textContent).toContain("Psalm 100 is ready")
    expect(el.textContent).not.toContain("Camera scene")
    const ready = [...el.querySelectorAll("button")].find((b) => b.textContent === "Ready")!
    await act(async () => ready.click())
    expect(onAnswer).toHaveBeenCalledWith(expect.any(String), "ready")
    const input = el.querySelector('[aria-label="Notice"]') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Reading after the hymn")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => (el.querySelector("form") as HTMLFormElement).requestSubmit())
    expect(onSend).toHaveBeenCalledWith({ to: "host", priority: "normal", text: "Reading after the hymn" })
  })
})
