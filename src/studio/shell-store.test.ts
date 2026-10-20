import { describe, expect, it } from "vitest"
import { readShellPrefs, writeShellPrefs, SHELL_PREFS_KEY, type StorageLike } from "./shell-store"

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  }
}

describe("shell prefs", () => {
  it("defaults to home + standard with no storage", () => {
    expect(readShellPrefs(null)).toEqual({ workspace: "home", presentView: "standard" })
  })

  it("round-trips through storage", () => {
    const s = fakeStorage()
    writeShellPrefs(s, { workspace: "present", presentView: "production" })
    expect(readShellPrefs(s)).toEqual({ workspace: "present", presentView: "production" })
  })

  it("falls back per field on bad values", () => {
    const s = fakeStorage({
      [SHELL_PREFS_KEY]: JSON.stringify({ workspace: "nope", presentView: "production" }),
    })
    expect(readShellPrefs(s)).toEqual({ workspace: "home", presentView: "production" })
  })

  it("survives corrupt JSON", () => {
    const s = fakeStorage({ [SHELL_PREFS_KEY]: "{not json" })
    expect(readShellPrefs(s)).toEqual({ workspace: "home", presentView: "standard" })
  })
})
