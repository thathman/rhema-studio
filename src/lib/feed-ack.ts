/**
 * When a feed page tells the host a frame is on its screen (#604, #844 S20). The frame is drawn
 * synchronously; the acknowledgement waits for the next animation frame so it follows the paint.
 * A hidden page (an OBS browser source that is not in the current scene, a minimised tab) gets no
 * animation frames, so its acknowledgement would never arrive: there a timer sends it instead, and
 * a page that says it is visible but is not given frames sends it after ACK_FALLBACK_MS anyway.
 * Runs `done` exactly once.
 */
export const ACK_FALLBACK_MS = 1000

export interface AckClock {
  hidden: () => boolean
  frame: (fn: () => void) => void
  timer: (fn: () => void, ms: number) => unknown
}

export function afterDrawn(done: () => void, clock: AckClock): void {
  let sent = false
  const once = () => {
    if (sent) return
    sent = true
    done()
  }
  if (clock.hidden()) {
    clock.timer(once, 0)
    return
  }
  clock.frame(once)
  clock.timer(once, ACK_FALLBACK_MS)
}

/** The browser's own clock for afterDrawn. */
export const pageAckClock: AckClock = {
  hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
  frame: (fn) => requestAnimationFrame(() => fn()),
  timer: (fn, ms) => setTimeout(fn, ms),
}
