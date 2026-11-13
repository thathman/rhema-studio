import { describe, expect, it } from "vitest"
import { DESIGN_GROUPS, DESIGN_SECTIONS, designGroupOf, designPathOf, designSectionOf } from "./design-groups"
import { designTabOf, useShellStore, type DesignTab } from "@/studio/shell-store"

/** Every section id Design had before #818 (nine tabs plus the old "outputs" link). */
const FORMER_TABS: DesignTab[] = ["my-designs", "library", "scenes", "themes", "lower-thirds", "ticker", "stage", "countdown", "brand", "used-on", "outputs"]

describe("Design purpose groups (#818)", () => {
  it("lists exactly the expected sections in Make, Style and Where used", () => {
    expect(DESIGN_GROUPS.map((group) => [group.label, group.sections.map((section) => section.id)])).toEqual([
      ["Make", ["my-designs", "library", "scenes", "lower-thirds", "ticker", "countdown", "stage"]],
      ["Style", ["themes", "brand"]],
      ["Where used", ["used-on"]],
    ])
  })

  it("puts every former section in exactly one group, with nothing extra", () => {
    const ids = DESIGN_SECTIONS.map((section) => section.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual(FORMER_TABS.filter((tab) => tab !== "outputs").sort())
  })

  it("opens every former tab id on its own section", () => {
    for (const tab of FORMER_TABS) {
      expect(designSectionOf(tab).id).toBe(designTabOf(tab))
      expect(designGroupOf(tab).sections.map((section) => section.id)).toContain(designTabOf(tab))
    }
  })

  it("still resolves the old Used on… and Output looks links to the Where used overview", () => {
    for (const tab of ["used-on", "outputs"] as const) {
      expect(designGroupOf(tab).id).toBe("where-used")
      expect(designSectionOf(tab).label).toBe("Outputs overview")
      expect(designPathOf(tab)).toBe("Design → Where used")
      useShellStore.getState().openDesign(tab)
      expect(useShellStore.getState().designRequest).toBe("used-on")
      useShellStore.getState().setDesignTab(tab)
      expect(useShellStore.getState().designTab).toBe("used-on")
    }
    expect(designPathOf("brand")).toBe("Design → Style → Brand kit")
    expect(designPathOf("countdown")).toBe("Design → Make → Countdown")
  })
})
