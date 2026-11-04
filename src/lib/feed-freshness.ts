/**
 * Whether a browser feed page (a TV, OBS Browser Source, a browser) is still hearing from the host
 * (#196). The host sends a frame on every change and, between them, a "beat" with its clock every
 * few seconds (FEED_BEAT in the host's server). A page that has heard nothing for this long shows
 * a small "Not updating" mark, rather than a still picture or a timer that looks fine. An older
 * host sends no beats: its page is called out of date only once its connection is lost.
 */
export const FEED_STALE_AFTER_MS = 10_000

/** Keep aligned with FEED_BEAT in the host's feed server. */
export const FEED_BEAT_INTERVAL_MS = 3_000
/** Reopen a still-open browser stream after three beats went missing. */
export const FEED_RECONNECT_AFTER_MS = FEED_BEAT_INTERVAL_MS * 3

export type FeedFreshness = {
  lastHeard: number
  beats: boolean
  hasContent: boolean
  disconnected: boolean
}

export const initialFeedFreshness = (now: number): FeedFreshness => ({
  lastHeard: now,
  beats: false,
  hasContent: false,
  disconnected: false,
})

export const feedConnectionLost = (state: FeedFreshness): FeedFreshness => ({ ...state, disconnected: true })

export const feedReceivedFrame = (state: FeedFreshness, now: number): FeedFreshness => ({
  ...state,
  lastHeard: now,
  hasContent: true,
  disconnected: false,
})

export const feedReceivedBeat = (state: FeedFreshness, now: number): FeedFreshness => ({
  ...state,
  lastHeard: now,
  beats: true,
  disconnected: false,
})

export function feedStale(o: FeedFreshness & { now: number }): boolean {
  if (!o.hasContent) return false
  if (o.disconnected) return true
  const quiet = o.now - o.lastHeard > FEED_STALE_AFTER_MS
  return quiet && o.beats
}

/** A heartbeat-capable EventSource may stay OPEN after its network path has gone quiet. */
export function feedReconnectDue(state: FeedFreshness, now: number, eventSourceStartedAt: number): boolean {
  return state.beats
    && now - state.lastHeard >= FEED_RECONNECT_AFTER_MS
    && now - eventSourceStartedAt >= FEED_RECONNECT_AFTER_MS
}

/** The page's clock minus the host's (ms), from a beat's host time and when it arrived here. */
export const pageClockSkew = (hostNow: number, localNow: number): number => Math.round(localNow - hostNow)
