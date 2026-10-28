import { describe, expect, it } from "vitest"
import type { QueueItem } from "@/types"
import { canDeleteComment, cleanComments, commentKey, parseComments, tombstoneComment, unreadComments } from "./comments"

const item = (comments: QueueItem["comments"]) => ({ id: "i1", reference: "John 3:16", comments }) as unknown as QueueItem

describe("team comments (CL-007)", () => {
  it("cleans comment text and assigns stable ids to legacy records", () => {
    const list = cleanComments([
      { by: " Ade\t(music) ", at: "2026-10-21T10:00:00Z", text: " Use the NKJV\nthen pause\u0007 " },
      { by: "", at: "2026-10-21T10:01:00Z", text: "x" },
      { by: "Tolu", at: "not a time", text: "dropped" },
      { by: "Tolu", at: "2026-10-21T10:02:00Z", text: "   " },
      "nonsense",
    ])
    expect(list).toMatchObject([
      { by: "Ade (music)", at: "2026-10-21T10:00:00Z", text: "Use the NKJV\nthen pause", id: expect.stringMatching(/^legacy-/) },
      { by: "Unnamed", at: "2026-10-21T10:01:00Z", text: "x", id: expect.stringMatching(/^legacy-/) },
    ])
    expect(cleanComments(Array.from({ length: 120 }, (_, k) => ({ by: "A", at: "2026-10-21T10:00:00Z", text: String(k) })))).toHaveLength(120)
    expect(Array.from(cleanComments([{ by: "A", at: "2026-10-21T10:00:00Z", text: "😀".repeat(1200) }])[0].text)).toHaveLength(1000)
    expect(parseComments(JSON.stringify({ comments: [{ by: "A", at: "2026-10-21T10:00:00Z", text: "hi" }] }))).toHaveLength(1)
    expect(parseComments("{}")).toBeNull()
  })

  it("keeps stable ids and deletion audit through service payload parsing", () => {
    const legacy = { by: "Ade", at: "2026-10-21T10:00:00Z", text: "Read slowly" }
    const parsedLegacy = cleanComments([legacy])[0]
    expect(parsedLegacy.id).toMatch(/^legacy-/)
    expect(parsedLegacy.id).toBe("legacy-2efa857cd2d7eab8")
    expect(cleanComments([legacy])[0].id).toBe(parsedLegacy.id)
    const tombstone = { id: "comment-1", ...legacy, deleted_by: "Ade", deleted_at: "2026-10-21T11:00:00Z" }
    expect(cleanComments([tombstone])).toEqual([tombstone])
  })

  it("uses stable IDs for read receipts and still recognizes receipts from older versions", () => {
    const first = { id: "comment-a", by: "Ade", at: "2026-10-21T10:00:00Z", text: "First" }
    const second = { id: "comment-b", by: "Ade", at: "2026-10-21T10:00:00Z", text: "Second" }
    expect(unreadComments([item([first, second])], new Set([commentKey(first)]), "Tolu").map((x) => x.comment.text)).toEqual(["Second"])
    expect(unreadComments([item([first, second])], new Set(["2026-10-21T10:00:00Z|Ade"]), "Tolu")).toEqual([])
  })

  it("allows only a named author to tombstone their comment and keeps it private from unread counts", () => {
    const comment = { id: "comment-1", by: "Ade", at: "2026-10-21T10:00:00Z", text: "Read slowly" }
    expect(tombstoneComment(comment, "Tolu")).toBeNull()
    expect(canDeleteComment({ ...comment, by: "Unnamed" }, "Unnamed")).toBe(false)
    const removed = tombstoneComment(comment, "Ade", "2026-10-21T11:00:00Z")!
    expect(removed).toMatchObject({ id: "comment-1", deleted_by: "Ade", deleted_at: "2026-10-21T11:00:00Z" })
    expect(unreadComments([item([removed])], new Set(), "Tolu")).toEqual([])
  })

  it("counts comments this computer has not read, by identity, whatever the service copy or clock", () => {
    const c = (by: string, at: string, text: string) => ({ by, at, text })
    const items = [item([c("Pastor Ade", "2026-10-21T09:00:00Z", "old"), c("Pastor Ade", "2026-10-21T11:00:00Z", "new"), c("Tolu", "2026-10-21T11:30:00Z", "my own")])]
    expect(unreadComments(items, new Set(), "tolu").map((u) => u.comment.text)).toEqual(["old", "new"])
    // Read "old" in an earlier copy of the service: still read in this copy.
    expect(unreadComments(items, new Set([commentKey(c("Pastor Ade", "2026-10-21T09:00:00Z", "old"))]), "Tolu").map((u) => u.comment.text)).toEqual(["new"])
    // No names set on either computer: the other computer's comments still count.
    expect(unreadComments([item([c("Unnamed", "2026-10-21T11:00:00Z", "from the pastor's laptop")])], new Set(), "")).toHaveLength(1)
    expect(unreadComments([item([c("Tolu Ade", "2026-10-21T11:00:00Z", "mine, from my laptop")])], new Set(), "  Tolu   Ade ")).toEqual([])
  })
})
