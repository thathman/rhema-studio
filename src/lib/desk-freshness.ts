import type { JoinStatus } from "@/stores/join-store"

/** No Live State for longer than this, from a host that sends one every couple of seconds: the desk says so. */
export const STALE_AFTER_MS = 5_000
/** This desk's clock and the host's differ by more than this: the desk warns. */
export const SKEW_WARN_MS = 2_000

/**
 * How far a joined desk can trust what it shows (#196 R5): how long since the host last sent its
 * Live State, whether the clock and timer may be out of date (reconnecting, or a host that sends
 * every couple of seconds has gone quiet), and the clock difference worth a warning. Older hosts
 * that only send on a change are never called quiet.
 */
export function deskFreshness(o: { status: JoinStatus; receivedAt: number; now: number; heartbeatMs?: number; clockSkewMs: number | null }) {
  const sinceMs = Math.max(0, o.now - o.receivedAt)
  const quiet = o.heartbeatMs !== undefined && sinceMs > STALE_AFTER_MS
  const stale = o.status !== "connected" || quiet
  return {
    sinceMs,
    stale,
    /** Show "Last update N s ago". */
    showSince: stale && sinceMs > STALE_AFTER_MS,
    /** The skew to warn about, or null. */
    skewMs: o.clockSkewMs !== null && Math.abs(o.clockSkewMs) > SKEW_WARN_MS ? o.clockSkewMs : null,
  }
}

/** "3 s ahead of", "1 min 10 s behind". */
export function skewWords(ms: number): string {
  const s = Math.round(Math.abs(ms) / 1000)
  const t = s >= 60 ? `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}` : `${s} s`
  return `${t} ${ms > 0 ? "ahead of" : "behind"}`
}
