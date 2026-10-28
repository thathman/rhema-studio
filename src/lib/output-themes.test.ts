import { describe, expect, it } from "vitest"
import { themeIdFor, themeIdsOf, themeUses, withThemeFor } from "./output-themes"
import { defaultNdiSettings, type BroadcastOutput } from "@/types/broadcast-output"

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

describe("where a look is used (Design → Used on…, #299)", () => {
  const out = (id: string, o: Partial<BroadcastOutput>): BroadcastOutput => ({ id, name: id, type: "display", themeId: "dark", monitorIndex: 0, ndi: defaultNdiSettings(id), ...o })
  const outputs = [
    out("Main", {}),
    out("Stream", { type: "ndi", themeId: "l3", themeFor: { hymn: "dark", song: "dark", bible: "l3" } }),
    out("Foyer", { role: "signage", themeId: "dark" }),
    out("Stage", { role: "stage", themeId: "dark" }),
  ]
  it("lists each output using it, as main look or for some kinds; never the stage", () => {
    expect(themeUses(outputs, "dark").map((u) => [u.output.id, u.main, u.kinds])).toEqual([
      ["Main", true, []],
      ["Stream", false, ["hymn", "song"]],
      ["Foyer", true, []],
    ])
    expect(themeUses(outputs, "l3").map((u) => [u.output.id, u.main, u.kinds])).toEqual([["Stream", true, ["bible"]]])
    expect(themeUses(outputs, "unused")).toEqual([])
  })
})
