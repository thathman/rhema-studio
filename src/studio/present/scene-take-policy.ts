import type { Program } from "@/types"

/**
 * The local scene bridge currently applies the mutable saved scene. It is safe to offer only
 * when no approved service snapshot must be applied. Keep this guard in one place for every
 * Live scene entry point; the host remains authoritative for the actual command.
 */
export function sceneTakeApprovalBlockReason(
  rehearsal: boolean,
  current: Pick<Program, "approved_revision"> | null,
  requireApproval: boolean,
): string | null {
  if (rehearsal) return null
  if (!current) return null
  if (current.approved_revision !== null && current.approved_revision !== undefined) {
    return "This service has an approved design revision. Use its approved running-order Take; manual scene Take stays unavailable until the host can apply the pinned scene and captured output appearance."
  }
  if (requireApproval && (current.approved_revision === null || current.approved_revision === undefined)) {
    return "Approve this service before taking a scene to Program."
  }
  return null
}

/** Connected desks fail closed when an older host cannot say whether the service is approved. */
export function deskSceneTakeApprovalBlockReason(
  rehearsal: boolean,
  current: Pick<Program, "approved_revision"> | null,
  requireApproval: boolean,
): string | null {
  if (rehearsal || !current) return null
  if (current.approved_revision === undefined) {
    return "The host has not shared this service's approval status. Refresh the desk before taking a scene."
  }
  return sceneTakeApprovalBlockReason(rehearsal, current, requireApproval)
}
