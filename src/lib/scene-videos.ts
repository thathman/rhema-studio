/**
 * The video layers of the scene up (#243 SC.9): one looping, silent <video> per layer, started when
 * the scene comes up and released when it goes. An output window plays the file from the media
 * folder; a browser feed plays it from the host. The scene draws from them like a camera.
 */
export interface VideoLayerLike {
  id: string
  kind: string
  videoUrl?: string
  mediaFile?: string
}

/** Start new players, stop the ones whose layer is gone or plays another file. `src` says where each layer's video is (none: not played). */
export function syncSceneVideos(players: Map<string, HTMLVideoElement>, layers: VideoLayerLike[], src: (l: VideoLayerLike) => string | undefined, onChange: () => void, create: () => HTMLVideoElement = () => document.createElement("video")): void {
  const want = new Map<string, string>()
  for (const l of layers) {
    const url = l.kind === "video" ? src(l) : undefined
    if (url) want.set(l.id, url)
  }
  for (const [id, v] of players) {
    if (want.get(id) === v.dataset.src) continue
    stopVideo(v)
    players.delete(id)
  }
  for (const [id, url] of want) {
    if (players.has(id)) continue
    const v = create()
    v.muted = true
    v.loop = true
    v.playsInline = true
    v.preload = "auto"
    // The canvas stays readable (NDI reads its pixels).
    v.crossOrigin = "anonymous"
    v.dataset.src = url
    v.addEventListener("loadeddata", onChange)
    v.addEventListener("playing", onChange)
    v.addEventListener("error", onChange)
    v.src = url
    void Promise.resolve(v.play()).catch(() => {})
    players.set(id, v)
  }
}

/** Stop a player and let go of its file. */
export function stopVideo(v: HTMLVideoElement): void {
  v.pause()
  v.removeAttribute("src")
  v.load()
  v.remove()
}

/** A player with a picture to draw. */
export const videoReady = (v: HTMLVideoElement | undefined): v is HTMLVideoElement => !!v && v.readyState >= 2 && v.videoWidth > 0 && !v.error

/** Any video layer is playing: its frames move, so the picture has to be redrawn. */
export function videosPlaying(players: Map<string, HTMLVideoElement>): boolean {
  return [...players.values()].some((v) => videoReady(v) && !v.paused)
}
