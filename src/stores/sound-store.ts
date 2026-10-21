import { create } from "zustand"
import { useJournalStore } from "@/stores/journal-store"
import { useMediaStore } from "@/stores/media-store"

/**
 * Walk-in music, a backing track, a sound effect (PRD MD-002 audio): one
 * sound at a time from the media library, played on this computer's sound
 * output. Screens are never touched. The element lives outside React.
 */
let audio: HTMLAudioElement | null = null
let fade: ReturnType<typeof setInterval> | null = null
// A newer play() supersedes a slower, older one still looking up its file.
let ticket = 0

export const FADE_MS = 3000

interface SoundState {
  assetId: string | null
  name: string
  playing: boolean
  /** Seconds. */
  position: number
  duration: number
  loop: boolean
  /** 0–1 */
  volume: number
  fading: boolean
  error: string | null
  play: (asset: { id: string; name: string }) => Promise<void>
  pause: () => void
  resume: () => void
  stop: () => void
  fadeOut: (ms?: number) => void
  setLoop: (loop: boolean) => void
  setVolume: (volume: number) => void
}

function clearFade() {
  if (fade) clearInterval(fade)
  fade = null
}

export const useSoundStore = create<SoundState>((set, get) => ({
  assetId: null,
  name: "",
  playing: false,
  position: 0,
  duration: 0,
  loop: false,
  volume: 1,
  fading: false,
  error: null,

  play: async ({ id, name }) => {
    const mine = ++ticket
    const url = await useMediaStore.getState().fileUrl(id).catch(() => null)
    if (mine !== ticket) return
    if (!url) {
      set({ error: `${name} is missing from the media folder.` })
      return
    }
    get().stop()
    const el = new Audio(url)
    el.loop = get().loop
    el.volume = get().volume
    el.addEventListener("timeupdate", () => { if (audio === el) set({ position: el.currentTime }) })
    el.addEventListener("loadedmetadata", () => { if (audio === el) set({ duration: Number.isFinite(el.duration) ? el.duration : 0 }) })
    el.addEventListener("ended", () => { if (audio === el) set({ playing: false, position: 0 }) })
    el.addEventListener("error", () => { if (audio === el) set({ playing: false, error: `${name} could not play. Try an MP3 or M4A file.` }) })
    audio = el
    set({ assetId: id, name, playing: true, position: 0, duration: 0, error: null, fading: false })
    useJournalStore.getState().add({ kind: "sound", label: name })
    try {
      await el.play()
    } catch (e) {
      if (audio === el) set({ playing: false, error: `${name} could not play: ${e instanceof Error ? e.message : String(e)}` })
    }
  },

  pause: () => {
    audio?.pause()
    set({ playing: false })
  },

  resume: () => {
    if (!audio) return
    void audio.play().catch(() => {})
    set({ playing: true })
  },

  stop: () => {
    clearFade()
    if (audio) {
      audio.pause()
      audio.removeAttribute("src")
      audio.load()
    }
    audio = null
    set({ assetId: null, name: "", playing: false, position: 0, duration: 0, fading: false })
  },

  /** Lower the volume to nothing over `ms`, then stop; the volume setting is kept for the next sound. */
  fadeOut: (ms = FADE_MS) => {
    const el = audio
    if (!el || fade) return
    const start = el.volume
    const steps = Math.max(1, Math.round(ms / 50))
    let i = 0
    set({ fading: true })
    fade = setInterval(() => {
      i += 1
      if (audio !== el) return clearFade()
      el.volume = Math.max(0, start * (1 - i / steps))
      if (i >= steps) get().stop()
    }, 50)
  },

  setLoop: (loop) => {
    if (audio) audio.loop = loop
    set({ loop })
  },

  setVolume: (volume) => {
    const v = Math.min(1, Math.max(0, volume))
    if (audio && !fade) audio.volume = v
    set({ volume: v })
  },
}))
