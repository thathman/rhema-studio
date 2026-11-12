import { describe, expect, it } from "vitest"
import { canonicalWorkspace, designTabOf, readShellPrefs, useShellStore, writeShellPrefs, SHELL_PREFS_KEY, type StorageLike } from "./shell-store"

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
    expect(readShellPrefs(null)).toEqual({ workspace: "home", sidebarCollapsed: false })
  })

  it("round-trips through storage", () => {
    const s = fakeStorage()
    writeShellPrefs(s, { workspace: "present", sidebarCollapsed: true })
    expect(readShellPrefs(s)).toEqual({ workspace: "present", sidebarCollapsed: true })
  })

  it("migrates the saved Production route to Live; More (no way in since #218) reopens on Home", () => {
    const s = fakeStorage()
    writeShellPrefs(s, { workspace: "production", sidebarCollapsed: false })
    expect(readShellPrefs(s).workspace).toBe("present")
    expect(JSON.parse(s.getItem(SHELL_PREFS_KEY)!).workspace).toBe("present")
    s.setItem(SHELL_PREFS_KEY, JSON.stringify({ workspace: "more", sidebarCollapsed: false }))
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
    expect(readShellPrefs(s)).toEqual({ workspace: "home", sidebarCollapsed: false })
  })

  it("prefs saved before the sidebar could fold open expanded; a bad value does too (#299)", () => {
    const old = fakeStorage({ [SHELL_PREFS_KEY]: JSON.stringify({ workspace: "present", presentView: "standard" }) })
    expect(readShellPrefs(old)).toEqual({ workspace: "present", sidebarCollapsed: false })
    const bad = fakeStorage({ [SHELL_PREFS_KEY]: JSON.stringify({ workspace: "present", sidebarCollapsed: "yes" }) })
    expect(readShellPrefs(bad).sidebarCollapsed).toBe(false)
  })

  it("ignores the retired presentView preference and drops it on the next write (#809 R10)", () => {
    const s = fakeStorage({ [SHELL_PREFS_KEY]: JSON.stringify({ workspace: "present", presentView: "production", sidebarCollapsed: true }) })
    const prefs = readShellPrefs(s)
    expect(prefs).toEqual({ workspace: "present", sidebarCollapsed: true })
    writeShellPrefs(s, prefs)
    expect(JSON.parse(s.getItem(SHELL_PREFS_KEY)!)).toEqual({ workspace: "present", sidebarCollapsed: true })
    expect(readShellPrefs(fakeStorage({ [SHELL_PREFS_KEY]: "null" }))).toEqual({ workspace: "home", sidebarCollapsed: false })
  })

  it("survives corrupt JSON", () => {
    const s = fakeStorage({ [SHELL_PREFS_KEY]: "{not json" })
    expect(readShellPrefs(s)).toEqual({ workspace: "home", sidebarCollapsed: false })
  })
})

describe("the old Design → Output looks link (#299 UX15-4)", () => {
  it("starts the Design workspace in My Designs", () => {
    expect(useShellStore.getState().designTab).toBe("my-designs")
  })

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
  it("routes a scene to its source Design document and only clears the matching request", () => {
    useShellStore.getState().openDesignDocument("design-first")
    expect(useShellStore.getState().designRequest).toBe("my-designs")
    expect(useShellStore.getState().designDocumentRequest).toBe("design-first")

    useShellStore.getState().openDesignDocument("design-second")
    useShellStore.getState().clearDesignDocumentRequest("design-first")
    expect(useShellStore.getState().designDocumentRequest).toBe("design-second")
    useShellStore.getState().clearDesignDocumentRequest("design-second")
    expect(useShellStore.getState().designDocumentRequest).toBeNull()
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

describe("Design Used On navigation", () => {
  it("opens the saved program and carries the exact design pin for Prepare to verify", () => {
    useShellStore.getState().openPrepareMoment({
      programId: "program-sunday",
      itemId: "moment-opening",
      designId: "design-opening",
      version: 2,
    })
    expect(useShellStore.getState().prepareProgramRequest).toEqual({
      programId: "program-sunday",
      moment: { itemId: "moment-opening", designId: "design-opening", version: 2 },
    })
    expect(useShellStore.getState().prepareMomentFocus).toBeNull()
  })

  it("only clears the moment focus request it was given", () => {
    const first = { programId: "p1", itemId: "i1", designId: "d1", version: 1 }
    const newer = { programId: "p2", itemId: "i2", designId: "d2", version: 2 }
    useShellStore.getState().setPrepareMomentFocus(first)
    useShellStore.getState().setPrepareMomentFocus(newer)
    useShellStore.getState().clearPrepareMomentFocus(first)
    expect(useShellStore.getState().prepareMomentFocus).toBe(newer)
  })

  it("drops prior moment focus when a regular service request opens", () => {
    const focus = { programId: "p1", itemId: "i1", designId: "d1", version: 1 }
    useShellStore.getState().setPrepareMomentFocus(focus)
    useShellStore.getState().setPrepareMomentSelection({ ...focus, eventId: "event-1" })

    useShellStore.getState().openPrepareProgram("p2")

    expect(useShellStore.getState().prepareProgramRequest).toEqual({ programId: "p2" })
    expect(useShellStore.getState().prepareMomentFocus).toBeNull()
    expect(useShellStore.getState().prepareMomentSelection).toBeNull()
  })
})

describe("an unknown workspace name", () => {
  it("opens Home instead of a page that does not exist; production still means Live", () => {
    expect(canonicalWorkspace("live" as never)).toBe("home")
    expect(canonicalWorkspace("" as never)).toBe("home")
    expect(canonicalWorkspace("production")).toBe("present")
    expect(canonicalWorkspace("design")).toBe("design")
  })
})
