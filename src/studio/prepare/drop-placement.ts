export type RundownDropPlacement = "before" | "after"
export type RundownDropCandidate = { id: string; top: number; bottom: number }

/** Resolves a stable insertion side from the pointer's position within a rundown target. */
export function placementAtPointer(pointerY: number, bounds: { top: number; bottom: number }): RundownDropPlacement {
  return pointerY < (bounds.top + bounds.bottom) / 2 ? "before" : "after"
}

/** Finds the closest peer row when sorting collision detection reports the active row itself. */
export function nearestPlacementTarget(
  pointerY: number,
  candidates: RundownDropCandidate[],
  excludedId: string,
): { targetId: string; placement: RundownDropPlacement } | null {
  const peers = candidates.filter((candidate) => candidate.id !== excludedId)
  if (peers.length === 0) return null
  const distance = (candidate: RundownDropCandidate) =>
    pointerY < candidate.top ? candidate.top - pointerY : pointerY > candidate.bottom ? pointerY - candidate.bottom : 0
  const target = peers.reduce((best, candidate) => distance(candidate) < distance(best) ? candidate : best)
  return { targetId: target.id, placement: placementAtPointer(pointerY, target) }
}
