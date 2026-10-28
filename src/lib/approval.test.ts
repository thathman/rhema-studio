import { describe, expect, it } from "vitest"
import { approvalBlockers, approvalLabel, approvalState, eventPlanApprovalState } from "./approval"
import type { ImageQueueItem, SongQueueItem, VerseQueueItem } from "@/types"

describe("approval state", () => {
  it("is none, approved or changed depending on the approved revision", () => {
    expect(approvalState(null)).toBe("none")
    expect(approvalState({ revision: 3, approved_revision: null })).toBe("none")
    expect(approvalState({ revision: 3, approved_revision: 3 })).toBe("approved")
    expect(approvalState({ revision: 5, approved_revision: 3 })).toBe("changed")
    expect(approvalLabel({ revision: 5, approved_revision: 3, approved_at: null })).toBe("Changed since approval (v3 approved, now v5)")
    expect(approvalLabel({ revision: 3, approved_revision: 3, approved_at: null })).toBe("Approved")
    expect(approvalLabel({ revision: 3, approved_revision: 3, approved_at: null, approved_by: "Tolu" })).toBe("Approved by Tolu")
  })

  it("derives an event plan's approval from the saved service revision", () => {
    expect(eventPlanApprovalState(null, false)).toBe("draft")
    expect(eventPlanApprovalState({ revision: 3, approved_revision: null }, false)).toBe("draft")
    expect(eventPlanApprovalState({ revision: 3, approved_revision: 3 }, false)).toBe("approved")
    expect(eventPlanApprovalState({ revision: 4, approved_revision: 3 }, false)).toBe("changed")
    expect(eventPlanApprovalState({ revision: 3, approved_revision: 3 }, true)).toBe("changed")
  })

  it("refuses approval while a song or picture is missing, in plain words", () => {
    const song = (id: string, title: string): SongQueueItem => ({ id, kind: "song", song: { song_id: id, title, arrangement_id: null, languages: ["en"] }, reference: title, confidence: 1, source: "manual", added_at: 0 })
    const pic = (media_id: string, name: string): ImageQueueItem => ({ id: media_id, kind: "image", image: { media_id, name, fit: "cover" }, reference: name, confidence: 1, source: "manual", added_at: 0, notes: null })
    const verse: VerseQueueItem = { id: "v", verse: { id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 3, verse: 16, text: "" }, reference: "John 3:16", confidence: 1, source: "manual", added_at: 0, background: { media_id: "bg", name: "Sky" } }
    const items = [song("s1", "Amazing Grace"), song("s2", "How Great"), pic("m1", "Welcome"), verse]
    expect(approvalBlockers(items, [], [{ id: "m1", present: true }, { id: "bg", present: true }])).toEqual([])
    expect(approvalBlockers(items, ["s2"], [{ id: "m1", present: false }])).toEqual([
      "A song is not in the library: How Great.",
      "2 media files are missing from the media folder: Welcome, Sky.",
    ])
  })
})
