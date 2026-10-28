import { describe, expect, it } from "vitest"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { LIBRARY_LOOKS, LOOK_FAMILIES } from "@/lib/look-library-data"
import { buildStarterPack, planStarterPack, starterPacks } from "@/lib/starter-pack"
import { defaultBrandKit, type BrandKit } from "@/lib/brand-kit"
import type { BroadcastOutput } from "@/types"

const out = (id: string, patch: Partial<BroadcastOutput> = {}): BroadcastOutput => ({ id, name: id, type: "display", themeId: "builtin-classic-dark", monitorIndex: 0, ndi: { sourceName: id, resolution: "r1080p", frameRate: "fps30", alphaMode: "noneOpaque" }, ...patch })
const kit: BrandKit = { ...defaultBrandKit(), churchName: "Grace Chapel", colors: { primary: "#003366", accent: "#ffcc00", text: "#ffffff", background: "#001122" }, fonts: { heading: "Inter Variable", body: "Geist Variable" } }
let n = 0
const ids = () => `id-${++n}`

const packs = starterPacks()
const classic = packs.find((p) => p.family.id === "church-classic")!

describe("starter packs (#298 S3.2)", () => {
  it("offers every family with a look for each job; Seasonal is not a pack", () => {
    expect(packs.map((p) => p.family.id)).toEqual(LOOK_FAMILIES.filter((f) => f.id !== "seasonal").map((f) => f.id))
    for (const p of packs) {
      for (const l of [p.scripture, p.lyrics, p.announcement, p.scriptureBand, p.lyricsBand, p.speaker, p.ticker, ...p.scenes]) expect(l.family, `${p.family.id} ${l.id}`).toBe(p.family.id)
      expect(p.announcement.content).toBe("announcements")
      expect(p.scriptureBand.background).toBe("transparent")
      expect(p.scenes.map((s) => s.content)).toEqual(["bible", "lyrics"])
    }
    expect(classic.stage?.id).toBe("look-classic-stage")
    expect(packs.find((p) => p.family.id === "contemporary")?.stage).toBeUndefined()
  })

  it("plans looks only for congregation outputs that are off", () => {
    const outputs = [
      out("main"),
      out("obs", { type: "ndi", themeId: "builtin-broadcast-overlay" }),
      out("projector"),
      out("stage", { role: "stage" }),
      out("lobby", { role: "signage" }),
    ]
    const plan = planStarterPack(classic, { outputs, outputStatus: { projector: { previewOpen: true, ndiActive: false } }, themes: BUILTIN_THEMES })
    expect(plan.set).toEqual([{ id: "main", name: "main", keyed: false }, { id: "obs", name: "obs", keyed: true }])
    expect(plan.kept.map((k) => [k.id, k.why])).toEqual([
      ["projector", "on now: nothing on air changes"],
      ["stage", "a stage display: it has its own look"],
      ["lobby", "a signage loop: it shows its pictures"],
    ])
    expect(plan.stage).toBe(true)
    // A stage screen that is on keeps its look.
    const on = planStarterPack(classic, { outputs, outputStatus: { stage: { previewOpen: true, ndiActive: false } }, themes: BUILTIN_THEMES })
    expect(on.stage).toBe(false)
    expect(on.stageOn).toEqual(["stage"])
  })

  it("copies the looks in the church colours and sets them on the planned outputs only", () => {
    const outputs = [out("main", { themeFor: { picture: "builtin-modern-light" } }), out("obs", { type: "ndi", themeId: "builtin-broadcast-overlay" }), out("projector")]
    const plan = planStarterPack(classic, { outputs, outputStatus: { projector: { previewOpen: true, ndiActive: false } }, themes: BUILTIN_THEMES })
    const library = structuredClone(LIBRARY_LOOKS)
    const r = buildStarterPack(classic, plan, outputs, { brand: kit, newId: ids, now: 7, takenNames: ["Classic · Scripture · Grace Chapel"] })
    expect(r.branded).toBe(true)
    expect(r.themes.map((t) => t.libraryLookId)).toEqual([classic.scripture.id, classic.lyrics.id, classic.announcement.id, classic.scriptureBand.id, classic.lyricsBand.id])
    // Church colours, own names, editable copies.
    expect(r.themes[0]).toMatchObject({ name: "Classic · Scripture · Grace Chapel 2", builtin: false, verseText: { color: "#ffffff", fontFamily: "Geist Variable" } })
    expect(r.lowerThirdStyle).toMatchObject({ libraryLookId: classic.speaker.id, fontFamily: "Inter Variable" })
    expect(r.tickerStyle.libraryLookId).toBe(classic.ticker.id)
    expect(r.stageStyle?.libraryLookId).toBe("look-classic-stage")
    // The camera scenes show in the bands copied above: no extra copies.
    expect(r.scenes).toHaveLength(2)
    const bandIds = new Set([r.themes[3].id, r.themes[4].id])
    for (const s of r.scenes) for (const l of s.layers) if (l.kind === "feed") expect(bandIds.has(l.themeId!)).toBe(true)
    // A full-screen output gets the full-screen looks, a keyed one the bands; the output on air is not in the list.
    const [scripture, lyrics, notice, band, lyricsBand] = r.themes.map((t) => t.id)
    expect(r.outputs).toEqual([
      { id: "main", themeId: scripture, themeFor: { picture: "builtin-modern-light", bible: scripture, song: lyrics, hymn: lyrics, slide: notice } },
      { id: "obs", themeId: band, themeFor: { bible: band, song: lyricsBand, hymn: lyricsBand } },
    ])
    expect(LIBRARY_LOOKS).toEqual(library)
  })

  it("without church colours the copies are as the library has them; no stage look when a stage screen is on", () => {
    const plan = { set: [], kept: [], stage: false, stageOn: ["Stage"] }
    const r = buildStarterPack(classic, plan, [], { brand: defaultBrandKit(), newId: ids })
    expect(r.branded).toBe(false)
    expect(r.themes[0].verseText).toEqual(classic.scripture.theme.verseText)
    expect(r.stageStyle).toBeUndefined()
    expect(r.outputs).toEqual([])
  })
})
