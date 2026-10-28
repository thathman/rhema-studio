/**
 * Decide when an NDI sender is in trouble from the stream of frame pushes:
 * a few consecutive failures mean the stream is dead on the network even
 * though the output still says "on"; the first success afterwards means it
 * is back. Pure, so the thresholds are tested.
 */
export interface NdiHealth {
  failures: number
  troubled: boolean
}

export const NDI_TROUBLE_AFTER = 3

export function initialNdiHealth(): NdiHealth {
  return { failures: 0, troubled: false }
}

export function pushOutcome(h: NdiHealth, ok: boolean): { state: NdiHealth; event: "trouble" | "recovered" | null } {
  if (ok) {
    return { state: { failures: 0, troubled: false }, event: h.troubled ? "recovered" : null }
  }
  const failures = h.failures + 1
  if (!h.troubled && failures >= NDI_TROUBLE_AFTER) return { state: { failures, troubled: true }, event: "trouble" }
  return { state: { failures, troubled: h.troubled }, event: null }
}
