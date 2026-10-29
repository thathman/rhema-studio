import { describe, expect, it } from "vitest"
import { designTabOf, readShellPrefs, useShellStore, writeShellPrefs, SHELL_PREFS_KEY, type StorageLike } from "./shell-store"

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
    expect(readShellPrefs(null)).toEqual({ workspace: "home", presentView: "standard", sidebarCollapsed: false })
  })

  it("round-trips through storage", () => {
    const s = fakeStorage()
    writeShellPrefs(s, { workspace: "present", presentView: "production", sidebarCollapsed: true })
    expect(readShellPrefs(s)).toEqual({ workspace: "present", presentView: "production", sidebarCollapsed: true })
  })

  it("migrates the saved Production route to Live; More (no way in since #218) reopens on Home", () => {
    const s = fakeStorage()
    writeShellPrefs(s, { workspace: "production", presentView: "standard", sidebarCollapsed: false })
    expect(readShellPrefs(s).workspace).toBe("present")
    expect(JSON.parse(s.getItem(SHELL_PREFS_KEY)!).workspace).toBe("present")
    writeShellPrefs(s, { workspace: "more", presentView: "standard", sidebarCollapsed: false })
    expect(readShellPrefs(s).workspace).toBe("home")
  })

  it("routes legacy Production navigation requests to the canonical Live workspace", () => {
    useShellStore.getState().setWorkspace("production")
    expect(useShellStore.getState().workspace).toBe("present")
    useShellStore.getState().goTo("production")
    expect(useShellStore.getState().goRequest).toBe("present")
  })

  it("falls back per field on bad values", () => {
    const s = fakeStorage({
      [SHELL_PREFS_KEY]: JSON.stringify({ workspace: "nope", presentView: "production" }),
    })
    expect(readShellPrefs(s)).toEqual({ workspace: "home", presentView: "production", sidebarCollapsed: false })
  })

  it("prefs saved before the sidebar could fold open expanded; a bad value does too (#299)", () => {
    const old = fakeStorage({ [SHELL_PREFS_KEY]: JSON.stringify({ workspace: "present", presentView: "standard" }) })
    expect(readShellPrefs(old)).toEqual({ workspace: "present", presentView: "standard", sidebarCollapsed: false })
    const bad = fakeStorage({ [SHELL_PREFS_KEY]: JSON.stringify({ workspace: "present", presentView: "standard", sidebarCollapsed: "yes" }) })
    expect(readShellPrefs(bad).sidebarCollapsed).toBe(false)
  })

  it("survives corrupt JSON", () => {
    const s = fakeStorage({ [SHELL_PREFS_KEY]: "{not json" })
    expect(readShellPrefs(s)).toEqual({ workspace: "home", presentView: "standard", sidebarCollapsed: false })
  })
})

describe("the old Design → Output looks link (#299 UX15-4)", () => {
  it("opens Used on…; other sections are unchanged", () => {
    expect(designTabOf("outputs")).toBe("used-on")
    expect(designTabOf("themes")).toBe("themes")
    useShellStore.getState().openDesign("outputs")
    expect(useShellStore.getState().designRequest).toBe("used-on")
    useShellStore.getState().setDesignTab("outputs")
    expect(useShellStore.getState().designTab).toBe("used-on")
    useShellStore.getState().setDesignTab("brand")
    expect(useShellStore.getState().designTab).toBe("brand")
  })
  it("Open output asks for the outputs with that output's editor, a new request each time", () => {
    useShellStore.setState({ outputsDialogOpen: false, editOutputRequest: null })
    useShellStore.getState().editOutput("stream")
    const first = useShellStore.getState().editOutputRequest
    expect(first).toEqual({ id: "stream" })
    expect(useShellStore.getState().outputsDialogOpen).toBe(true)
    useShellStore.getState().editOutput("stream")
    expect(useShellStore.getState().editOutputRequest).not.toBe(first)
  })
})
