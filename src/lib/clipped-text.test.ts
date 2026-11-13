import { describe, expect, it, vi } from "vitest"

// Measuring is the renderer's job (tested there): here, "too long" is any text over 40 letters.
vi.mock("@/lib/verse-renderer", () => ({
  onThemeFontsLoaded: () => () => {},
  textClipped: (_theme: unknown, v: { lines?: string[]; secondaryLines?: string[]; segments: Array<{ text: string }> }) =>
    [...(v.lines ?? v.segments.map((s) => s.text)), ...(v.secondaryLines ?? [])].join(" ").length > 40,
}))

import { clippedText } from "@/lib/clipped-text"
import type { QueueItem, SongWithSections } from "@/types"
import type { BroadcastTheme } from "@/types/broadcast"
import type { BroadcastOutput } from "@/types/broadcast-output"

const theme = { id: "t" } as BroadcastTheme
const output = (name: string, over: Partial<BroadcastOutput> = {}) => ({ id: name, name, themeId: "t", ...over }) as BroadcastOutput
const verse = (reference: string, text: string, over: Partial<QueueItem> = {}) =>
  ({ id: reference, reference, verse: { verse: 1, text }, confidence: 1, source: "manual", added_at: 0, ...over }) as unknown as QueueItem

describe("words a congregation screen would cut off (#217)", () => {
  it("names each long verse per congregation screen, never Stage or hidden items", () => {
    const items = [
      verse("John 3:16", "For God so loved the world"),
      verse("Psalm 119:1", "Blessed are the undefiled in the way, who walk in the law"),
      verse("Psalm 119:2", "Blessed are they that keep his testimonies always", { hidden: true }),
    ]
    const outputs = [output("Main Display"), output("Stage", { role: "stage" }), output("Lobby TV", { role: "congregation" })]
    expect(clippedText(items, {}, outputs, [theme])).toEqual([
      { what: "Psalm 119:1", output: "Main Display" },
      { what: "Psalm 119:1", output: "Lobby TV" },
    ])
  })

  it("checks each song slide as the screen's language shows it; songs not loaded are left out", () => {
    const song = {
      song: { id: "s1", title: "Abide", primary_language: "en", licence: "public_domain" },
      sections: [{ id: "v1", kind: "verse", label: "Verse 1", texts: { en: "Abide with me fast falls the eventide", yo: "Ba mi gbe ale le tan ni kiakia oluwa" } }],
      arrangements: [{ id: "a", name: "Default", is_default: true, sequence: ["v1", "v1"] }],
      numbers: [],
    } as unknown as SongWithSections
    const item = { id: "i", kind: "song", reference: "Abide", song: { song_id: "s1", title: "Abide", languages: ["en", "yo"] }, confidence: 1, source: "manual", added_at: 0 } as unknown as QueueItem
    const both = clippedText([item], { s1: song }, [output("Main Display")], [theme])
    const english = clippedText([item], { s1: song }, [output("Main Display", { language: "first" })], [theme])
    // A section sung twice is one slide to fix, said once.
    expect(both).toEqual([{ what: "Abide · Verse 1", output: "Main Display" }])
    expect(english).toEqual([])
    expect(clippedText([item], {}, [output("Main Display")], [theme])).toEqual([])
  })

  it("leaves out screens that never show it: a Bible-only feed for songs, a scene", () => {
    const long = [verse("Psalm 119:1", "Blessed are the undefiled in the way, who walk in the law")]
    const outputs = [output("Songs feed", { shows: ["song"] }), output("Camera", { sceneId: "cam" }), output("Bible feed", { shows: ["bible"] })]
    expect(clippedText(long, {}, outputs, [theme])).toEqual([{ what: "Psalm 119:1", output: "Bible feed" }])
  })
})
