import { create } from "zustand"
import type { CameraPlayback } from "@/lib/whep"

/**
 * How the cameras really play on each screen (#213 signal truth): Rhema's own output windows say
 * so every 2 s (an event), browser feed pages with their acknowledgement (feed_status). Measured on
 * the screen (frames shown, decoded, dropped, the last new frame's age), never guessed from a
 * connection.
 */

/** A report older than this is not shown (the window closed, or its scene has no camera now). */
export const PLAYBACK_FRESH_MS = 10_000

/** Each output window's last report, by output id. */
export const useWindowPlayback = create<Record<string, { at: number; cameras: CameraPlayback[] }>>(() => ({}))

/** One screen's report of one camera. */
export interface ScreenPlayback extends CameraPlayback {
  /** The output it is on. */
  outputId: string
  /** Where: "Projector (this computer)", "TV at 192.168.1.40". */
  where: string
}

/** A browser feed page's report, as feed_status gives it. */
export interface PageVideo {
  from: string
  agoMs: number
  cameras: CameraPlayback[]
}

/**
 * Every screen's reports, freshest only: the output windows on this computer and each browser feed
 * page (named by the TV the feed was sent to at that address, when one was).
 */
export function screenPlayback(outputs: readonly { id: string; name: string; tvs?: { name: string; address: string }[] }[], windows: Record<string, { at: number; cameras: CameraPlayback[] }>, pages: Record<string, PageVideo[] | undefined>, now = Date.now()): ScreenPlayback[] {
  const out: ScreenPlayback[] = []
  for (const o of outputs) {
    const w = windows[o.id]
    if (w && now - w.at < PLAYBACK_FRESH_MS) for (const c of w.cameras) out.push({ ...c, outputId: o.id, where: `${o.name} (this computer)` })
    for (const p of pages[o.id] ?? []) {
      if (p.agoMs >= PLAYBACK_FRESH_MS) continue
      const tv = o.tvs?.find((t) => t.address.replace(/:\d+$/, "") === p.from)
      const where = tv ? `${tv.name || "Google TV"} (${o.name})` : `${o.name} at ${p.from}`
      for (const c of p.cameras) out.push({ ...c, outputId: o.id, where })
    }
  }
  return out
}

/** Too few frames, too many dropped, or no new frame for a while (not frozen on purpose): worth saying. */
export function playbackTrouble(c: CameraPlayback): string | null {
  if (c.held) return null
  if (!c.playing) return "not playing here: its box shows the fallback"
  if (c.frameAgeMs !== null && c.frameAgeMs > 3000) return `no new frame for ${Math.round(c.frameAgeMs / 1000)} s`
  if (c.droppedPct !== null && c.droppedPct >= 5) return `${fmt(c.droppedPct)}% of frames dropped`
  if (c.fps !== null && c.fps > 0 && c.fps < 15) return `only ${fmt(c.fps)} frames a second`
  return null
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString()

/** "29.8 fps, 0.2% dropped" (with the size when known), or what is wrong, for one screen's camera. */
export function playbackWords(c: CameraPlayback): { text: string; tone: "ok" | "warn" | "off" } {
  if (c.held) return { text: "Frozen by the operator: holding the last frame", tone: "off" }
  const trouble = playbackTrouble(c)
  if (trouble && !c.playing) return { text: `Not playing here: its box shows the fallback`, tone: "warn" }
  const parts = [c.fps === null ? "measuring…" : `${fmt(c.fps)} fps`]
  if (c.droppedPct !== null) parts.push(`${fmt(c.droppedPct)}% dropped`)
  if (c.width && c.height) parts.push(`${c.width}×${c.height}`)
  const text = parts.join(", ")
  return trouble ? { text: `${text}: ${trouble}`, tone: "warn" } : { text, tone: "ok" }
}

/** Frames a second a camera shows on Rhema's own screens (the highest measured), or null when none plays it. */
export function measuredFps(name: string, screens: readonly ScreenPlayback[]): number | null {
  const rates = screens.filter((s) => s.camera === name && s.playing && !s.held && s.fps !== null).map((s) => s.fps!)
  return rates.length ? Math.max(...rates) : null
}
