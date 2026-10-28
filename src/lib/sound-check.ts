/**
 * Sound checks before the service (#213 rehearsal test): a 1 kHz test tone at −18 dBFS on a
 * chosen output, until stopped; and a clap test that listens on the microphone for a few seconds
 * to confirm sound comes in. Both only when the operator presses them; nothing is recorded or sent.
 */

/** −18 dBFS: the usual line-up level. A sine's peak at that level. */
export const TONE_DBFS = -18
export const TONE_HZ = 1000
export const toneGain = (dbfs = TONE_DBFS) => 10 ** (dbfs / 20)

/** How long the clap test listens, and the peak that counts as a clap reaching the microphone. */
export const CLAP_LISTEN_MS = 5000
export const CLAP_DBFS = -30

type Sinkable = { setSinkId?: (id: string) => Promise<void> }

/** Whether this computer's audio can be sent to a chosen output (WebKit cannot yet: the system output is used). */
export function canChooseToneOutput(): boolean {
  const context = globalThis.AudioContext?.prototype as Sinkable | undefined
  return typeof context?.setSinkId === "function"
}

/** A new context, running: WebKit starts it suspended, and a node wired before it runs can stay silent. */
async function runningContext(): Promise<AudioContext> {
  const ctx = new AudioContext()
  await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 1000))])
  return ctx
}

/**
 * Start the test tone; resolves with what stops it. `deviceId` "" is the system's output; where an
 * output cannot be chosen it plays on the system's. Says where it plays.
 */
export async function startTestTone(deviceId = ""): Promise<{ stop: () => void; where: "chosen" | "system" }> {
  const ctx = await runningContext()
  let where: "chosen" | "system" = "system"
  const sink = (ctx as unknown as Sinkable).setSinkId
  if (deviceId && typeof sink === "function") {
    try {
      await sink.call(ctx, deviceId)
      where = "chosen"
    } catch {
      where = "system"
    }
  }
  const osc = ctx.createOscillator()
  osc.type = "sine"
  osc.frequency.value = TONE_HZ
  const gain = ctx.createGain()
  // A short fade in and out, so the tone starts and ends without a click.
  gain.gain.setValueAtTime(0, ctx.currentTime)
  gain.gain.linearRampToValueAtTime(toneGain(), ctx.currentTime + 0.02)
  osc.connect(gain).connect(ctx.destination)
  osc.start()
  let stopped = false
  return {
    where,
    stop: () => {
      if (stopped) return
      stopped = true
      try {
        gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime)
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.02)
        osc.stop(ctx.currentTime + 0.03)
      } catch {
        // already stopped
      }
      setTimeout(() => void ctx.close().catch(() => {}), 100)
    },
  }
}

/** The loudest sample in a block, in dBFS (-Infinity for silence). */
export function peakDbfs(samples: Float32Array): number {
  let peak = 0
  for (const v of samples) {
    const a = Math.abs(v)
    if (a > peak) peak = a
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity
}

export interface ClapResult {
  heard: boolean
  /** The loudest moment in dBFS. */
  peakDb: number
}

/** "Heard: loudest −12 dBFS" or what to check. */
export function clapWords(r: ClapResult): string {
  const db = r.peakDb === -Infinity ? "silence" : `loudest ${Math.round(r.peakDb)} dBFS`
  return r.heard ? `Heard the clap (${db}). The microphone works.` : `Nothing loud enough heard (${db}). Check the microphone is plugged in, chosen and not muted, then try again.`
}

/**
 * Listen on the microphone for a few seconds and report the loudest moment. `deviceId` "" is the
 * system's microphone. The stream is closed afterwards; nothing is kept.
 */
export async function clapTest(deviceId = "", ms = CLAP_LISTEN_MS): Promise<ClapResult> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
  const ctx = await runningContext()
  try {
    const src = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    // WebKit only runs nodes that reach the output: through a silent gain so nothing is heard.
    const mute = ctx.createGain()
    mute.gain.value = 0
    src.connect(analyser).connect(mute).connect(ctx.destination)
    const buf = new Float32Array(analyser.fftSize)
    let peak = -Infinity
    const end = Date.now() + ms
    while (Date.now() < end) {
      await new Promise((r) => setTimeout(r, 30))
      analyser.getFloatTimeDomainData(buf)
      peak = Math.max(peak, peakDbfs(buf))
    }
    return { heard: peak >= CLAP_DBFS, peakDb: peak }
  } finally {
    for (const t of stream.getTracks()) t.stop()
    void ctx.close().catch(() => {})
  }
}
