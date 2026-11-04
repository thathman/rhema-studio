// @vitest-environment node
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * Geist has no ṣ/Ṣ; `geist-yoruba.css` draws them from bundled Inter inside "Geist Variable", and
 * needs Geist's own italic faces loaded (or italic Geist loses ẹ ọ). Checked in WebKit and Chrome by
 * measuring every Yorùbá sample against the fallback (`src/lib/yoruba-fonts.ts`): this keeps the
 * imports that made it pass.
 */
const read = (p: string) => readFileSync(join(__dirname, p), "utf8")

describe("Geist draws every Yorùbá letter on the app and on outputs", () => {
  for (const entry of ["index.css", "broadcast-fonts.css"]) {
    it(`${entry} loads Geist upright, Geist italic, then the ṣ/Ṣ faces`, () => {
      const css = read(entry)
      const at = (s: string) => css.indexOf(s)
      expect(at('@import "@fontsource-variable/geist";')).toBeGreaterThanOrEqual(0)
      expect(at('@import "@fontsource-variable/geist/wght-italic.css";')).toBeGreaterThan(at('@import "@fontsource-variable/geist";'))
      expect(at('@import "./geist-yoruba.css";')).toBeGreaterThan(at('@import "@fontsource-variable/geist/wght-italic.css";'))
    })
  }

  it("covers ṣ and Ṣ in both styles with bundled Inter files", () => {
    const css = read("geist-yoruba.css")
    for (const style of ["normal", "italic"]) expect(css).toMatch(new RegExp(`font-style: ${style};[^}]*unicode-range: U\\+1E62-1E63;`))
    for (const [, file] of css.matchAll(/url\("([^"]+)"\)/g)) expect(existsSync(join(__dirname, file!)), file).toBe(true)
  })
})
