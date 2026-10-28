import { approvalState } from "@/lib/approval"
import { commentAuthor, commentDeleted, commentWasSeen } from "@/lib/comments"
import type { Program, QueueItem, RevisionSummary } from "@/types"

export type TeamChange =
  | { kind: "comment"; at: string; by: string; text: string; itemId: string; reference: string; unread: boolean; deletedBy: string | null }
  | { kind: "saved"; at: string; by: string | null; revision: number }
  | { kind: "approved"; at: string; by: string | null; revision: number; changedSince: boolean }

/** A saved time in milliseconds (0 when unreadable); a time without a zone is UTC, as the database writes it. */
export const changeTime = (iso: string) => {
  const t = Date.parse(iso.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`)
  return Number.isNaN(t) ? 0 : t
}

/**
 * The latest real changes to a service, newest first: comments others left on its items (only
 * known while it is open), who saved it last, and its approval. Nothing made up: no data, no rows.
 */
export function teamChanges(
  service: Program,
  items: QueueItem[] | null,
  revisions: RevisionSummary[],
  seen: ReadonlySet<string>,
  me: string,
  limit = 4,
): TeamChange[] {
  const mine = commentAuthor(me).toLowerCase()
  const comments: TeamChange[] = (items ?? []).flatMap((item) =>
    (item.comments ?? [])
      .filter((c) => commentDeleted(c) || !(mine && c.by.trim().toLowerCase() === mine))
      .map((c) => ({ kind: "comment" as const, at: c.deleted_at ?? c.at, by: c.by, text: c.text, itemId: item.id, reference: item.reference, unread: !commentDeleted(c) && !commentWasSeen(seen, c), deletedBy: c.deleted_by ?? null })),
  )
  const last = revisions.filter((r) => r.program_id === service.id).reduce<RevisionSummary | null>((a, r) => (!a || r.revision > a.revision ? r : a), null)
  const saved: TeamChange[] = last ? [{ kind: "saved", at: last.created_at, by: last.saved_by?.trim() || null, revision: last.revision }] : []
  const approved: TeamChange[] =
    service.approved_at && service.approved_revision != null
      ? [{ kind: "approved", at: service.approved_at, by: service.approved_by?.trim() || null, revision: service.approved_revision, changedSince: approvalState(service) === "changed" }]
      : []
  return [...comments, ...saved, ...approved].sort((a, b) => changeTime(b.at) - changeTime(a.at)).slice(0, limit)
}
