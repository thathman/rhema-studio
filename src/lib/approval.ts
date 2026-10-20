import type { Program } from "@/types"

export type ApprovalState = "approved" | "changed" | "none"

/**
 * Where a saved service stands against its approval: approved as it is,
 * changed since (saved again after approving), or never approved.
 */
export function approvalState(p: Pick<Program, "revision" | "approved_revision"> | null): ApprovalState {
  if (!p || p.approved_revision === null || p.approved_revision === undefined) return "none"
  return p.approved_revision === p.revision ? "approved" : "changed"
}

export function approvalLabel(p: Pick<Program, "revision" | "approved_revision" | "approved_at"> | null): string {
  switch (approvalState(p)) {
    case "approved": return `Approved${p?.approved_at ? ` ${new Date(p.approved_at).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : ""}`
    case "changed": return `Changed since approval (v${p?.approved_revision} approved, now v${p?.revision})`
    default: return "Not approved yet"
  }
}
