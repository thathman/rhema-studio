import { describe, expect, it } from "vitest"
import { applyBrandKit, contrastRatio, defaultBrandKit, missingThemeFonts, readable, MANAGED_THEME_IDS } from "./brand-kit"
import { BUILTIN_THEMES } from "./builtin-themes"

describe("brand kit", () => {
  it("measures contrast and falls back to a readable colour", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0)
    expect(readable("#ffffff", "#0a0a1a", "#111111")).toBe("#ffffff")
    expect(readable("#222222", "#0a0a1a", "#ffffff")).toBe("#ffffff")
  })

  it("generates three managed themes with the church's colours, fonts and logo, keeping ids on re-apply", () => {
    const kit = { ...defaultBrandKit(), churchName: "Grace Chapel", logoUrl: "data:logo", colors: { primary: "#003366", accent: "#ffcc00", text: "#ffffff", background: "#001122" }, fonts: { heading: "Inter Variable", body: "Geist Variable" } }
    const once = applyBrandKit(kit, BUILTIN_THEMES)
    const managed = once.filter((t) => t.brandManaged)
    expect(managed.map((t) => t.id).sort()).toEqual(Object.values(MANAGED_THEME_IDS).sort())
    const scripture = once.find((t) => t.id === MANAGED_THEME_IDS.scripture)!
    expect(scripture.name).toBe("Grace Chapel · Scripture")
    expect(scripture.verseText.fontFamily).toBe("Geist Variable")
    expect(scripture.reference.fontFamily).toBe("Inter Variable")
    expect(scripture.reference.color).toBe("#ffcc00")
    expect(scripture.logo).toMatchObject({ url: "data:logo", corner: "top-right", size: 8 })
    expect(scripture.builtin).toBe(false)
    expect(once.filter((t) => t.builtin)).toHaveLength(BUILTIN_THEMES.length)
    const lyrics = once.find((t) => t.id === MANAGED_THEME_IDS.lyrics)!
    expect(lyrics.verseNumbers.visible).toBe(false)

    const twice = applyBrandKit({ ...kit, colors: { ...kit.colors, accent: "#ff00ff" } }, once)
    expect(twice.filter((t) => t.brandManaged)).toHaveLength(3)
    expect(twice.find((t) => t.id === MANAGED_THEME_IDS.scripture)!.reference.color).toBe("#ff00ff")
    expect(twice.find((t) => t.id === MANAGED_THEME_IDS.scripture)!.createdAt).toBe(scripture.createdAt)
  })

  it("never touches a managed theme the church took over by hand", () => {
    const kit = defaultBrandKit()
    const themes = applyBrandKit(kit, BUILTIN_THEMES)
    const edited = themes.map((t) => (t.id === MANAGED_THEME_IDS.lyrics ? { ...t, brandManaged: false, name: "My lyrics" } : t))
    const again = applyBrandKit({ ...kit, churchName: "New" }, edited)
    expect(again.find((t) => t.id === MANAGED_THEME_IDS.lyrics)!.name).toBe("My lyrics")
    expect(again.find((t) => t.id === MANAGED_THEME_IDS.scripture)!.name).toBe("New · Scripture")
    // A low-contrast accent falls back to the body colour.
    const dim = applyBrandKit({ ...kit, colors: { ...kit.colors, accent: "#0b0b1b" } }, BUILTIN_THEMES)
    expect(dim.find((t) => t.id === MANAGED_THEME_IDS.scripture)!.reference.color).toBe("#ffffff")
  })

  it("makes an Announcements theme per variant and drops it when the variant goes", () => {
    const kit = { ...defaultBrandKit(), churchName: "Grace", variants: [{ id: "youth", name: "Youth", colors: { primary: "#550088", accent: "#00ffcc" } }] }
    const themes = applyBrandKit(kit, BUILTIN_THEMES)
    const youth = themes.find((t) => t.id === "brand-variant-youth")!
    expect(youth.name).toBe("Grace · Youth · Announcements")
    expect(youth.background.gradient?.stops[0].color).toBe("#550088")
    expect(youth.reference.color).toBe("#00ffcc")
    expect(youth.brandManaged).toBe(true)
    const gone = applyBrandKit({ ...kit, variants: [] }, themes)
    expect(gone.find((t) => t.id === "brand-variant-youth")).toBeUndefined()
    expect(gone.filter((t) => t.brandManaged)).toHaveLength(3)
  })

  it("names fonts a theme needs that are not available", () => {
    const themes = [{ name: "Custom", verseText: { fontFamily: "Poppins" }, reference: { fontFamily: "Geist Variable" }, logo: null }] as never
    expect(missingThemeFonts(themes, (f) => f === "Geist Variable")).toEqual([{ theme: "Custom", font: "Poppins" }])
    expect(missingThemeFonts(themes, () => true)).toEqual([])
  })

  it("removing a look keeps its theme while an output uses it, detached (no fall back to Classic Dark)", () => {
    const kit = { ...defaultBrandKit(), churchName: "Grace", variants: [{ id: "youth", name: "Youth", colors: { primary: "#550088", accent: "#00ffcc" } }] }
    const withLook = applyBrandKit(kit, BUILTIN_THEMES)
    const id = "brand-variant-youth"
    expect(withLook.some((t) => t.id === id)).toBe(true)
    const removedButUsed = applyBrandKit({ ...kit, variants: [] }, withLook, new Set([id]))
    expect(removedButUsed.find((t) => t.id === id)?.brandManaged).toBe(false)
    const removedUnused = applyBrandKit({ ...kit, variants: [] }, withLook)
    expect(removedUnused.some((t) => t.id === id)).toBe(false)
  })
})

