/**
 * Whether a browser feed page (a TV, OBS Browser Source, a browser) is still hearing from the host
 * (#196). The host sends a frame on every change and, between them, a "beat" with its clock every
 * few seconds (FEED_BEAT in the host's server). A page that has heard nothing for this long shows
 * a small "Not updating" mark, rather than a still picture or a timer that looks fine. An older
 * host sends no beats: its page is called out of date only once its connection is lost.
 */
export const FEED_STALE_AFTER_MS = 10_000

export function feedStale(o: { now: number; lastHeard: number; beats: boolean; connected: boolean }): boolean {
  const quiet = o.now - o.lastHeard > FEED_STALE_AFTER_MS
  return quiet && (o.beats || !o.connected)
}

/** The page's clock minus the host's (ms), from a beat's host time and when it arrived here. */
export const pageClockSkew = (hostNow: number, localNow: number): number => Math.round(localNow - hostNow)
