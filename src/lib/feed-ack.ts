/**
 * When a feed page tells the host a frame is on its screen (#604, #844 S20). The frame is drawn
 * synchronously; the proof that it is visibly up is the next animation frame, which only a page on
 * screen gets. A hidden page (an OBS browser source off the current scene, a TV whose Home was
 * pressed) gets none, and an acknowledgement waiting for one would never arrive. So:
 *
 * - visible, and an animation frame comes: `done(true)`, the frame is on screen;
 * - hidden, or no animation frame within ACK_FALLBACK_MS: `done(false)` by timer, the frame was
 *   drawn but nobody can say it is seen. The page marks that acknowledgement hidden, and neither the
 *   host nor Rhema Studio Receiver may count it as shown;
 * - an animation frame that comes after the timer (the page shown again) still sends `done(true)`.
 *
 * `done` runs at most twice, never `false` after `true`.
 */
export const ACK_FALLBACK_MS = 1000

export interface AckClock {
  hidden: () => boolean
  frame: (fn: () => void) => void
  timer: (fn: () => void, ms: number) => unknown
}

export function afterDrawn(done: (seen: boolean) => void, clock: AckClock): void {
  let seen = false
  let told = false
  clock.frame(() => {
    if (seen) return
    seen = true
    done(true)
  })
  clock.timer(() => {
    if (seen || told) return
    told = true
    done(false)
  }, clock.hidden() ? 0 : ACK_FALLBACK_MS)
}

/** The browser's own clock for afterDrawn. */
export const pageAckClock: AckClock = {
  hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
  frame: (fn) => requestAnimationFrame(() => fn()),
  timer: (fn, ms) => setTimeout(fn, ms),
}

/**
 * The acknowledgement's address: a hidden one says so in the query too (`&hidden=1`), because Rhema
 * Studio Receiver sees only the address of the page's requests, not their bodies (Guard.ackOf).
 */
export function ackUrl(id: string, key: string, seen: boolean): string {
  return `/api/v1/feed/${encodeURIComponent(id)}/ack?k=${encodeURIComponent(key)}${seen ? "" : "&hidden=1"}`
}
