import { describe, expect, it } from "vitest"
import rust from "../../src-tauri/src/mcp_drafts.rs?raw"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { GO_LIVE_CUES } from "@/types"

/** The MCP server names the built-in looks for assistants (MCP-004): keep its list the app's. */
describe("built-in looks named to assistants", () => {
  it("match the app's built-in themes", () => {
    const listed = /BUILTIN_LOOKS: \[&str; \d+\] = \[([^\]]*)\]/.exec(rust)![1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean)
    expect(listed.sort()).toEqual(BUILTIN_THEMES.map((t) => t.name).sort())
  })
})

/** A draft's go-live cue is checked by the MCP server (#252): keep its list the app's. */
describe("go-live cues an assistant may suggest", () => {
  it("match the app's go-live cues", () => {
    const listed = /GO_LIVE_CUES: \[&str; \d+\] = \[([^\]]*)\]/.exec(rust)![1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean)
    expect(listed).toEqual([...GO_LIVE_CUES])
  })
})
