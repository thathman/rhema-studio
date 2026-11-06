import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * An output window may call only the app commands window_acl.rs lets it (C3). A command it calls
 * that is not on that list is refused at run time, on the congregation's screen, with no test
 * failing (#411: the Companion app shipped calling a command it never registered). Every command
 * the output window calls must be on its list.
 */
const root = new URL("../", import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), "utf8")

describe("the output window calls only the commands it is allowed", () => {
  it("broadcast-output.tsx against OUTPUT_WINDOW_COMMANDS", () => {
    const acl = read("src-tauri/src/window_acl.rs")
    const list = acl.slice(acl.indexOf("OUTPUT_WINDOW_COMMANDS"), acl.indexOf("];", acl.indexOf("OUTPUT_WINDOW_COMMANDS")))
    const allowed = new Set([...list.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]))
    const used = [...read("src/broadcast-output.tsx").matchAll(/invoke(?:<[^(]*?>)?\(\s*"([a-z_]+)"/gs)].map((m) => m[1])
    expect(used.length).toBeGreaterThan(3)
    expect(used.filter((name) => !allowed.has(name))).toEqual([])
  })
})
