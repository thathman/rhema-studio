import { describe, expect, it } from "vitest"
import type { QueueItem } from "@/types"
import { cleanComments, commentKey, parseComments, unreadComments } from "./comments"

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

  it("counts comments this computer has not read, by identity, whatever the service copy or clock", () => {
    const c = (by: string, at: string, text: string) => ({ by, at, text })
    const items = [item([c("Pastor Ade", "2026-10-21T09:00:00Z", "old"), c("Pastor Ade", "2026-10-21T11:00:00Z", "new"), c("Tolu", "2026-10-21T11:30:00Z", "my own")])]
    expect(unreadComments(items, new Set(), "tolu").map((u) => u.comment.text)).toEqual(["old", "new"])
    // Read "old" in an earlier copy of the service: still read in this copy.
    expect(unreadComments(items, new Set([commentKey(c("Pastor Ade", "2026-10-21T09:00:00Z", "old"))]), "Tolu").map((u) => u.comment.text)).toEqual(["new"])
    // No names set on either computer: the other computer's comments still count.
    expect(unreadComments([item([c("Unnamed", "2026-10-21T11:00:00Z", "from the pastor's laptop")])], new Set(), "")).toHaveLength(1)
  })
})
