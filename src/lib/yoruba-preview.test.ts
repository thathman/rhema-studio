import { describe, expect, it, vi } from "vitest"
import { LIBRARY_LOOKS } from "@/lib/look-library-data"
import { drawLowerThird, renderVerse } from "@/lib/verse-renderer"
import type { VerseRenderData } from "@/types"

/**
 * Yorùbá in Design previews (#215 G7.3): the look library's previews are drawn by the same code
 * as the outputs. Every tone mark and under-dot reaches the canvas as written: nothing is
 * stripped, split into a fallback or turned into a different letter.
 */
const YORUBA = "Ọlọ́run fẹ́ aráyé tó bẹ́ẹ̀ gẹ́ẹ́"
const REFERENCE = "Jòhánù 3:16"
const MARKS = /[̣̀́]/u

/** A drawing context that keeps what it was asked to write (and answers measureText). */
function recorder() {
  const written: string[] = []
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, k) =>
      k === "measureText"
        ? (text: string) => ({ width: String(text).length * 20, actualBoundingBoxAscent: 30, actualBoundingBoxDescent: 8, fontBoundingBoxAscent: 34, fontBoundingBoxDescent: 10 })
        : k === "canvas"
          ? { width: 1920, height: 1080 }
          : k === "fillText" || k === "strokeText"
            ? (text: unknown) => void written.push(String(text))
            : k === "createLinearGradient" || k === "createRadialGradient"
              ? () => ({ addColorStop: () => {} })
              : k === "getTransform"
                ? () => ({ a: 1, d: 1 })
                : () => {},
    set: () => true,
  }) as unknown as CanvasRenderingContext2D
  // Every mark, in NFC as typed, across all that was written (a line may be split into words).
  const all = () => written.join(" ").normalize("NFC")
  return { ctx, written, all }
}

/** The words of `text`, each with its marks intact, are all in what was drawn (a style may set it in capitals). */
function drawnIntact(drawn: string, text: string) {
  const got = drawn.toLocaleLowerCase()
  for (const word of text.normalize("NFC").toLocaleLowerCase().split(/\s+/)) expect(got, word).toContain(word)
}

// The text layout measures with a canvas of its own: a stand-in that answers like a plain font.
vi.stubGlobal("OffscreenCanvas", class { getContext() { return recorder().ctx } })

describe("Yorùbá through the look previews (#215)", () => {
  it("the test words really carry tone marks and under-dots", () => {
    expect(YORUBA.normalize("NFD")).toMatch(MARKS)
  })

  it("every lower-third look draws a Yorùbá name and title unchanged", () => {
    const looks = LIBRARY_LOOKS.filter((l) => l.kind === "lower-third")
    expect(looks.length).toBeGreaterThan(0)
    for (const look of looks) {
      if (look.kind !== "lower-third") continue
      const r = recorder()
      drawLowerThird(r.ctx, 1920, 1080, { line1: "Pastor Adéwálé Ògúnlẹ́yẹ", line2: "Olùṣọ́-àgùntàn", style: look.style })
      drawnIntact(r.all(), "Pastor Adéwálé Ògúnlẹ́yẹ Olùṣọ́-àgùntàn")
    }
  })

  it("every scripture look draws a Yorùbá verse and its reference unchanged", () => {
    const looks = LIBRARY_LOOKS.filter((l) => l.kind === "theme" && l.content === "bible")
    expect(looks.length).toBeGreaterThan(0)
    const verse: VerseRenderData = { content: "bible", reference: REFERENCE, segments: [{ verseNumber: 16, text: YORUBA }] }
    for (const look of looks) {
      if (look.kind !== "theme") continue
      const r = recorder()
      renderVerse(r.ctx, look.theme, verse, { scale: 0.5 })
      drawnIntact(r.all(), `${YORUBA} ${REFERENCE}`)
    }
  })
})
