/**
 * QA-003 guard: an icon-only button must have an accessible name
 * (aria-label or title), or a screen reader announces "button" and a
 * volunteer hovering gets nothing. Static scan of the studio sources.
 */
import { describe, expect, it } from "vitest"

// Vite reads the sources at test time; no Node fs types needed in the app tsconfig.
const sources = import.meta.glob(["./**/*.tsx", "../components/stage-view.tsx", "../components/panels/*.tsx", "../components/broadcast/*.tsx"], { query: "?raw", import: "default", eager: true }) as Record<string, string>

/** Every `<Button … size="icon…" …>` opening tag, tolerant of `=>` inside handlers. */
function iconButtonTags(source: string): string[] {
  const tags: string[] = []
  const re = /<Button\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    let i = m.index + 7
    let depth = 0
    while (i < source.length) {
      const c = source[i]
      if (c === "{") depth++
      else if (c === "}") depth--
      else if (c === ">" && depth === 0 && source[i - 1] !== "=") break
      i++
    }
    const tag = source.slice(m.index, i + 1)
    if (/size=["{]"?icon/.test(tag)) tags.push(tag)
  }
  return tags
}

describe("icon-only buttons have an accessible name", () => {
  const files = Object.entries(sources).filter(([p]) => !p.endsWith(".test.tsx"))

  it("scans the studio sources", () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it("flags none without aria-label or title", () => {
    const missing: string[] = []
    let scanned = 0
    for (const [f, source] of files) {
      for (const tag of iconButtonTags(source)) {
        scanned++
        if (!/aria-label=|title=|aria-labelledby=/.test(tag)) missing.push(`${f}: ${tag.replace(/\s+/g, " ").slice(0, 100)}`)
      }
    }
    expect(scanned).toBeGreaterThan(10)
    expect(missing).toEqual([])
  })
})
