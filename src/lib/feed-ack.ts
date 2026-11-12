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

/**
 * What a feed page has drawn and acknowledged, by host run. The host numbers frames from 1 again
 * each time it starts (a quit and relaunch, a crash), and a page that is not reloaded keeps its
 * numbers from before: without a new run, every frame of the restarted host is "older" than the
 * last one drawn, so no drawn frame is acknowledged again, and the page's beat acknowledgements name
 * a frame the new host never sent, which it refuses.
 *
 * Within one host run the stream's frame numbers never go down (a reconnect starts at the frame
 * shown now), so a lower number than the last one heard, the restarted host's `0` ("off") included,
 * starts a new run: nothing drawn in it yet, and an acknowledgement still pending from the old run
 * is dropped.
 */
export interface DrawnFrames {
  /** The newest frame drawn in this run (what the page acknowledges); 0 before any. */
  seq: number
  /** Whether `seq` was seen on screen, not only drawn by a hidden page (#844). */
  seen: boolean
  /** The host run, counted by this page from 0. */
  run: number
  /** The last frame number heard on the stream, -1 before any. */
  heard: number
}

export const drawnFrames = (): DrawnFrames => ({ seq: 0, seen: false, run: 0, heard: -1 })

/** A frame numbered `seq` came on the stream: the run it belongs to (a new one when the number went down). */
export function frameHeard(d: DrawnFrames, seq: number): number {
  if (seq < d.heard) {
    d.run += 1
    d.seq = 0
    d.seen = false
  }
  d.heard = seq
  return d.run
}

/** Frame `seq` of run `run` is drawn: whether to acknowledge it (not late, not from an earlier run). */
export function frameDrawn(d: DrawnFrames, seq: number, run: number, seen: boolean): boolean {
  if (run !== d.run || seq < d.seq) return false
  d.seq = seq
  d.seen = seen
  return true
}
