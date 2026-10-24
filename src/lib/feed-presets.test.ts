import { describe, expect, it, vi } from "vitest"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { existingFeed, FEED_PRESETS, readyMadeFeed, tickerOnly } from "@/lib/feed-presets"
import { outputFollows, outputPresentation } from "@/lib/output-summary"
import { defaultNdiSettings, type BroadcastOutput } from "@/types"

vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn().mockResolvedValue(undefined) }))

const preset = (id: string) => FEED_PRESETS.find((p) => p.id === id)!
const main: BroadcastOutput = { id: "main", name: "Main", type: "display", themeId: "builtin-modern-light", monitorIndex: 1, ndi: defaultNdiSettings("Rhema") }

describe("ready-made feeds (#299)", () => {
  it("offers the named feeds", () => {
    expect(FEED_PRESETS.map((p) => p.name)).toEqual(["Rhema Bible | Full", "Rhema Bible | Lower third", "Rhema Lyrics | Full", "Rhema Lyrics | Lower third", "Rhema Ticker | Alpha"])
  })

  it("Bible lower third: a new NDI output following the Bible, in Lower Thirds, alpha, with name bands", () => {
    const r = readyMadeFeed(preset("bible-l3"), "ndi", [main], BUILTIN_THEMES, () => "new-1")
    expect("output" in r).toBe(true)
    if (!("output" in r)) return
    expect(r.output).toEqual({
      id: "new-1", name: "Rhema Bible | Lower third", type: "ndi", role: "congregation", themeId: "builtin-broadcast-overlay",
      monitorIndex: 0, monitorName: null, shows: ["bible"], lowerThirds: true,
      ndi: { sourceName: "Rhema Bible | Lower third", resolution: "r1080p", frameRate: "fps24", alphaMode: "straightAlpha" },
    })
  })

  it("full-screen feeds are opaque; lyrics follow songs and hymns", () => {
    const r = readyMadeFeed(preset("lyrics-full"), "ndi", [main], BUILTIN_THEMES, () => "x")
    if (!("output" in r)) throw new Error("not added")
    expect(r.output).toMatchObject({ shows: ["song", "hymn"], themeId: "builtin-classic-dark", ndi: { alphaMode: "noneOpaque" } })
    expect(r.output.ticker).toBeUndefined()
  })

  it("the ticker feed follows only the ticker: no service content, the ticker on a transparent frame", () => {
    const r = readyMadeFeed(preset("ticker-alpha"), "ndi", [main], BUILTIN_THEMES, () => "t")
    if (!("output" in r)) throw new Error("not added")
    // Its ticker switch is on too, so an older build draws the ticker on it as well.
    expect(r.output).toMatchObject({ role: "congregation", shows: ["ticker"], ticker: true, themeId: "builtin-broadcast-overlay", ndi: { alphaMode: "straightAlpha" } })
    expect(r.output.signage).toBeUndefined()
    const keyed = BUILTIN_THEMES[2]
    expect(outputFollows(r.output, keyed)).toBe("Ticker")
    expect(outputPresentation(r.output, [], keyed)).toBe("Ticker only · transparent, for keying")
  })

  it("a ticker feed made by an earlier build (a signage loop with no pictures) still reads as the ticker feed", () => {
    const old: BroadcastOutput = { ...main, id: "t", name: "Rhema Ticker | Alpha", type: "ndi", role: "signage", ticker: true, signage: { mediaIds: [], seconds: 10 }, themeId: "builtin-broadcast-overlay", ndi: defaultNdiSettings("Rhema Ticker | Alpha") }
    const keyed = BUILTIN_THEMES[2]
    expect(tickerOnly(old, 0, keyed)).toBe(true)
    // A foyer loop still waiting for pictures, or on an opaque look, is not the ticker feed.
    expect(tickerOnly(old, 2, keyed)).toBe(false)
    expect(tickerOnly(old, 0, BUILTIN_THEMES[0])).toBe(false)
    expect(outputFollows(old, keyed)).toBe("The news ticker from Present")
    expect(outputFollows(old)).toBe("Nothing in the service (its own picture loop)")
    expect(outputPresentation(old, [], keyed)).toBe("Ticker only · transparent, for keying")
  })

  it("as a browser feed it gets its own link secret", () => {
    const r = readyMadeFeed(preset("bible-full"), "browser", [main], BUILTIN_THEMES, () => "b")
    if (!("output" in r)) throw new Error("not added")
    expect(r.output.type).toBe("browser")
    expect(r.output.feedToken).toMatch(/^[0-9a-f]{32}$/)
  })

  it("refuses a second output with the same NDI source name or name", () => {
    const obs: BroadcastOutput = { ...main, id: "obs", name: "OBS scripture", type: "ndi", ndi: defaultNdiSettings("rhema bible | full ") }
    const r = readyMadeFeed(preset("bible-full"), "ndi", [main, obs], BUILTIN_THEMES)
    expect(r).toEqual({ taken: obs })
    const named: BroadcastOutput = { ...main, id: "n", name: "Rhema Lyrics | Full", ndi: defaultNdiSettings("Something else") }
    expect(existingFeed(preset("lyrics-full"), [named])).toBe(named)
    expect(existingFeed(preset("lyrics-l3"), [named])).toBeUndefined()
  })

  it("uses the main output's look when the church no longer has the built-in one", () => {
    const r = readyMadeFeed(preset("bible-full"), "ndi", [main], [{ id: "builtin-modern-light" }], () => "m")
    if (!("output" in r)) throw new Error("not added")
    expect(r.output.themeId).toBe("builtin-modern-light")
  })

  it("adding one in the store changes no existing output and puts nothing on air", async () => {
    vi.resetModules()
    const { useBroadcastStore } = await import("@/stores/broadcast-store")
    const s = useBroadcastStore.getState()
    s.addOutput({ id: "obs", name: "OBS", type: "ndi", themeId: "builtin-broadcast-overlay", themeFor: { bible: "builtin-classic-dark" }, monitorIndex: 0, ndi: defaultNdiSettings("Rhema OBS") })
    const before = structuredClone(useBroadcastStore.getState().outputs)
    const statusBefore = structuredClone(useBroadcastStore.getState().outputStatus)
    for (const p of FEED_PRESETS) {
      const r = readyMadeFeed(p, "ndi", useBroadcastStore.getState().outputs, useBroadcastStore.getState().themes)
      if ("output" in r) useBroadcastStore.getState().addOutput(r.output)
    }
    const after = useBroadcastStore.getState()
    expect(after.outputs.slice(0, before.length)).toEqual(before)
    expect(after.outputs).toHaveLength(before.length + FEED_PRESETS.length)
    expect(new Set(after.outputs.map((o) => o.id)).size).toBe(after.outputs.length)
    expect(after.outputStatus).toEqual(statusBefore)
    // Asking again adds nothing.
    for (const p of FEED_PRESETS) expect("taken" in readyMadeFeed(p, "ndi", after.outputs, after.themes)).toBe(true)
  })
})
