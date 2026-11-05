/**
 * Listening to a sound in Library (#447, owner decision 5 Nov 2026), on a private output only.
 * The operator chooses an output in Settings → Audio and confirms it is not patched into the PA.
 * The system default is never used: it may be the church mixer. This player is kept apart from
 * Live's sound (sound-store): it starts no cue, and touches no output, feed, recording or tally.
 * Software cannot see cabling, so the confirmation is the operator's.
 */

type Sinkable = HTMLAudioElement & { setSinkId?: (deviceId: string) => Promise<void> }

/** Whether this app can send a sound to a chosen output at all (WebKit may not: then Listen is off). */
export function canChooseListenOutput(): boolean {
  const proto = globalThis.HTMLMediaElement?.prototype as Partial<Sinkable> | undefined
  return typeof proto?.setSinkId === "function"
}

export type ListenReadiness = { ok: true; target: string } | { ok: false; reason: string }

/** Why Listen is on or off, said plainly; `present`: the chosen output is connected now. */
export function listenReadiness(o: { supported: boolean; deviceId: string; label: string; confirmed: boolean; present: boolean }): ListenReadiness {
  if (!o.supported) return { ok: false, reason: "This app cannot send a sound to a chosen output on this computer, and it never plays on the default output (it may feed the PA)." }
  if (!o.deviceId) return { ok: false, reason: "Choose a private listening output in Settings → Audio first. The default output is never used: it may feed the PA." }
  if (!o.confirmed) return { ok: false, reason: `Confirm in Settings → Audio that ${o.label || "the chosen output"} is not connected to the PA or mixer.` }
  if (!o.present) return { ok: false, reason: `${o.label || "The chosen output"} is not connected now. Plug it in, or choose another in Settings → Audio.` }
  return { ok: true, target: o.label || "the chosen output" }
}

/** The quiet level a listen starts at; the operator can raise it. */
export const LISTEN_START_VOLUME = 0.3

export interface Listening {
  pause: () => void
  resume: () => void
  stop: () => void
  setVolume: (volume: number) => void
  element: HTMLAudioElement
}

/**
 * Play `url` on `deviceId` only: the output is set before the file is even loaded, and if it
 * cannot be set nothing plays. Resolves with the controls, or rejects with why it did not play.
 */
export async function startListening(url: string, deviceId: string, volume = LISTEN_START_VOLUME, make: () => HTMLAudioElement = () => new Audio()): Promise<Listening> {
  if (!deviceId) throw new Error("No private listening output is chosen.")
  const el = make() as Sinkable
  if (typeof el.setSinkId !== "function") throw new Error("This app cannot send a sound to a chosen output here.")
  await el.setSinkId(deviceId)
  el.volume = Math.min(1, Math.max(0, volume))
  el.src = url
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    el.pause()
    el.removeAttribute("src")
    el.load()
  }
  try {
    await el.play()
  } catch (e) {
    stop()
    throw e instanceof Error ? e : new Error(String(e))
  }
  return {
    element: el,
    pause: () => el.pause(),
    resume: () => { if (!stopped) void el.play().catch(() => {}) },
    stop,
    setVolume: (v) => { el.volume = Math.min(1, Math.max(0, v)) },
  }
}
