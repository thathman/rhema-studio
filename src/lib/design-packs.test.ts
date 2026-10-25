import { beforeEach, describe, expect, it, vi } from "vitest"

// The imported packs are kept in a store file: an in-memory one here.
const files = vi.hoisted(() => new Map<string, Map<string, unknown>>())
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async (name: string) => {
    if (!files.has(name)) files.set(name, new Map())
    const m = files.get(name)!
    return { get: async (k: string) => structuredClone(m.get(k)), set: async (k: string, v: unknown) => void m.set(k, structuredClone(v)), save: async () => {} }
  }),
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import source from "../../design-packs/rhema-worship-expressions.rhema-design.json?raw"
import {
  DESIGN_PACK_MAX_LOOKS, designPackFrom, hydrateDesignPacks, importDesignPack, libraryFamilies, libraryLooks, packFamilyId, parseDesignPack, readDesignPackDoc, removeDesignPack, resetDesignPacksForTests, useDesignPackStore,
} from "./design-packs"
import { adoptLook, filterLooks, lookCopies, resetCopy, resetSceneCopy, type LibraryLook, type LookOf } from "./look-library"
import { LIBRARY_LOOKS } from "./look-library-data"
import { buildInstallationExport, installationChanges, parseInstallationExport, restoreInstallation } from "./installation-export"
import { useBroadcastStore } from "@/stores/broadcast-store"

const PACK = "rhema-worship-expressions"
type Doc = { entries: Array<Record<string, unknown>> } & Record<string, unknown>
const doc = (): Doc => JSON.parse(source) as Doc
const withEntries = (entries: unknown[]) => JSON.stringify({ ...doc(), entries })
const theme = { id: "night", name: "Night", from: "look-clean-bible-full" }

beforeEach(() => {
  files.clear()
  resetDesignPacksForTests()
})

describe("design packs (#354)", () => {
  it("reads the Worship Expressions pack: 120 looks of every kind, under the pack's own family", () => {
    const pack = parseDesignPack(source)
    expect(pack.doc.id).toBe(PACK)
    expect(pack.looks).toHaveLength(120)
    const kinds = (k: LibraryLook["kind"]) => pack.looks.filter((l) => l.kind === k).length
    expect(kinds("scene")).toBe(56)
    expect(kinds("ticker")).toBe(8)
    expect(kinds("lower-third")).toBe(8)
    expect(kinds("theme")).toBe(48)
    expect(new Set(pack.looks.map((l) => l.family))).toEqual(new Set([packFamilyId(PACK)]))
    expect(pack.family).toMatchObject({ id: `pack:${PACK}`, name: "Rhema Studio · Worship Expressions" })
    expect(pack.looks.every((l) => l.id.startsWith(`${PACK}/`))).toBe(true)
    const layers = pack.looks.flatMap((l) => (l.kind === "scene" ? l.scene.layers : []))
    for (const k of ["video", "picture", "camera", "logo", "clock", "ticker", "lowerThird"] as const) expect(layers.some((l) => l.kind === k), k).toBe(true)
    // Every scene layer's look is one of the pack's themes.
    const themes = new Set(pack.looks.filter((l) => l.kind === "theme").map((l) => l.id))
    for (const l of layers) if (l.lookId) expect(themes.has(l.lookId), l.lookId).toBe(true)
  })

  it("has nothing in it but recipes: no address, picture, lyric or logo", () => {
    expect(source).not.toMatch(/https?:|data:|file:|\.(png|jpe?g|mp4|webm|svg)\b|imageUrl|videoUrl|cameraUrl|mediaId/i)
    const pack = parseDesignPack(source)
    // Keyed bands and the graphics-only scene sit under OBS overlays and Transparent.
    const keyed = filterLooks(pack.looks, { layout: "obs-overlay", family: "all", background: "all" })
    expect(keyed.length).toBeGreaterThanOrEqual(16)
    expect(pack.looks.find((l) => l.id === `${PACK}/scene-all-graphics`)?.background).toBe("transparent")
    // Light looks are found by the Light filter.
    expect(filterLooks(pack.looks, { layout: "all", family: "all", background: "light" }).length).toBeGreaterThan(0)
  })

  it("keeps only what it read and checked: kept again, the pack makes the same looks", () => {
    const raw = doc()
    raw.entries = [
      { ...theme, script: "alert(1)", variant: { foreground: "#ffffff", image: "https://example.invalid/a.png" } },
      { id: "remote", name: "Remote", scene: { background: "#222222", layers: [{ kind: "video", name: "Stream", box: { x: 0, y: 0, w: 100, h: 100 }, videoUrl: "https://example.invalid/v.mp4", mediaFile: "/etc/passwd" }] } },
    ]
    const pack = parseDesignPack(JSON.stringify(raw))
    expect(JSON.stringify(pack)).not.toMatch(/example\.invalid|passwd|alert/)
    expect(designPackFrom(readDesignPackDoc(JSON.parse(JSON.stringify(pack.doc)))).looks).toEqual(pack.looks)
    const whole = parseDesignPack(source)
    expect(designPackFrom(readDesignPackDoc(JSON.parse(JSON.stringify(whole.doc)))).looks).toEqual(whole.looks)
  })

  it.each([
    ["another format", JSON.stringify({ ...doc(), format: "other" }), /not a Rhema design pack/],
    ["another version", JSON.stringify({ ...doc(), version: 2 }), /version 2/],
    ["not JSON", "{", /not JSON/],
    ["over 2 MB", " ".repeat(2_000_001), /2 MB/],
    ["too many looks", withEntries(Array.from({ length: DESIGN_PACK_MAX_LOOKS + 1 }, (_, i) => ({ ...theme, id: `n-${i}` }))), /1 to 160/],
    ["two looks with one id", withEntries([theme, theme]), /Two looks/],
    ["a look Rhema does not have", withEntries([{ ...theme, from: "look-nowhere" }]), /not a look/],
    ["a colour that is not one", withEntries([{ ...theme, variant: { foreground: "url(https://bad.example/)" } }]), /colour/],
    ["a font Rhema does not carry", withEntries([{ ...theme, variant: { fontFamily: "Comic Sans MS" } }]), /fontFamily/],
    ["a number that is not one", withEntries([{ ...theme, variant: { fontSize: "huge" } }]), /not a number/],
    ["markup in a name", withEntries([{ ...theme, name: "<img src=x>" }]), /plain text/],
    ["a box outside the frame", withEntries([{ id: "sc", name: "S", scene: { background: "#000000", layers: [{ kind: "camera", name: "C", box: { x: 60, y: 0, w: 60, h: 100 } }] } }]), /outside the frame/],
    ["a layer kind Rhema does not have", withEntries([{ id: "sc", name: "S", scene: { background: "#000000", layers: [{ kind: "iframe", name: "C", box: { x: 0, y: 0, w: 10, h: 10 } }] } }]), /kind of scene layer/],
    ["a layer in a missing look", withEntries([{ id: "sc", name: "S", scene: { background: "#000000", layers: [{ kind: "feed", name: "B", lookId: "not-here", box: { x: 0, y: 0, w: 100, h: 100 } }] } }]), /not a theme/],
    ["a layer in a name band, not a theme", withEntries([{ id: "band", name: "Band", from: "look-clean-speaker" }, { id: "sc", name: "S", scene: { background: "#000000", layers: [{ kind: "feed", name: "B", lookId: "band", box: { x: 0, y: 0, w: 100, h: 100 } }] } }]), /not a theme/],
  ])("refuses %s, saying why", (_what, json, why) => {
    expect(() => parseDesignPack(json)).toThrow(why)
  })

  it("Use, Reset and copies work on pack looks as on built-in ones", () => {
    const pack = parseDesignPack(source)
    const library = [...LIBRARY_LOOKS, ...pack.looks]
    let n = 0
    const newId = () => `id-${++n}`
    const scene = pack.looks.find((l): l is LookOf<"scene"> => l.id === `${PACK}/midnight-video-lyrics`)!
    const added = adoptLook(scene, { library, newId, now: 1 })
    expect(added.themes.map((t) => t.libraryLookId)).toEqual([`${PACK}/midnight-lyrics-full`])
    expect(added.scene?.libraryLookId).toBe(scene.id)
    // The video layer is an empty place: no video until the church chooses one.
    const video = added.scene!.layers.find((l) => l.kind === "video")!
    expect(video.mediaId ?? video.videoUrl ?? video.mediaFile).toBeUndefined()
    const s = { themes: added.themes, lowerThirdStyles: [], scenes: [added.scene!], tickerStyle: useBroadcastStore.getState().tickerStyle, stageStyle: useBroadcastStore.getState().stageStyle, outputs: [] }
    expect(lookCopies(scene, s).map((c) => c.id)).toEqual([added.scene!.id])
    // Reset puts the layers back where the template has them and uses the look copied before.
    const moved = { ...added.scene!, layers: added.scene!.layers.map((l) => ({ ...l, box: { x: 0, y: 0, w: 10, h: 10 } })) }
    const back = resetSceneCopy(moved, scene, { library, themes: added.themes, newId, now: 2 })
    expect(back.themes).toEqual([])
    expect(back.scene.layers.map((l) => [l.kind, l.box, l.themeId])).toEqual(added.scene!.layers.map((l) => [l.kind, l.box, l.themeId]))
    const look = pack.looks.find((l): l is LookOf<"theme"> => l.id === `${PACK}/midnight-bible-full`)!
    const copy = adoptLook(look, { library, newId, now: 1 }).themes[0]
    expect(resetCopy({ ...copy, verseText: { ...copy.verseText, color: "#ff0000" } }, look, 3).verseText.color).toBe(look.theme.verseText.color)
  })

  it("import adds to the library only, is kept, and comes back after a restart; removing leaves the copies", async () => {
    const before = useBroadcastStore.getState()
    const pack = parseDesignPack(source)
    await importDesignPack(pack)
    const after = useBroadcastStore.getState()
    for (const k of ["outputs", "scenes", "themes", "liveVerse", "isLive", "lowerThird", "ticker", "tickerStyle", "stageStyle"] as const) expect(after[k], k).toBe(before[k])
    expect(libraryLooks()).toHaveLength(LIBRARY_LOOKS.length + 120)
    expect(libraryFamilies().at(-1)?.id).toBe(`pack:${PACK}`)
    // Imported again: replaced, not doubled.
    await importDesignPack(pack)
    expect(useDesignPackStore.getState().packs).toHaveLength(1)

    resetDesignPacksForTests()
    files.get("rhema-design-packs.json")!.set("packs", [pack.doc, { format: "rhema.design-pack", version: 1, id: "broken", entries: [] }])
    await hydrateDesignPacks()
    expect(useDesignPackStore.getState().packs.map((p) => p.doc.id)).toEqual([PACK])

    await removeDesignPack(PACK)
    expect(libraryLooks()).toHaveLength(LIBRARY_LOOKS.length)
  })

  it("goes into a backup, shows as a change, and comes back checked again", async () => {
    expect(buildInstallationExport().designPacks).toBeUndefined()
    const pack = parseDesignPack(source)
    await importDesignPack(pack)
    const exp = buildInstallationExport()
    expect(exp.designPacks?.map((d) => d.id)).toEqual([PACK])
    const read = parseInstallationExport(JSON.stringify(exp))!
    expect(read.designPacks).toHaveLength(1)

    await removeDesignPack(PACK)
    const here = buildInstallationExport()
    expect(installationChanges(here, read)).toContainEqual({ what: "Design packs in the library", here: "0 packs: none", incoming: "1 pack: Rhema Studio · Worship Expressions" })
    // A backup from before packs says nothing about them.
    expect(installationChanges(here, { ...read, designPacks: undefined }).some((c) => c.what.startsWith("Design packs"))).toBe(false)

    const outputs = useBroadcastStore.getState().outputs
    await restoreInstallation({ ...read, designPacks: [...read.designPacks!, { format: "rhema.design-pack", version: 1, id: "bad", name: "Bad", author: "x", license: "x", entries: [{ id: "x", name: "X", from: "look-nowhere" }] }] })
    expect(useDesignPackStore.getState().packs.map((p) => p.doc.id)).toEqual([PACK])
    expect(useBroadcastStore.getState().outputs.map((o) => o.id)).toEqual(outputs.map((o) => o.id))
    expect(files.get("rhema-design-packs.json")!.get("packs")).toHaveLength(1)
  })
})
