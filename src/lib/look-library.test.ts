import { describe, expect, it, vi } from "vitest"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { LIBRARY_LOOKS, LOOK_FAMILIES } from "@/lib/look-library-data"
import { adoptLook, brandable, filterLooks, lookLanguages, readLookFavourites, resetCopy, showsTwoLanguages, sourceLook, themeUsedBy, uniqueName, writeLookFavourites, type LibraryLook } from "@/lib/look-library"
import { normalizeTheme } from "@/lib/theme-migrations"
import { normalizeLowerThirdStyle } from "@/lib/lower-third-style"
import { normalizeTickerStyle } from "@/lib/ticker"
import { normalizeStageStyle } from "@/lib/stage-style"
import { normalizeScene } from "@/lib/scenes"
import { BRAND_FONTS, CAMERA_GROUND, contrastRatio, defaultBrandKit, type BrandKit } from "@/lib/brand-kit"
import { BUNDLED_FONTS } from "@/lib/fonts"
import type { BroadcastOutput } from "@/types"

vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn().mockResolvedValue(undefined) }))

const of = <K extends LibraryLook["kind"]>(kind: K) => LIBRARY_LOOKS.filter((l): l is Extract<LibraryLook, { kind: K }> => l.kind === kind)
let n = 0
const ids = () => `id-${++n}`

describe("look library contents", () => {
  it("keeps the four builtin themes and their ids", () => {
    expect(BUILTIN_THEMES.map((t) => t.id)).toEqual(["builtin-classic-dark", "builtin-modern-light", "builtin-broadcast-overlay", "builtin-banner-split"])
    for (const l of LIBRARY_LOOKS) expect(BUILTIN_THEMES.some((t) => t.id === l.id)).toBe(false)
  })

  it("has unique ids, and theme ids match their look", () => {
    const all = LIBRARY_LOOKS.map((l) => l.id)
    expect(new Set(all).size).toBe(all.length)
    for (const l of of("theme")) expect(l.theme.id).toBe(l.id)
  })

  it("gives at least five families the core presets", () => {
    const core = LOOK_FAMILIES.filter((f) => f.id !== "seasonal")
    expect(core.length).toBeGreaterThanOrEqual(5)
    for (const f of core) {
      const looks = LIBRARY_LOOKS.filter((l) => l.family === f.id)
      const has = (layout: string, content: string) => looks.some((l) => l.layout === layout && l.content === content)
      expect(has("fullscreen", "bible"), `${f.name} Bible full screen`).toBe(true)
      expect(has("fullscreen", "lyrics"), `${f.name} lyrics full screen`).toBe(true)
      expect(has("lower-third", "bible"), `${f.name} Bible lower third`).toBe(true)
      expect(has("lower-third", "lyrics"), `${f.name} lyrics lower third`).toBe(true)
      expect(has("lower-third", "speaker"), `${f.name} speaker`).toBe(true)
      expect(has("ticker", "announcements"), `${f.name} ticker`).toBe(true)
      expect(has("scene", "bible"), `${f.name} camera + Bible`).toBe(true)
      expect(has("scene", "lyrics"), `${f.name} camera + lyrics`).toBe(true)
    }
  })

  it("every theme look normalizes to the same shape", () => {
    for (const l of of("theme")) expect(normalizeTheme(l.theme), l.id).toEqual(l.theme)
  })

  it("every lower-third, ticker, stage and scene look normalizes unchanged", () => {
    for (const l of of("lower-third")) expect(normalizeLowerThirdStyle(l.style), l.id).toEqual(l.style)
    for (const l of of("ticker")) expect(normalizeTickerStyle(l.style), l.id).toEqual(l.style)
    for (const l of of("stage")) expect(normalizeStageStyle(l.style), l.id).toEqual(l.style)
  })

  it("keyed looks are transparent; light and dark ones are not", () => {
    for (const l of of("theme")) expect(l.theme.background.type === "transparent", l.id).toBe(l.background === "transparent")
  })

  it("uses only fonts bundled with the app", () => {
    const bundled = new Set<string>([...BUNDLED_FONTS, ...BRAND_FONTS])
    for (const l of of("theme")) for (const f of [l.theme.verseText.fontFamily, l.theme.secondaryVerseText?.fontFamily, l.theme.reference.fontFamily]) if (f) expect(bundled.has(f), `${l.id}: ${f}`).toBe(true)
    for (const l of [...of("lower-third"), ...of("ticker")]) if (l.style.fontFamily) expect(bundled.has(l.style.fontFamily), l.id).toBe(true)
  })

  it("carries no pictures (nothing to license)", () => {
    expect(JSON.stringify(LIBRARY_LOOKS)).not.toMatch(/data:|https?:\/\//)
  })

  it("scene layers name theme looks that exist", () => {
    for (const l of of("scene")) for (const layer of l.scene.layers) if (layer.lookId) expect(LIBRARY_LOOKS.find((x) => x.id === layer.lookId)?.kind, `${l.id} → ${layer.lookId}`).toBe("theme")
  })
})

describe("filterLooks", () => {
  it("filters by layout, family, background and favourites", () => {
    expect(filterLooks(LIBRARY_LOOKS, { layout: "all", family: "all", background: "all" })).toHaveLength(LIBRARY_LOOKS.length)
    const l3 = filterLooks(LIBRARY_LOOKS, { layout: "lower-third", family: "all", background: "all" })
    expect(l3.length).toBeGreaterThan(0)
    expect(l3.every((l) => l.layout === "lower-third")).toBe(true)
    const hc = filterLooks(LIBRARY_LOOKS, { layout: "all", family: "high-contrast", background: "light" })
    expect(hc.map((l) => l.id)).toEqual(["look-contrast-lyrics-light"])
    const favs = new Set(["look-clean-ticker", "look-classic-bible-full"])
    expect(filterLooks(LIBRARY_LOOKS, { layout: "all", family: "all", background: "all", favouritesOnly: true, favourites: favs }).map((l) => l.id)).toEqual(["look-classic-bible-full", "look-clean-ticker"])
    expect(filterLooks(LIBRARY_LOOKS, { layout: "ticker", family: "all", background: "all", favouritesOnly: true, favourites: favs }).map((l) => l.id)).toEqual(["look-clean-ticker"])
  })
})

describe("adoptLook", () => {
  it("copies a theme look with a new id, editable, remembering where it came from", () => {
    const look = of("theme")[0]
    const before = structuredClone(look.theme)
    const { themes } = adoptLook(look, { newId: ids, now: 5, takenNames: [look.name] })
    expect(themes).toHaveLength(1)
    const copy = themes[0]
    expect(copy.id).not.toBe(look.id)
    expect(copy).toMatchObject({ builtin: false, pinned: false, createdAt: 5, updatedAt: 5, libraryLookId: look.id, name: `${look.name} 2` })
    // The library look itself is untouched, also by edits to the copy.
    copy.verseText.color = "#123456"
    expect(look.theme).toEqual(before)
  })

  it("adds a lower-third style with its own id", () => {
    const look = of("lower-third")[0]
    const { lowerThirdStyle, themes } = adoptLook(look, { newId: ids })
    expect(themes).toEqual([])
    expect(lowerThirdStyle?.id).not.toBe(look.style.id)
    expect(lowerThirdStyle).toMatchObject({ ...look.style, id: lowerThirdStyle?.id })
  })

  it("a scene gets its own copies of the looks its layers show in", () => {
    const look = of("scene").find((l) => l.id === "look-clean-scene-bible")!
    const { scene, themes } = adoptLook(look, { newId: ids, library: LIBRARY_LOOKS, now: 9 })
    expect(themes.map((t) => t.libraryLookId)).toEqual(["look-clean-bible-l3"])
    expect(scene).toBeDefined()
    const feed = scene!.layers.find((l) => l.kind === "feed")!
    expect(feed.themeId).toBe(themes[0].id)
    expect(feed.shows).toEqual(["bible"])
    expect(scene!.layers.find((l) => l.kind === "camera")?.cameraUrl).toBeUndefined()
    expect(normalizeScene(scene)).toEqual(scene)
  })

  it("Use in the store adds looks and leaves every output as it was", async () => {
    vi.resetModules()
    const { useBroadcastStore } = await import("@/stores/broadcast-store")
    const s = useBroadcastStore.getState()
    s.addOutput({ id: "obs", name: "OBS", type: "ndi", themeId: "builtin-broadcast-overlay", themeFor: { bible: "builtin-classic-dark" }, monitorIndex: 0, ndi: { sourceName: "Rhema OBS", resolution: "r1080p", frameRate: "fps30", alphaMode: "straightAlpha" } })
    const outputs = structuredClone(useBroadcastStore.getState().outputs)
    const themesBefore = useBroadcastStore.getState().themes.length
    for (const look of [of("theme")[0], of("scene")[0]]) {
      const added = adoptLook(look, { library: LIBRARY_LOOKS })
      for (const t of added.themes) useBroadcastStore.getState().saveTheme(t)
      if (added.scene) useBroadcastStore.getState().saveScene(added.scene)
    }
    const after = useBroadcastStore.getState()
    expect(after.outputs).toEqual(outputs)
    expect(after.themes).toHaveLength(themesBefore + 2)
    expect(after.scenes).toHaveLength(1)
    expect(after.themes.slice(0, 4).map((t) => t.id)).toEqual(BUILTIN_THEMES.map((t) => t.id))
  })
})

describe("reset and use", () => {
  const look = of("theme")[0]
  it("puts a copy back as the library has it, keeping its id and name", () => {
    const [copy] = adoptLook(look, { newId: () => "mine", now: 1 }).themes
    const edited = { ...copy, name: "Our scripture", pinned: true, verseText: { ...copy.verseText, color: "#ff0000" } }
    const back = resetCopy(edited, look, 50)
    expect(back).toMatchObject({ id: "mine", name: "Our scripture", pinned: true, createdAt: 1, updatedAt: 50, builtin: false, libraryLookId: look.id })
    expect(back.verseText).toEqual(look.theme.verseText)
    expect(sourceLook(edited, LIBRARY_LOOKS)?.id).toBe(look.id)
    expect(sourceLook({ libraryLookId: "gone" }, LIBRARY_LOOKS)).toBeNull()
  })

  it("knows which outputs show a theme, directly or through a scene they show", () => {
    const out = (id: string, patch: Partial<BroadcastOutput>): BroadcastOutput => ({ id, name: id, type: "display", themeId: "x", monitorIndex: 0, ndi: { sourceName: id, resolution: "r1080p", frameRate: "fps30", alphaMode: "noneOpaque" }, ...patch })
    const scenes = [{ id: "s1", name: "S", background: "#000", layers: [{ id: "l", name: "L", kind: "feed" as const, box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, visible: true, themeId: "t2" }], createdAt: 0, updatedAt: 0 }]
    const outputs = [out("A", { themeId: "t1" }), out("B", { themeFor: { hymn: "t3" } }), out("C", { sceneId: "s1" })]
    expect(themeUsedBy("t1", outputs, scenes)).toEqual(["A"])
    expect(themeUsedBy("t2", outputs, scenes)).toEqual(["C"])
    expect(themeUsedBy("t3", outputs, scenes)).toEqual(["B"])
    expect(themeUsedBy("t4", outputs, scenes)).toEqual([])
  })

  it("names copies without clashing", () => {
    expect(uniqueName("Look", [])).toBe("Look")
    expect(uniqueName("Look", ["look", "Look 2"])).toBe("Look 3")
  })

  it("keeps favourites on this computer and survives bad data", () => {
    const m = new Map<string, string>()
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
    expect(readLookFavourites(storage).size).toBe(0)
    writeLookFavourites(storage, new Set(["a", "b"]))
    expect([...readLookFavourites(storage)]).toEqual(["a", "b"])
    m.set("rhema-studio.look-favourites", "{not json")
    expect(readLookFavourites(storage).size).toBe(0)
    expect(readLookFavourites(null).size).toBe(0)
  })
})

describe("language filter (#299)", () => {
  const filter = (language: "en" | "yo" | "both") => filterLooks(LIBRARY_LOOKS, { layout: "all", family: "all", background: "all", language })

  it("Both keeps the looks that show two languages at once", () => {
    const both = filter("both")
    expect(both.length).toBeGreaterThan(0)
    // Every theme look has a second-language style; name bands and tickers show one line.
    for (const l of of("theme")) expect(both.includes(l), l.id).toBe(true)
    for (const l of [...of("lower-third"), ...of("ticker")]) expect(both.includes(l), l.id).toBe(false)
    expect(both.some((l) => l.id === "look-clean-scene-bible")).toBe(true)
    expect(both.some((l) => l.id === "look-contrast-stage")).toBe(true)
  })

  it("a theme without a second-language style is not bilingual", () => {
    const look = of("theme")[0]
    const single = { ...look, theme: { ...look.theme, secondaryVerseText: undefined } }
    expect(showsTwoLanguages(single)).toBe(false)
  })

  it("Yorùbá leaves out looks with English words built in; English keeps them", () => {
    const yo = filter("yo").map((l) => l.id)
    const en = filter("en").map((l) => l.id)
    expect(en).toHaveLength(LIBRARY_LOOKS.length)
    expect(yo).not.toContain("look-classic-ticker")
    expect(yo).toContain("look-contemporary-ticker")
    expect(yo).toContain("look-classic-bible-full")
    expect(lookLanguages(LIBRARY_LOOKS.find((l) => l.id === "look-clean-ticker")!)).toEqual(["en"])
  })

  it("a look in a font Rhema does not bundle is not offered for Yorùbá", () => {
    const look = of("theme")[0]
    const system = { ...look, theme: { ...look.theme, verseText: { ...look.theme.verseText, fontFamily: "Some System Font" } } }
    expect(lookLanguages(system)).toEqual(["en"])
    expect(showsTwoLanguages(system)).toBe(false)
  })
})

describe("Use with church colours (#299)", () => {
  const kit: BrandKit = { ...defaultBrandKit(), churchName: "Grace Chapel", colors: { primary: "#003366", accent: "#ffcc00", text: "#ffffff", background: "#001122" }, fonts: { heading: "Inter Variable", body: "Geist Variable" } }
  const look = LIBRARY_LOOKS.find((l) => l.id === "look-classic-bible-full") as Extract<LibraryLook, { kind: "theme" }>

  it("the copy takes the Brand Kit colours and fonts; the library look and the builtins stay as they were", () => {
    const library = structuredClone(LIBRARY_LOOKS)
    const builtins = structuredClone(BUILTIN_THEMES)
    const added = adoptLook(look, { newId: ids, now: 3, brand: kit })
    const copy = added.themes[0]
    expect(copy.id).not.toBe(look.id)
    expect(copy).toMatchObject({ builtin: false, libraryLookId: look.id, name: "Classic · Scripture · Grace Chapel" })
    expect(copy.brandManaged).toBeUndefined() // a hand copy: Brand Kit Apply never rewrites it
    expect(copy.verseText).toMatchObject({ color: "#ffffff", fontFamily: "Geist Variable" })
    expect(copy.secondaryVerseText).toMatchObject({ color: "#ffcc00", fontFamily: "Geist Variable" })
    expect(copy.reference).toMatchObject({ color: "#ffcc00", fontFamily: "Inter Variable" })
    expect(copy.verseNumbers.color).toBe("#ffcc00")
    // The look's background and layout stay.
    expect(copy.background).toEqual(look.theme.background)
    expect(copy.layout).toEqual(look.theme.layout)
    expect(added.kept).toEqual({ text: false, accent: false })
    expect(LIBRARY_LOOKS).toEqual(library)
    expect(BUILTIN_THEMES).toEqual(builtins)
  })

  it("keeps the look's own colour when the church's would not read on it", () => {
    // Navy words on the Classic look's navy page would not read.
    const dark: BrandKit = { ...kit, colors: { ...kit.colors, text: "#14202b", accent: "#1a2a3a" } }
    const added = adoptLook(look, { newId: ids, brand: dark })
    const copy = added.themes[0]
    expect(added.kept).toEqual({ text: true, accent: true })
    expect(copy.verseText.color).toBe(look.theme.verseText.color)
    expect(copy.reference.color).toBe(look.theme.reference.color)
    // Fonts still change.
    expect(copy.verseText.fontFamily).toBe("Geist Variable")
    // A keyed look without a band is judged against the camera picture.
    const words = LIBRARY_LOOKS.find((l) => l.id === "look-contemporary-bible-l3") as Extract<LibraryLook, { kind: "theme" }>
    const keyed = adoptLook(words, { newId: ids, brand: { ...kit, colors: { ...kit.colors, text: "#222222" } } })
    expect(contrastRatio("#222222", CAMERA_GROUND)).toBeLessThan(4.5)
    expect(keyed.kept?.text).toBe(true)
    expect(keyed.themes[0].verseText.color).toBe(words.theme.verseText.color)
  })

  it("a scene's layer looks and a name band take the colours too; tickers and the stage look are not offered", () => {
    const scene = LIBRARY_LOOKS.find((l) => l.id === "look-clean-scene-bible")!
    const s = adoptLook(scene, { newId: ids, library: LIBRARY_LOOKS, brand: kit })
    expect(s.themes[0].reference.color).toBe("#ffcc00")
    expect(s.scene?.name).toBe("Clean · Camera and scripture · Grace Chapel")
    const band = of("lower-third")[0]
    const l3 = adoptLook(band, { newId: ids, brand: kit }).lowerThirdStyle!
    expect(l3).toMatchObject({ fontFamily: "Inter Variable", line1: { color: "#ffffff" }, line2: { color: "#ffcc00" }, accent: { color: "#ffcc00" } })
    expect(band.style.line1.color).not.toBe("#ffffff")
    expect(of("ticker").some(brandable)).toBe(false)
    expect(of("stage").some(brandable)).toBe(false)
    // Asked anyway, the ticker look is copied as the library has it.
    const t = of("ticker")[0]
    expect(adoptLook(t, { brand: kit }).tickerStyle).toEqual(t.style)
  })
})
