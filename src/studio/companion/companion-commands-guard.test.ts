import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * #411 Companion hunt: the Companion app shares the desks' connect code, which called a command
 * (join_secure) the Companion never registered, so it could never connect, and its screen tests
 * did not see it (their mock answers anything). Every command on the shared connect path, and in
 * the Companion's own store, must be one the Companion registers.
 */
const root = new URL("../../../", import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), "utf8")
const invoked = (source: string) => [...source.matchAll(/invoke(?:<[^(]*?>)?\(\s*"([a-z_]+)"/gs)].map((m) => m[1])

describe("the Companion registers every command it calls", () => {
  it("the shared connect path and the Companion's store", () => {
    const lib = read("companion-app/src-tauri/src/lib.rs")
    const handlers = lib.slice(lib.indexOf("generate_handler!["), lib.indexOf("])", lib.indexOf("generate_handler![")))
    const registered = new Set([...handlers.matchAll(/(?:[a-z_]+::)?([a-z_]+),/g)].map((m) => m[1]))
    const join = read("src/stores/join-store.ts")
    const connect = join.slice(join.indexOf("  connect: async"), join.indexOf("\n  },", join.indexOf("  connect: async")))
    const needed = [...invoked(connect), ...invoked(read("src/stores/companion-store.ts")), ...invoked(read("src/studio/companion/companion-overlays.tsx"))]
    expect(needed).toContain("resolve_host")
    expect(needed.length).toBeGreaterThan(2)
    expect(needed.filter((name) => !registered.has(name))).toEqual([])
  })
})
