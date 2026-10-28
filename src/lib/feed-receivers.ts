import type { BroadcastOutput, HostLostRule, ReceiverTv } from "@/types"

/**
 * Browser feeds on TVs (#198, Rhema Studio Receiver 1.5): what a screen shows when it stops
 * hearing from this computer, the safe inset for TVs that crop the picture's edges, and the words
 * the host's TV list uses. Pure, so the feed page and the host share them.
 */

/** What a feed frame carries about the host-lost rule: only what the page needs to draw it. */
export type FeedLost = { mode: "picture"; url: string } | { mode: "countdown"; startsAt: number }

/** The most of each edge a feed may keep clear for a TV that crops (percent). */
export const MAX_OVERSCAN = 10

/** An output's overscan as a safe number: 0 to MAX_OVERSCAN percent of each edge, in halves. */
export function overscanPct(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0
  return Math.round(Math.min(MAX_OVERSCAN, Math.max(0, n)) * 2) / 2
}

/** The part of the screen the feed draws in, with `pct` of each edge kept clear. */
export function insetArea(width: number, height: number, pct: number): { x: number; y: number; w: number; h: number } {
  const p = overscanPct(pct) / 100
  const x = width * p
  const y = height * p
  return { x, y, w: width - 2 * x, h: height - 2 * y }
}

/**
 * The rule as it travels in a frame: a picture needs its picture (as data, null while it loads or
 * when it is gone), a countdown needs the service start. Absent when the screen keeps the last
 * frame (the default, as before 1.5), and also when what the rule needs is missing.
 */
export function feedLost(rule: HostLostRule | undefined, serviceStart: number | null, pictureUrl: string | null): FeedLost | undefined {
  if (rule?.mode === "picture" && pictureUrl) return { mode: "picture", url: pictureUrl }
  if (rule?.mode === "countdown" && typeof serviceStart === "number" && Number.isFinite(serviceStart)) return { mode: "countdown", startsAt: serviceStart }
  return undefined
}

/** What a feed page shows over the last frame while it has lost the host; null: the last frame stays. */
export function lostView(lost: unknown, hostNow: number): { kind: "picture"; url: string } | { kind: "countdown"; title: string; time: string } | null {
  const l = lost as Partial<FeedLost> | null | undefined
  if (!l || typeof l !== "object") return null
  // Only a picture this computer sent as data: a page never loads an address from a frame.
  if (l.mode === "picture" && typeof l.url === "string" && l.url.startsWith("data:image/")) return { kind: "picture", url: l.url }
  if (l.mode === "countdown" && typeof l.startsAt === "number" && Number.isFinite(l.startsAt)) {
    const left = Math.ceil((l.startsAt - hostNow) / 1000)
    if (left <= 0) return { kind: "countdown", title: "The service is starting", time: "" }
    const h = Math.floor(left / 3600)
    const m = Math.floor((left % 3600) / 60)
    const s = left % 60
    const two = (n: number) => String(n).padStart(2, "0")
    return { kind: "countdown", title: "The service starts in", time: h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}` }
  }
  return null
}

/** The rule in a few words, for the output's TV list and its editor. */
export function hostLostWords(rule: HostLostRule | undefined, pictureName?: string): string {
  if (rule?.mode === "picture") return rule.mediaId ? `If this computer is lost: shows ${pictureName ? `the picture “${pictureName}”` : "a picture that is no longer in the library (keeps the last picture)"}` : "If this computer is lost: keeps the last picture (no picture chosen)"
  if (rule?.mode === "countdown") return "If this computer is lost: counts down to the service start"
  return "If this computer is lost: keeps the last picture"
}

/** Whether a TV's link is its own (revocable alone) or the feed's shared one, in words. */
export function tvKeyWords(tv: Pick<ReceiverTv, "token">): string {
  return tv.token ? "Private link: its own key" : "Shared link: the feed's key (sent before own keys; Revoke needs a new link)"
}

/** Whether the output's screens are public (congregation, signage) or private (stage notes). */
export function screenPrivacyWords(o: Pick<BroadcastOutput, "role">): string {
  return o.role === "stage" ? "Private screen (stage notes)" : "Public screen"
}

/** A TV's display size as it last said, or why it is not known. */
export function tvSizeWords(tv: Pick<ReceiverTv, "width" | "height">): string {
  return tv.width && tv.height ? `${tv.width}×${tv.height}` : "size not known yet (Check TV; Receiver 1.5 says it)"
}

/** The keys browser-feeds hands the listener for an output's TVs: only TVs with their own key. */
export function tvKeys(tvs: ReceiverTv[] | undefined): { id: string; token: string }[] {
  return (tvs ?? []).filter((t) => typeof t.token === "string" && t.token.length >= 16).map((t) => ({ id: t.address, token: t.token! }))
}
