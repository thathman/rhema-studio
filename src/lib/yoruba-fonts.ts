/**
 * Can a font draw Yorùbá (#213 preflight)? Each letter Yorùbá needs beyond plain Latin (ẹ ọ ṣ,
 * capitals, with tone marks) is drawn to a canvas in the font with a fallback behind it and in the
 * fallback alone: when the widths match for every fallback, the font does not have that letter and
 * the screen would show the fallback's. Local only; no font is downloaded.
 */
export const YORUBA_SAMPLES = ["ẹ", "ọ", "ṣ", "Ẹ", "Ọ", "Ṣ", "ẹ́", "ẹ̀", "ọ́", "ọ̀", "ṣé", "Ọ̀"]
const FALLBACKS = ["monospace", "serif", "sans-serif"]

/** `measure(font, text)`: the text's width in that CSS font. True when every sample is the font's own. */
export function drawsYoruba(family: string, measure: (font: string, text: string) => number): boolean {
  return YORUBA_SAMPLES.every((t) => FALLBACKS.some((base) => measure(`72px "${family}", ${base}`, t) !== measure(`72px ${base}`, t)))
}

/**
 * The fonts among `families` that cannot draw every Yorùbá letter, or null when this computer
 * cannot measure (no canvas). Web fonts are loaded first so a font still loading is not called missing.
 */
export async function fontsMissingYoruba(families: string[]): Promise<string[] | null> {
  if (typeof document === "undefined") return null
  let ctx: CanvasRenderingContext2D | null = null
  try {
    ctx = document.createElement("canvas").getContext("2d")
  } catch {
    ctx = null
  }
  if (!ctx) return null
  const c = ctx
  if ("fonts" in document) await Promise.all(families.map((f) => document.fonts.load(`72px "${f}"`, YORUBA_SAMPLES.join("")).catch(() => [])))
  const measure = (font: string, text: string) => {
    c.font = font
    return c.measureText(text).width
  }
  return families.filter((f) => !drawsYoruba(f, measure))
}
