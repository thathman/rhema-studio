import { describe, expect, it } from "vitest"
import { resolveTranslations, type PolicyInput } from "./translation-policy"
import type { Translation } from "@/types"

const t = (id: number, abbreviation: string): Translation => ({ id, abbreviation, title: "", language: "", is_copyrighted: false, is_downloaded: true })
const bible = (over: Partial<PolicyInput> = {}): PolicyInput => ({
  activeTranslationId: 1,
  secondaryTranslationId: null,
  translations: [t(1, "KJV"), t(3, "NIV"), t(7, "OYCB")],
  overrideServiceTranslations: false,
  ...over,
})

describe("resolveTranslations", () => {
  it("no item follows the operator's active translations", () => {
    expect(resolveTranslations(null, bible({ secondaryTranslationId: 7 }))).toEqual({ primary: 1, secondary: 7, source: "active" })
  })

  it("a never-saved or null-saved item follows the active translations", () => {
    expect(resolveTranslations({}, bible())).toMatchObject({ primary: 1, source: "active" })
    expect(resolveTranslations({ translation: null, secondary_translation: null }, bible())).toMatchObject({ primary: 1, source: "active" })
  })

  it("a saved translation wins over the active one, with its saved secondary", () => {
    expect(resolveTranslations({ translation: "OYCB", secondary_translation: "KJV" }, bible())).toEqual({ primary: 7, secondary: 1, source: "item" })
    // Case-insensitive; a null saved secondary follows the operator's secondary.
    expect(resolveTranslations({ translation: "oycb", secondary_translation: null }, bible({ secondaryTranslationId: 3 }))).toEqual({ primary: 7, secondary: 3, source: "item" })
  })

  it("a saved secondary equal to the primary collapses to none", () => {
    expect(resolveTranslations({ translation: "OYCB", secondary_translation: "OYCB" }, bible())).toEqual({ primary: 7, secondary: null, source: "item" })
  })

  it("a saved translation that is not installed is reported, never substituted", () => {
    expect(resolveTranslations({ translation: "ESV", secondary_translation: null }, bible())).toEqual({ missing: ["ESV"] })
    expect(resolveTranslations({ translation: "OYCB", secondary_translation: "ESV" }, bible())).toEqual({ missing: ["ESV"] })
  })

  it("the operator override shows the item in the active translations", () => {
    expect(resolveTranslations({ translation: "ESV", secondary_translation: null }, bible({ overrideServiceTranslations: true }))).toEqual({ primary: 1, secondary: null, source: "override" })
  })
})
