/**
 * The video player inside an output window, kept outside React so the
 * element can be driven directly. One <video> per window, streamed from the
 * media folder (crossOrigin keeps the canvas readable for NDI). While it
 * plays, `onFrame` runs on a timer so the window redraws and pushes NDI.
 */
export interface VideoSpec {
  url: string
  fit: "cover" | "contain" | "stretch"
  loop: boolean
  sound: boolean
  name: string
}

export interface VideoPlayer {
  element(): HTMLVideoElement | null
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
  /** Redraw rate, read each time playback starts (the NDI rate when NDI is on). */
  fps: () => number
  create?: () => HTMLVideoElement
}

export function createVideoPlayer(h: VideoPlayerHooks): VideoPlayer {
  let el: HTMLVideoElement | null = null
  let url: string | null = null
  let name = "video"
  let timer: ReturnType<typeof setInterval> | null = null

  const stopTimer = () => {
    if (timer) clearInterval(timer)
    timer = null
  }
  const startTimer = () => {
    if (timer) return
    timer = setInterval(h.onFrame, Math.round(1000 / Math.max(15, h.fps() || 30)))
  }
  const ensure = (): HTMLVideoElement => {
    if (el) return el
    const v = h.create ? h.create() : document.createElement("video")
    v.crossOrigin = "anonymous"
    v.playsInline = true
    v.preload = "auto"
    v.addEventListener("error", () => {
      stopTimer()
      h.onError(name)
    })
    v.addEventListener("ended", () => {
      stopTimer()
      h.onEnded()
    })
    v.addEventListener("play", startTimer)
    el = v
    return v
  }

  return {
    element: () => el,
    sync(spec) {
      if (!spec) {
        stopTimer()
        if (el && url) {
          el.pause()
          el.removeAttribute("src")
          el.load()
        }
        url = null
        return
      }
      const v = ensure()
      name = spec.name
      v.loop = spec.loop
      v.muted = !(spec.sound && h.allowSound)
      if (url !== spec.url) {
        url = spec.url
        v.src = spec.url
        void v.play().catch((e) => console.warn("[output-video] play() refused", e))
      }
      startTimer()
    },
    dispose() {
      this.sync(undefined)
    },
  }
}
