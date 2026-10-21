/**
 * The video player inside an output window, kept outside React so the
 * element can be driven directly. One <video> per window, streamed from the
 * media folder (crossOrigin keeps the canvas readable for NDI). While it
 * plays, `onFrame` runs at the current NDI rate so the window redraws and
 * pushes NDI; at the end, on error or when paused it stops forcing frames.
 */
export interface VideoSpec {
  url: string
  fit: "cover" | "contain" | "stretch"
  loop: boolean
  sound: boolean
  name: string
  /** Changes on every present, so re-presenting the same file replays it while re-sends of the same live item do not. */
  token: number
}

/** loading: nothing to show yet (draw the background, never a label); ready: draw frames; failed: draw "▶ name". */
export type VideoState = "loading" | "ready" | "failed"

export interface VideoPlayer {
  element(): HTMLVideoElement | null
  state(): VideoState
  /** Play `spec`, or stop and release the file when it is undefined. */
  sync(spec: VideoSpec | undefined): void
  dispose(): void
}

export interface VideoPlayerHooks {
  onFrame: () => void
  onEnded: () => void
  onError: (name: string) => void
  /** Sound is played by one window only (the main output), so screens do not echo. */
  allowSound: boolean
  /** Redraw rate, read before every frame (the NDI rate when NDI is on). */
  fps: () => number
  create?: () => HTMLVideoElement
}

export function createVideoPlayer(h: VideoPlayerHooks): VideoPlayer {
  let el: HTMLVideoElement | null = null
  let key: string | null = null
  let name = "video"
  let failed = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const stopTimer = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  const tick = () => {
    timer = null
    if (!el || el.paused || el.ended || failed) return
    h.onFrame()
    timer = setTimeout(tick, Math.round(1000 / Math.max(15, h.fps() || 30)))
  }
  const startTimer = () => {
    if (timer || !el || el.paused || el.ended || failed) return
    timer = setTimeout(tick, 0)
  }
  const ensure = (): HTMLVideoElement => {
    if (el) return el
    const v = h.create ? h.create() : document.createElement("video")
    v.crossOrigin = "anonymous"
    v.playsInline = true
    v.preload = "auto"
    v.addEventListener("error", () => {
      if (!key) return // the src was just released on purpose
      failed = true
      stopTimer()
      h.onError(name)
    })
    v.addEventListener("ended", () => {
      stopTimer()
      h.onEnded()
    })
    v.addEventListener("playing", startTimer)
    v.addEventListener("pause", stopTimer)
    el = v
    return v
  }

  return {
    element: () => el,
    state: () => (failed ? "failed" : el && el.readyState >= 2 && el.videoWidth > 0 ? "ready" : "loading"),
    sync(spec) {
      if (!spec) {
        stopTimer()
        if (el && key) {
          key = null
          el.pause()
          el.removeAttribute("src")
          el.load()
        }
        key = null
        failed = false
        return
      }
      const v = ensure()
      name = spec.name
      v.loop = spec.loop
      v.muted = !(spec.sound && h.allowSound)
      const next = `${spec.token}|${spec.url}`
      if (key !== next) {
        key = next
        failed = false
        stopTimer()
        if (v.src === spec.url) v.currentTime = 0
        else v.src = spec.url
        void v.play().catch((e) => console.warn("[output-video] play() refused", e))
        return
      }
      // Same item re-sent (theme edit, window re-sync): keep playing, never restart or force frames after the end.
      startTimer()
    },
    dispose() {
      this.sync(undefined)
    },
  }
}
