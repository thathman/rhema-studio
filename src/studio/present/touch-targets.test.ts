import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * #215 G9.3: Present's operator controls are at least 44 px to touch, either drawn that size
 * (h-11, size-11, min-h-11) or with an invisible 44 px area around them (touch-hit). Static scan
 * of the Present sources, so a later change that shrinks one is caught.
 */
const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8")

/** The first class string after each `<tag`: its own className="…" or className={cn("…". */
function classesOf(src: string, tag: string): string[] {
  return src.split(tag).slice(1).map((chunk) => /className=\{?(?:cn\(\s*)?"([^"]+)"/.exec(chunk)?.[1] ?? "")
}

describe("Present touch targets (#215 G9.3)", () => {
  it("quick screens and Back are 44 px tall", () => {
    const src = read("./present-workspace.tsx")
    const classes = classesOf(src, "<BigButton")
    expect(classes.length).toBe(2)
    for (const c of classes) expect(c).toMatch(/^h-11\b/)
    expect(src).not.toMatch(/\bh-(?:9|10)\b/)
  })

  it("the Scenes strip: its fold, screens, scenes and actions", () => {
    const src = read("./scenes-strip.tsx")
    const classes = classesOf(src, "<button")
    expect(classes.length).toBe(4)
    for (const c of classes) expect(c).toMatch(/\b(?:min-)?h-11\b/)
    expect(src).not.toMatch(/\bh-8\b/)
  })

  it("the running order: rows, a song's slides in Present, move and remove", () => {
    const src = read("./rundown-list.tsx")
    expect(src).toMatch(/className="flex min-h-11 min-w-0 flex-1 items-center/)
    expect(src).toMatch(/mode === "present" \? "h-11" : "h-7"/)
    // Move up, Move down, Hide (#193) and Remove.
    expect(src.match(/size="icon-xs" className="size-11"/g)).toHaveLength(4)
    expect(src).not.toMatch(/className="size-8"/)
  })

  it("the automated phases' Start and Stop", () => {
    const buttons = read("./phase-strip.tsx").match(/<Button[^>]*>/g) ?? []
    expect(buttons).toHaveLength(2)
    for (const b of buttons) expect(b).toContain("touch-hit")
  })

  it("the transport keeps its 44 px buttons", () => {
    expect(read("./transport-bar.tsx")).toContain("inline-flex h-11 min-w-11")
  })
})
