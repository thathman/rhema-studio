/**
 * QA-003 guard: an icon-only button must have an accessible name
 * (aria-label or title), or a screen reader announces "button" and a
 * volunteer hovering gets nothing. Static scan of the studio sources.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return tsxFiles(p)
    return p.endsWith(".tsx") && !p.endsWith(".test.tsx") ? [p] : []
  })
}

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
  const roots = [join(__dirname), join(__dirname, "..", "components", "stage-view.tsx")]
  const files = roots.flatMap((r) => (r.endsWith(".tsx") ? [r] : tsxFiles(r)))

  it("scans the studio sources", () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it("flags none without aria-label or title", () => {
    const missing: string[] = []
    let scanned = 0
    for (const f of files) {
      for (const tag of iconButtonTags(readFileSync(f, "utf8"))) {
        scanned++
        if (!/aria-label=|title=|aria-labelledby=/.test(tag)) missing.push(`${f.replace(/.*\/src\//, "src/")}: ${tag.replace(/\s+/g, " ").slice(0, 100)}`)
      }
    }
    expect(scanned).toBeGreaterThan(10)
    expect(missing).toEqual([])
  })
})
