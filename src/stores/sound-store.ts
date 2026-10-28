import { create } from "zustand"
import { useJournalStore } from "@/stores/journal-store"
import { useMediaStore } from "@/stores/media-store"

/**
 * Walk-in music, a backing track, a sound effect (PRD MD-002 audio): one
 * sound at a time from the media library, played on this computer's sound
 * output. Screens are never touched. The element lives outside React.
 */
let audio: HTMLAudioElement | null = null
let pendingAudio: HTMLAudioElement | null = null
let fade: ReturnType<typeof setInterval> | null = null
const transitionFades = new Map<HTMLAudioElement, ReturnType<typeof setInterval>>()
// A newer play() supersedes a slower, older one still looking up its file.
let ticket = 0

export const FADE_MS = 3000
export const MAX_CUE_FADE_MS = 30_000

export interface SoundPlayOptions {
  itemId?: string
  outputDeviceId?: string
  volume?: number
  loop?: boolean
  fadeInMs?: number
  fadeOutMs?: number
}

interface SoundState {
  assetId: string | null
  itemId: string | null
  name: string
  playing: boolean
  /** Seconds. */
  position: number
  duration: number
  loop: boolean
  /** 0–1 */
  volume: number
  fading: boolean
  fadeDirection: "in" | "out" | null
  fadeOutMs: number
  outputNote: string | null
  error: string | null
  play: (asset: { id: string; name: string } & SoundPlayOptions) => Promise<boolean>
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

function discardAudio(el: HTMLAudioElement) {
  el.pause()
  el.removeAttribute("src")
  el.load()
}

function cancelPendingAudio() {
  const pending = pendingAudio
  if (!pending) return
  pendingAudio = null
  discardAudio(pending)
}

/** Stop any older transition tails before a newly confirmed cue becomes current. */
function clearTransitionFades() {
  for (const [el, timer] of transitionFades) {
    clearInterval(timer)
    discardAudio(el)
  }
  transitionFades.clear()
}

/** Fade a replaced cue independently so the new cue's own fade-in remains intact. */
function fadeReplacedAudio(el: HTMLAudioElement, ms: number) {
  const duration = Math.max(0, Math.min(MAX_CUE_FADE_MS, ms))
  if (duration === 0) {
    discardAudio(el)
    return
  }
  const start = el.volume
  const steps = Math.max(1, Math.round(duration / 50))
  let step = 0
  const timer = setInterval(() => {
    step += 1
    el.volume = Math.max(0, start * (1 - step / steps))
    if (step >= steps) {
      clearInterval(timer)
      transitionFades.delete(el)
      discardAudio(el)
    }
  }, 50)
  transitionFades.set(el, timer)
}

/** A fade interrupted by Pause or Resume: back to the chosen volume. */
function cancelFade(volume: number) {
  if (!fade) return
  clearFade()
  if (audio) audio.volume = volume
}

export const useSoundStore = create<SoundState>((set, get) => ({
  assetId: null,
  itemId: null,
  name: "",
  playing: false,
  position: 0,
  duration: 0,
  loop: false,
  volume: 1,
  fading: false,
  fadeDirection: null,
  fadeOutMs: 0,
  outputNote: null,
  error: null,

  play: async ({ id, name, itemId, outputDeviceId, volume, loop, fadeInMs = 0, fadeOutMs = 0 }) => {
    const mine = ++ticket
    cancelPendingAudio()
    const url = await useMediaStore.getState().fileUrl(id).catch(() => null)
    if (mine !== ticket) return false
    if (!url) {
      set({ error: `${name} is missing from the media folder.` })
      return false
    }
    const el = new Audio(url)
    const playVolume = Math.min(1, Math.max(0, volume ?? get().volume))
    el.loop = loop ?? get().loop
    // Keep the current track audible until the replacement confirms it can play.
    // This also prevents the two tracks overlapping during the play() handshake.
    el.volume = 0
    el.addEventListener("timeupdate", () => { if (audio === el) set({ position: el.currentTime }) })
    el.addEventListener("loadedmetadata", () => { if (audio === el) set({ duration: Number.isFinite(el.duration) ? el.duration : 0 }) })
    el.addEventListener("ended", () => { if (audio === el) set({ playing: false, position: 0 }) })
    el.addEventListener("error", () => { if (audio === el) set({ playing: false, error: `${name} could not play. Try an MP3 or M4A file.` }) })
    pendingAudio = el
    try {
      let outputNote: string | null = null
      if (outputDeviceId) {
        const setSinkId = (el as HTMLAudioElement & { setSinkId?: (deviceId: string) => Promise<void> }).setSinkId
        if (typeof setSinkId === "function") {
          try {
            await setSinkId.call(el, outputDeviceId)
          } catch {
            outputNote = "The selected audio output is unavailable; using this computer’s default output."
          }
        } else {
          outputNote = "This app cannot choose an audio output here; using this computer’s default output."
        }
      }
      if (mine !== ticket || pendingAudio !== el) {
        if (pendingAudio === el) {
          pendingAudio = null
          discardAudio(el)
        }
        return false
      }
      await el.play()
      if (mine !== ticket || pendingAudio !== el || el.paused) {
        if (pendingAudio === el) {
          pendingAudio = null
          discardAudio(el)
        }
        return false
      }
      pendingAudio = null
      const previous = audio
      const previousFadeOutMs = get().fadeOutMs
      clearFade()
      clearTransitionFades()
      audio = el
      if (previous && previous !== el) {
        if (previousFadeOutMs > 0) fadeReplacedAudio(previous, previousFadeOutMs)
        else discardAudio(previous)
      }
      const fadeIn = Math.max(0, Math.min(MAX_CUE_FADE_MS, fadeInMs))
      el.volume = fadeIn > 0 ? 0 : playVolume
      set({ assetId: id, itemId: itemId ?? null, name, playing: true, position: el.currentTime, duration: Number.isFinite(el.duration) ? el.duration : 0, volume: playVolume, loop: el.loop, fadeOutMs: Math.max(0, Math.min(MAX_CUE_FADE_MS, fadeOutMs)), outputNote, error: null, fading: fadeIn > 0, fadeDirection: fadeIn > 0 ? "in" : null })
      useJournalStore.getState().add({ kind: "sound", label: name, itemId: itemId ?? null })
      if (fadeIn > 0) {
        const steps = Math.max(1, Math.round(fadeIn / 50))
        let step = 0
        fade = setInterval(() => {
          step += 1
          if (audio !== el) return clearFade()
          el.volume = playVolume * Math.min(1, step / steps)
          if (step >= steps) {
            clearFade()
            set({ fading: false, fadeDirection: null })
          }
        }, 50)
      }
      return true
    } catch (e) {
      if (pendingAudio === el) {
        pendingAudio = null
        discardAudio(el)
        set({ error: `${name} could not play: ${e instanceof Error ? e.message : String(e)}` })
      }
      return false
    }
  },

  pause: () => {
    if (pendingAudio) {
      ticket += 1
      cancelPendingAudio()
    }
    cancelFade(get().volume)
    audio?.pause()
    set({ playing: false, fading: false, fadeDirection: null })
  },

  resume: () => {
    const el = audio
    if (!el) return
    cancelFade(get().volume)
    set({ playing: true, fading: false, fadeDirection: null, error: null })
    el.play().catch((e) => {
      if (audio === el) set({ playing: false, error: `${get().name} could not resume: ${e instanceof Error ? e.message : String(e)}` })
    })
  },

  stop: () => {
    ticket += 1 // a play() still looking up its file must not start after Stop
    clearFade()
    cancelPendingAudio()
    clearTransitionFades()
    if (audio) discardAudio(audio)
    audio = null
    set({ assetId: null, itemId: null, name: "", playing: false, position: 0, duration: 0, fading: false, fadeDirection: null, fadeOutMs: 0, outputNote: null, error: null })
  },

  /** Lower the volume to nothing over `ms`, then stop; the volume setting is kept for the next sound. */
  fadeOut: (ms = FADE_MS) => {
    const el = audio
    if (!el || (fade && get().fadeDirection === "out")) return
    clearFade()
    const start = el.volume
    const steps = Math.max(1, Math.round(ms / 50))
    let i = 0
    set({ fading: true, fadeDirection: "out" })
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
