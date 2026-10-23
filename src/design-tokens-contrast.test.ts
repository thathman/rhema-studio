import { readdirSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { contrastRatio } from "@/lib/brand-kit"

/**
 * The app's colour tokens (src/index.css, issue #215) keep every text pair at WCAG AA, 4.5:1,
 * in light planning, dark planning and the live console. A token change that drops below fails here.
 */
const css = readFileSync(new URL("./index.css", import.meta.url), "utf8")

/** The hex tokens set in one block (`:root {`, `.dark {`), by name. */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`)
  expect(start, `${selector} block in index.css`).toBeGreaterThan(-1)
  const body = css.slice(start, css.indexOf("\n}", start))
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{3}(?:[0-9a-f]{3})?)\s*;/gi)].map((m) => [m[1], m[2]]))
}

const light = block(":root")
const dark = { ...light, ...block(".dark") }
// The live console sits inside .dark, so it takes the dark tokens it does not set itself.
const present = { ...dark, ...block(".present-surface") }

/** [surface, text] pairs the app draws text with. */
const PAIRS: Array<[string, string]> = [
  ["background", "foreground"],
  ["card", "card-foreground"],
  ["popover", "popover-foreground"],
  ["primary", "primary-foreground"],
  ["secondary", "secondary-foreground"],
  ["muted", "muted-foreground"],
  ["background", "muted-foreground"],
  ["card", "muted-foreground"],
  ["accent", "accent-foreground"],
  // Destructive has no foreground of its own: it is the text colour (Delete, errors) on the page and on cards.
  ["background", "destructive"],
  ["card", "destructive"],
  ["topbar", "foreground"],
  ["surface-elevated", "foreground"],
  ["surface-sunken", "foreground"],
  ["card", "gold-foreground"],
  // Teal text (selected tabs, links, teal labels) has its own token: the button teal is too dark on dark cards.
  ["background", "primary-text"],
  ["card", "primary-text"],
  ["popover", "primary-text"],
  ["muted", "primary-text"],
  ["accent", "primary-text"],
  ["surface-elevated", "primary-text"],
  ["surface-sunken", "primary-text"],
  ["sidebar", "sidebar-foreground"],
  ["sidebar", "sidebar-accent-foreground"],
  ["sidebar-accent", "sidebar-accent-foreground"],
  ["sidebar-primary", "sidebar-primary-foreground"],
  ["sidebar-hover", "sidebar-foreground"],
  ["tone-neutral", "tone-neutral-foreground"],
  ["tone-accent", "tone-accent-foreground"],
  ["tone-green", "tone-green-foreground"],
  ["tone-amber", "tone-amber-foreground"],
  ["tone-rose", "tone-rose-foreground"],
  ["tone-blue", "tone-blue-foreground"],
  ["kind-scripture", "kind-scripture-foreground"],
  ["kind-song", "kind-song-foreground"],
  ["kind-media", "kind-media-foreground"],
  ["kind-slide", "kind-slide-foreground"],
  ["kind-other", "kind-other-foreground"],
]

describe("colour tokens meet WCAG AA for text (#215)", () => {
  for (const [mode, tokens] of [["light", light], ["dark", dark], ["live console", present]] as const) {
    it.each(PAIRS)(`${mode}: %s behind %s`, (surface, text) => {
      expect(tokens[surface], `--${surface}`).toMatch(/^#/)
      expect(tokens[text], `--${text}`).toMatch(/^#/)
      expect(contrastRatio(tokens[surface], tokens[text])).toBeGreaterThanOrEqual(4.5)
    })
  }

  it("teal text uses the text token, never the button fill (text-primary)", () => {
    const src = new URL("./", import.meta.url)
    const files = readdirSync(src, { recursive: true, encoding: "utf8" }).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    const offenders = files.filter((f) => /(?<![\w-])text-primary(?![-\w])/.test(readFileSync(new URL(f, src), "utf8")))
    expect(offenders).toEqual([])
  })

  it("reads the colours as written (a known pair, to guard the parser)", () => {
    expect(light.background.toLowerCase()).toBe("#f5f4ef")
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5)
  })
})
