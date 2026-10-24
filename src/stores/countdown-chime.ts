import { chimesDue, countdownTarget, type Chime } from "@/lib/countdown"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"

/**
 * Production → Timekeeper's chime (#196 R2): a short tone on this computer, the main desk, at the
 * chosen minutes before what Timekeeper counts down to and again at zero. Off until turned on.
 * It is played here only, through this window's own audio: no output window, NDI sender or
 * browser feed is ever sent it, so the congregation never hears it.
 */
let lastLook = 0

/** Look whether a chime is due since the last look (each second, and on the app's tick when hidden). */
export function checkCountdownChime(now = Date.now(), play: (c: Chime) => void = playChime): void {
  const from = lastLook
  if (now <= from) return
  lastLook = now
  const prefs = useSettingsStore.getState().timekeeperCountdown
  if (!prefs.chime || from === 0) return
  const target = countdownTarget(useBroadcastStore.getState().countdowns, prefs.to)
  if (!target) return
  for (const c of chimesDue(target.at, prefs.chimeMinutes, from, now)) play(c)
}

/** Start looking each second; returns the stop. */
export function startCountdownChime(play: (c: Chime) => void = playChime): () => void {
  lastLook = Date.now()
  const id = setInterval(() => checkCountdownChime(Date.now(), play), 1_000)
  return () => clearInterval(id)
}

let ctx: AudioContext | null = null

/**
 * One soft tone before, two at zero. WebKit can start an audio context suspended: it is resumed
 * first and the tone timed on its own clock, so it is not lost or clipped.
 */
export function playChime(kind: Chime): void {
  try {
    ctx ??= new AudioContext()
    const audio = ctx
    void audio.resume().catch(() => {}).then(() => {
      const t0 = audio.currentTime + 0.02
      for (const offset of kind === "zero" ? [0, 0.32] : [0]) {
        const osc = audio.createOscillator()
        const gain = audio.createGain()
        const t = t0 + offset
        osc.frequency.value = 880
        gain.gain.setValueAtTime(0.0001, t)
        gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28)
        osc.connect(gain).connect(audio.destination)
        osc.start(t)
        osc.stop(t + 0.3)
      }
    })
  } catch {
    // No audio on this computer: the chime is a help, never a requirement.
  }
}
