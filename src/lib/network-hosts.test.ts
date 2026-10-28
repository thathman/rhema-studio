import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * NFR-09: no hidden cloud dependency. Every internet host the app's code
 * names must be listed here, with why; docs/rhema-studio/18-network-and-privacy.md
 * says the same in words. Tests and example domains are skipped.
 */
const ALLOWED_HOSTS: Record<string, string> = {
  "api.deepgram.com": "optional cloud speech recognition, only with the operator's own Deepgram key",
  "openlyrics.info": "XML namespace name inside OpenLyrics song files; never contacted",
  "www.w3.org": "SVG namespace name inside the Rhema Studio mark on the phone pages; never contacted",
}

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "target" || name === "dev") continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* sourceFiles(path)
    else if (/\.(ts|tsx|rs|html)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith("_test.rs")) yield path
  }
}

describe("outbound network hosts", () => {
  it("only names hosts that are listed with a reason", () => {
    const root = join(__dirname, "..", "..")
    const found = new Set<string>()
    for (const dir of ["src", "src-tauri/src", "src-tauri/crates"]) {
      for (const file of sourceFiles(join(root, dir))) {
        // Rust unit tests live in the same file after #[cfg(test)]; ignore them.
        const text = readFileSync(file, "utf8").split("#[cfg(test)]")[0]
        for (const m of text.matchAll(/(?:https?|wss?):\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
          const host = m[1].toLowerCase()
          if (host.endsWith(".example") || host === "example.com" || host.endsWith(".localhost") || host === "asset.localhost") continue
          found.add(host)
        }
      }
    }
    expect([...found].filter((h) => !(h in ALLOWED_HOSTS)).sort()).toEqual([])
  })
})
