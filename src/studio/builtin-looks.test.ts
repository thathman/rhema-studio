import { describe, expect, it } from "vitest"
import rust from "../../src-tauri/src/mcp_drafts.rs?raw"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"

/** The MCP server names the built-in looks for assistants (MCP-004): keep its list the app's. */
describe("built-in looks named to assistants", () => {
  it("match the app's built-in themes", () => {
    const listed = /BUILTIN_LOOKS: \[&str; \d+\] = \[([^\]]*)\]/.exec(rust)![1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean)
    expect(listed.sort()).toEqual(BUILTIN_THEMES.map((t) => t.name).sort())
  })
})
