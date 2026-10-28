import type { ItemTiming } from "@/types/queue"

/**
 * An item's timing rules as saved in its payload (#196 R1.2): `timing` with `milestone`,
 * `soft_end_minutes` and `warn_minutes`. Plain data, so service files and the church folder carry
 * it; an older build keeps it untouched (FR-03). Anything out of range is dropped, not guessed.
 */
const minutes = (m: unknown, most: number): m is number => typeof m === "number" && Number.isFinite(m) && m > 0 && m <= most

/** The rules worth saving, or null when there are none. */
export function cleanItemTiming(raw: unknown): ItemTiming | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const t = raw as Record<string, unknown>
  const out: ItemTiming = {
    ...(t.milestone === true ? { milestone: true } : {}),
    // A milestone takes no time, so it has no end to be soft about.
    ...(t.milestone !== true && minutes(t.soft_end_minutes, 600) ? { soft_end_minutes: Math.round(t.soft_end_minutes * 60) / 60 } : {}),
    ...(t.milestone !== true && minutes(t.warn_minutes, 120) ? { warn_minutes: Math.round(t.warn_minutes * 60) / 60 } : {}),
  }
  return Object.keys(out).length ? out : null
}

/** `timing` from any item's payload, as a spread: `{ timing }` or nothing. */
export function parseItemTiming(raw: string | null | undefined): { timing?: ItemTiming } {
  if (!raw) return {}
  try {
    const t = cleanItemTiming((JSON.parse(raw) as { timing?: unknown }).timing)
    return t ? { timing: t } : {}
  } catch {
    return {}
  }
}

/** The payload part to save: `{ timing }` or nothing. */
export function itemTimingPayload(t: ItemTiming | null | undefined): { timing?: ItemTiming } {
  const clean = cleanItemTiming(t)
  return clean ? { timing: clean } : {}
}

/** Minutes before its end that an item warns, by default (as the service timer always has). */
export const DEFAULT_WARN_MINUTES = 2

/** When the item's timer turns amber, ms before its end. */
export const warnMs = (t: ItemTiming | null | undefined): number => (cleanItemTiming(t)?.warn_minutes ?? DEFAULT_WARN_MINUTES) * 60_000
