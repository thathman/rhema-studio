// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { StageView } from "@/components/stage-view"
import { applyStageStyle, DEFAULT_STAGE_STYLE, normalizeStageStyle } from "./stage-style"
import type { StagePayload } from "@/types"

const stage: StagePayload = {
  current: { title: "John 3:16", lines: ["For God so loved the world"] },
  next: "Offering",
  note: "Pastor reads",
  timer: { label: "12:40", tone: "ok" },
  message: null,
  band: "Key G",
}

describe("stage display design (DS-004)", () => {
  it("fills in and keeps a saved style in range", () => {
    expect(normalizeStageStyle(undefined)).toEqual(DEFAULT_STAGE_STYLE)
    const s = normalizeStageStyle({ background: "#102030", words: "red", wordsScale: 9, showNote: false })
    expect(s).toMatchObject({ background: "#102030", words: "#ffffff", wordsScale: 1.6, showNote: false, showTimer: true })
  })

  it("leaves hidden parts out of what the stage display gets", () => {
    const out = applyStageStyle(stage, { ...DEFAULT_STAGE_STYLE, showTimer: false, showNote: false, showBand: false })
    expect(out).toMatchObject({ timer: null, note: null, band: null, next: "Offering" })
    expect(out.style?.showTimer).toBe(false)
  })

  it("the screen view uses the colours and drops what is next when hidden", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const el = document.createElement("div")
    await act(async () => createRoot(el).render(<StageView stage={applyStageStyle(stage, { ...DEFAULT_STAGE_STYLE, background: "#102030", showNext: false })} />))
    const root = el.firstElementChild as HTMLElement
    expect(root.style.background).toBe("rgb(16, 32, 48)")
    expect(el.textContent).not.toContain("NEXT")
    expect(el.textContent).not.toContain("End of service")
  })

  it("shows a missing-language notice even when operator notes are hidden", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const el = document.createElement("div")
    const fallback = { ...stage, languageNotice: "Second language unavailable; showing available text." }
    await act(async () => createRoot(el).render(<StageView stage={applyStageStyle(fallback, { ...DEFAULT_STAGE_STYLE, showNote: false })} />))
    expect(el.querySelector('[role="status"]')?.textContent).toBe("Second language unavailable; showing available text.")
  })
})
