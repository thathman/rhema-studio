import { describe, expect, it, vi } from "vitest"
import { drawStage } from "./stage-canvas"
import type { StagePayload } from "@/types"

describe("Stage canvas language notice", () => {
  it("draws the fallback notice on a rendered stage output", () => {
    const fillText = vi.fn()
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      fillText,
      measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    const languageNotice = "Second language unavailable; showing available text."
    const stage: StagePayload = {
      current: { title: "Psalm 23:1", lines: ["The Lord is my shepherd"] },
      next: null,
      note: null,
      languageNotice,
      timer: null,
      message: null,
      band: null,
    }

    drawStage(context, 1920, 1080, stage)

    expect(fillText.mock.calls.some(([text]) => text === languageNotice)).toBe(true)
  })
})
