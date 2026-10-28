/**
 * What a camera really shows on a screen (#213 signal truth: never "connected therefore working").
 * Counted on the video element itself: each new frame the browser presents
 * (requestVideoFrameCallback), and the decoded and dropped totals the browser keeps
 * (getVideoPlaybackQuality). A reading compares two samples: frames a second, the share dropped
 * between them, and how long ago the last new frame came.
 */

/** The counters at one moment. */
export interface MeterSample {
  /** performance.now() of the sample. */
  at: number
  /** Frames presented so far (requestVideoFrameCallback), or null where the browser lacks it. */
  presented: number | null
  /** The browser's totals (getVideoPlaybackQuality): frames it had, and of those dropped. */
  total: number | null
  dropped: number | null
  /** performance.now() of the last new frame seen; null: none yet (or not known). */
  lastFrameAt: number | null
}

export interface VideoReading {
  /** Frames a second shown between the two samples; null until there are two. */
  fps: number | null
  /** Since the video started: frames decoded (total less dropped) and dropped. */
  decoded: number | null
  dropped: number | null
  /** Of the frames between the two samples, the share dropped (0–100); null when none came. */
  droppedPct: number | null
  /** Since the last new frame (ms); null: none seen yet. */
  frameAgeMs: number | null
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** A reading from the sample before and this one. */
export function meterReading(prev: MeterSample | null, cur: MeterSample): VideoReading {
  const decoded = cur.total !== null && cur.dropped !== null ? Math.max(0, cur.total - cur.dropped) : null
  const frameAgeMs = cur.lastFrameAt === null ? null : Math.max(0, Math.round(cur.at - cur.lastFrameAt))
  const base = { decoded, dropped: cur.dropped, frameAgeMs }
  const secs = prev ? (cur.at - prev.at) / 1000 : 0
  if (!prev || secs <= 0.2) return { ...base, fps: null, droppedPct: null }
  // Frames shown: those presented if the browser counts them, else those it had less those dropped.
  const counted = (s: MeterSample) => s.presented ?? (s.total !== null && s.dropped !== null ? s.total - s.dropped : null)
  const a = counted(prev), b = counted(cur)
  // A count that went backwards is a new video: no rate from it.
  const fps = a !== null && b !== null && b >= a ? round1((b - a) / secs) : null
  const dTotal = prev.total !== null && cur.total !== null ? cur.total - prev.total : null
  const dDropped = prev.dropped !== null && cur.dropped !== null ? cur.dropped - prev.dropped : null
  const droppedPct = dTotal !== null && dDropped !== null && dTotal > 0 && dDropped >= 0 ? round1(Math.min(100, (dDropped / dTotal) * 100)) : null
  return { ...base, fps, droppedPct }
}

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { presentedFrames?: number }) => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

/** Counts one video element's frames; `read()` gives the reading since the last read. */
export class VideoMeter {
  private readonly video: FrameCallbackVideo
  private presented: number | null = null
  private lastFrameAt: number | null = null
  private handle: number | null = null
  private prev: MeterSample | null = null
  private closed = false

  constructor(video: HTMLVideoElement) {
    this.video = video as FrameCallbackVideo
    if (typeof this.video.requestVideoFrameCallback === "function") {
      this.presented = 0
      this.watch()
    }
  }

  private watch() {
    if (this.closed || !this.video.requestVideoFrameCallback) return
    this.handle = this.video.requestVideoFrameCallback((_now, meta) => {
      this.presented = typeof meta?.presentedFrames === "number" ? meta.presentedFrames : (this.presented ?? 0) + 1
      this.lastFrameAt = performance.now()
      this.watch()
    })
  }

  /** The counters now. Without frame callbacks, a new frame is known only by the totals growing. */
  sample(at = performance.now()): MeterSample {
    const q = typeof this.video.getVideoPlaybackQuality === "function" ? this.video.getVideoPlaybackQuality() : null
    const total = q ? q.totalVideoFrames : null
    const dropped = q ? q.droppedVideoFrames : null
    if (this.presented === null && total !== null && (this.prev?.total ?? -1) !== total && total > 0) this.lastFrameAt = at
    return { at, presented: this.presented, total, dropped, lastFrameAt: this.lastFrameAt }
  }

  /** The reading since the last read (the first has no rate yet). */
  read(at = performance.now()): VideoReading {
    const cur = this.sample(at)
    const r = meterReading(this.prev, cur)
    this.prev = cur
    return r
  }

  close() {
    this.closed = true
    if (this.handle !== null) this.video.cancelVideoFrameCallback?.(this.handle)
    this.handle = null
  }
}
