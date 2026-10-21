import { describe, expect, it } from "vitest"
import type { QueueItem } from "@/types"
import { cleanComments, parseComments, unreadComments } from "./comments"

const item = (comments: QueueItem["comments"]) => ({ id: "i1", reference: "John 3:16", comments }) as unknown as QueueItem

describe("team comments (CL-007)", () => {
  it("keeps what the crate accepts: trimmed, no control characters except line breaks, at most 100", () => {
    const list = cleanComments([
      { by: " Ade\t(music) ", at: "2026-10-21T10:00:00Z", text: " Use the NKJV\nthen pause\u0007 " },
      { by: "", at: "2026-10-21T10:01:00Z", text: "x" },
      { by: "Tolu", at: "not a time", text: "dropped" },
      { by: "Tolu", at: "2026-10-21T10:02:00Z", text: "   " },
      "nonsense",
    ])
    expect(list).toEqual([
      { by: "Ade (music)", at: "2026-10-21T10:00:00Z", text: "Use the NKJV\nthen pause" },
      { by: "Unnamed", at: "2026-10-21T10:01:00Z", text: "x" },
    ])
    expect(cleanComments(Array.from({ length: 120 }, (_, k) => ({ by: "A", at: "2026-10-21T10:00:00Z", text: String(k) })))).toHaveLength(100)
    expect(Array.from(cleanComments([{ by: "A", at: "2026-10-21T10:00:00Z", text: "😀".repeat(1200) }])[0].text)).toHaveLength(1000)
    expect(parseComments(JSON.stringify({ comments: [{ by: "A", at: "2026-10-21T10:00:00Z", text: "hi" }] }))).toHaveLength(1)
    expect(parseComments("{}")).toBeNull()
  })

  it("counts others' comments written since this computer last read them", () => {
    const items = [item([
      { by: "Pastor Ade", at: "2026-10-21T09:00:00Z", text: "old" },
      { by: "Pastor Ade", at: "2026-10-21T11:00:00Z", text: "new" },
      { by: "tolu", at: "2026-10-21T11:30:00Z", text: "my own" },
    ])]
    expect(unreadComments(items, undefined, "Tolu").map((u) => u.comment.text)).toEqual(["old", "new"])
    expect(unreadComments(items, "2026-10-21T10:00:00Z", "Tolu").map((u) => u.comment.text)).toEqual(["new"])
    expect(unreadComments(items, "2026-10-21T12:00:00Z", "Tolu")).toEqual([])
    expect(unreadComments([item([{ by: "Unnamed", at: "2026-10-21T11:00:00Z", text: "mine, no name set" }])], undefined, "")).toEqual([])
  })
})
