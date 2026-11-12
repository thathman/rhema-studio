import type { Program } from "@/types"

/** The backend checks both service approval and the pinned scene/output appearance on every Take. */
export function sceneTakeApprovalBlockReason(
  rehearsal: boolean,
  current: Pick<Program, "approved_revision"> | null,
  requireApproval: boolean,
): string | null {
  if (rehearsal) return null
  if (!current) return null
  if (requireApproval && (current.approved_revision === null || current.approved_revision === undefined)) {
    return "Approve this service before taking a scene to Program."
  }
  return null
}

/** Releasing a scene still uses a local mutable-state action, so it cannot change an approved Program. */
export function sceneReleaseApprovalBlockReason(
  rehearsal: boolean,
  current: Pick<Program, "approved_revision"> | null,
  requireApproval: boolean,
): string | null {
  if (rehearsal) return null
  if (!current) return null
  if (current.approved_revision !== null && current.approved_revision !== undefined) {
    return "This service has an approved scene appearance. Use a Take the main computer checks to change it."
  }
  if (requireApproval) return "Approve this service before changing a scene on Program."
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
    return "The main computer has not shared this service's approval status. Refresh the desk before taking a scene."
  }
  return sceneTakeApprovalBlockReason(rehearsal, current, requireApproval)
}

/** Connected desks cannot use the local release command to bypass an approved scene appearance. */
export function deskSceneReleaseApprovalBlockReason(
  rehearsal: boolean,
  current: Pick<Program, "approved_revision"> | null,
  requireApproval: boolean,
): string | null {
  if (rehearsal || !current) return null
  if (current.approved_revision === undefined) {
    return "The main computer has not shared this service's approval status. Refresh the desk before changing its scene."
  }
  return sceneReleaseApprovalBlockReason(rehearsal, current, requireApproval)
}
