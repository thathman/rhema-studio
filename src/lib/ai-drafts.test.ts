import { describe, expect, it } from "vitest"
import { draftToRundown, type AiDraft } from "./ai-drafts"

const draft: AiDraft = {
  v: 1, id: "d1", title: "Thanksgiving Service", date: "2026-11-29", created_at: "2026-10-23T05:00:00Z", client: { name: "Claude" }, assumptions: ["Sermon 35 minutes"],
  phases: [
    { name: "Warm-up", role: "warmup", rule: "auto_once", items: [{ kind: "slide", status: "found", title: "Welcome", text: "Thanksgiving Sunday", planned_minutes: 5 }] },
    { name: "Main service", role: "main", rule: "manual", starts_at: "10:00", items: [
      { kind: "song", status: "found", song: { id: "s1", title: "Great Is Thy Faithfulness", primary_language: "en", languages: ["en", "yo"] }, planned_minutes: 6 },
      { kind: "missing", status: "missing", wanted: "hymn", title: "Now Thank We All Our God", planned_minutes: 4 },
      { kind: "verse", status: "found", reference: "Psalms 100:1-5", translation: "KJV", book_number: 19, book_name: "Psalms", chapter: 100, verse: 1, verses: 5, planned_minutes: 3 },
    ] },
  ],
}

describe("an AI draft opened in Prepare", () => {
  it("becomes the run of show it proposed, every item marked as the assistant's, missing songs as placeholders", () => {
    let n = 0
    const { items, headers } = draftToRundown(draft, () => `id${++n}`)
    expect(headers.map((h) => [h.name, h.at, h.role, h.rule, h.starts_at])).toEqual([["Warm-up", 0, "warmup", "auto_once", undefined], ["Main service", 1, "main", "manual", "10:00"]])
    expect(items.map((i) => i.reference)).toEqual(["Welcome", "Great Is Thy Faithfulness", "Missing hymn: Now Thank We All Our God", "Psalms 100:1-5"])
    expect(items.every((i) => i.prepared_by === "AI draft · Claude")).toBe(true)
    expect(items.map((i) => i.planned_minutes)).toEqual([5, 6, 4, 3])
    expect(items[1]).toMatchObject({ kind: "song", song: { song_id: "s1", languages: ["en", "yo"] } })
    expect(items[2]).toMatchObject({ kind: "slide", slide: { body: "" } })
    expect(items[2].notes).toContain("Not found in the library")
    expect(items[3]).toMatchObject({ verse: { book_number: 19, chapter: 100, verse: 1 }, translation: "KJV" })
  })
})
