/**
 * How sure a heard verse must be for Auto to put it on air, as 0–1. A value
 * over 1 is read as a percentage ("80" from an HTTP controller means 0.8);
 * anything unusable falls back to 0.8. A level above 1 would otherwise stop
 * Auto for good, since confidence never exceeds 1.
 */
export function confidenceLevel(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 0.8
  const level = n > 1 ? n / 100 : n
  return Math.min(1, Math.max(0, level))
}
