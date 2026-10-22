import { describe, expect, it } from "vitest"
import { themeIdFor, themeIdsOf, withThemeFor } from "./output-themes"

describe("a look per kind of content", () => {
  const out = { themeId: "dark", themeFor: { hymn: "gold", bible: "" } }
  it("uses the kind's own theme, else the main one", () => {
    expect(themeIdFor(out, "hymn")).toBe("gold")
    expect(themeIdFor(out, "bible")).toBe("dark")
    expect(themeIdFor(out, "slide")).toBe("dark")
    expect(themeIdFor(out, null)).toBe("dark")
  })
  it("lists every theme in use once; setting and clearing a kind", () => {
    expect(themeIdsOf({ themeId: "dark", themeFor: { hymn: "gold", song: "gold" } })).toEqual(["dark", "gold"])
    expect(withThemeFor({ themeFor: { hymn: "gold" } }, "bible", "blue")).toEqual({ hymn: "gold", bible: "blue" })
    expect(withThemeFor({ themeFor: { hymn: "gold" } }, "hymn", null)).toEqual({})
  })
})
