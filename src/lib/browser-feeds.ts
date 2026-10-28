import { useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { newFeedToken } from "@/lib/output-on-air"
import { useFeedHealthStore } from "@/lib/show-health"
import { SKEW_WARN_MS, skewWords } from "@/lib/desk-freshness"
import { useBroadcastStore, type OutputFrame } from "@/stores/broadcast-store"
import { useJournalStore } from "@/stores/journal-store"
import type { PageVideo } from "@/lib/camera-playback"
import { tvKeys } from "@/lib/feed-receivers"
import { sceneForOutput } from "@/lib/scenes"
import type { BroadcastOutput } from "@/types/broadcast-output"

/**
 * Browser feeds (ARCH-002): every output of type "browser" has a secret for its link, and the LAN
 * listener knows which feeds exist. Kept in step with the outputs; a renewed secret closes the old
 * link at once.
 */
let last = ""
let sent: Promise<unknown> = Promise.resolve()

function sync(): Promise<unknown> {
  const b = useBroadcastStore.getState()
  for (const o of b.outputs) if (o.type === "browser" && !o.feedToken) b.updateOutput(o.id, { feedToken: newFeedToken() })
  // Each paired TV's own key goes with its feed (#198): removing one revokes that TV alone.
  const feeds = useBroadcastStore.getState().outputs.filter((o) => o.type === "browser" && o.feedToken).map((o) => ({ id: o.id, token: o.feedToken!, tvs: [...tvKeys(o.tvs), ...(pending.get(o.id) ?? [])] }))
  const key = JSON.stringify(feeds)
  if (key === last) return sent
  last = key
  sent = invoke("feeds_set", { feeds }).catch(() => {})
  return sent
}

/** Keys made for a TV being sent a feed now, until it answers (kept apart, so a failed send changes nothing). */
const pending = new Map<string, { id: string; token: string }[]>()

/**
 * A new key for a TV about to be sent a saved feed (#198), known to the listener before the link
 * goes, so the TV can open it at once. Null when the feed is not saved yet (the TV then gets the
 * feed's own link, as before). End it with `endTvKey` whatever the answer.
 */
export async function beginTvKey(outputId: string, address: string): Promise<string | null> {
  const o = useBroadcastStore.getState().outputs.find((x) => x.id === outputId && x.type === "browser")
  if (!o?.feedToken) return null
  const token = newFeedToken()
  pending.set(outputId, [...(pending.get(outputId) ?? []), { id: address.trim(), token }])
  await sync()
  return token
}

/** The send is over: the key stays only if the TV was remembered with it (Show on TV worked). */
export async function endTvKey(outputId: string, token: string): Promise<void> {
  const left = (pending.get(outputId) ?? []).filter((k) => k.token !== token)
  if (left.length) pending.set(outputId, left)
  else pending.delete(outputId)
  await sync()
}

/** Take a TV off a feed: its own key stops working at once and its screen is cut (#198). */
export async function revokeTv(outputId: string, address: string): Promise<void> {
  const b = useBroadcastStore.getState()
  const o = b.outputs.find((x) => x.id === outputId)
  if (!o) return
  b.updateOutput(outputId, { tvs: (o.tvs ?? []).filter((t) => t.address !== address) })
  await sync()
}

export function startBrowserFeeds(): () => void {
  void sync()
  const stop = useBroadcastStore.subscribe((s, p) => { if (s.outputs !== p.outputs) void sync() })
  // The first page to draw a new frame (crates/api http.rs ack): which screen showed what, and how soon.
  let alive = true
  let unlisten: (() => void) | undefined
  void listen<string>("feed:acked", (e) => {
    try {
      const a = JSON.parse(e.payload) as { id?: unknown; afterMs?: unknown }
      if (typeof a.id === "string" && typeof a.afterMs === "number") noteFeedShown(a.id, a.afterMs)
    } catch { /* not ours */ }
  }).then((u) => { if (alive) unlisten = u; else u() }).catch(() => {})
  return () => {
    alive = false
    stop()
    unlisten?.()
  }
}

/** What an output's frame shows, in the log's words: the scene, Black, the reference, or a clear screen. */
export function frameWords(frame: OutputFrame | undefined, output?: BroadcastOutput): string | null {
  if (!frame) return null
  if (frame.scene) {
    const s = useBroadcastStore.getState()
    const scene = output?.sceneId === frame.scene.sceneId
      ? sceneForOutput(output, s.scenes)
      : s.scenes.find((x) => x.id === frame.scene!.sceneId)
    return `the ${scene?.name ?? "scene"} scene`
  }
  const v = frame.verse
  if (!v) return "a clear screen"
  if (v.screen === "black") return "Black"
  if (v.screen === "logo") return "the logo"
  return v.reference || v.lines?.[0] || "a slide"
}

/** What each screen was last logged as showing: a page re-drawing the same content (a timer beat) is not news. */
const lastShown = new Map<string, string>()

/**
 * A browser feed's page first drew a new frame (#243/#246 C17, per-target acknowledgement): one log
 * line for that screen, "Foyer TV showed John 3:16 after 0.4 s", only when what it shows changed.
 */
export function noteFeedShown(id: string, afterMs: number): void {
  const s = useBroadcastStore.getState()
  const output = s.outputs.find((o) => o.id === id)
  if (!output || s.rehearsal) return
  const words = frameWords(s.outputFrames[id], output)
  if (!words || lastShown.get(id) === words) return
  lastShown.set(id, words)
  useJournalStore.getState().add({ kind: "shown", label: `${output.name} showed ${words} after ${(Math.max(0, afterMs) / 1000).toFixed(1)} s`, outputId: id, afterMs })
}

/** Tests: forget what each screen was last logged as showing. */
export function resetFeedShown(): void {
  lastShown.clear()
}

/**
 * The link to give OBS Browser Source or a TV's browser; `secure` for the https port, the only link
 * Show on a Google TV sends (#198).
 */
export function feedUrl(host: string, port: number, id: string, token: string, secure = false): string {
  return `${secure ? "https" : "http"}://${host}:${port}/feed/${encodeURIComponent(id)}?k=${token}`
}

export interface FeedHealth {
  watching: number
  /** A page drew the newest frame. */
  current: boolean
  /** The newest frame has not been drawn for a while (a page is stuck or too slow). */
  behind: boolean
  /** Each page that plays cameras: how they really play there (#213); absent from an older build. */
  video?: PageVideo[]
  /** A page's clock minus this computer's (ms), when one said lately (#196); absent from older pages. */
  clockSkewMs?: number
  /** Pages following the feed now, by paired TV address (TVs with their own key, #198). */
  tvs?: Record<string, number>
}

/** One poller per feed, shared by everything that shows its health (cards, Show health, Home). */
const watchers = new Map<string, { users: number; stop: () => void }>()

/**
 * Ask a feed's pages what they drew every 2 s while anything watches it (#246 item 9, #213 show
 * health); the answer goes to useFeedHealthStore. Returns the stop for this watcher.
 */
export function watchFeed(id: string): () => void {
  const running = watchers.get(id)
  if (running) running.users++
  else {
    let alive = true
    let last = { seq: -1, behindSince: 0 }
    const ask = async () => {
      const s = await invoke<{ watching: number; seq: number; acked: number; video?: PageVideo[]; clock_skew_ms?: number; tvs?: { id: string; watching: number }[] } | null>("feed_status", { id }).catch(() => null)
      if (!alive) return
      if (!s) return useFeedHealthStore.setState({ [id]: null })
      const current = s.acked >= s.seq
      const behindSince = current ? 0 : s.seq === last.seq && last.behindSince ? last.behindSince : Date.now()
      last = { seq: s.seq, behindSince }
      useFeedHealthStore.setState({ [id]: { watching: s.watching, current, behind: !current && s.watching > 0 && Date.now() - behindSince >= 3000, ...(s.video?.length ? { video: s.video } : {}), ...(typeof s.clock_skew_ms === "number" ? { clockSkewMs: s.clock_skew_ms } : {}), ...(s.tvs?.length ? { tvs: Object.fromEntries(s.tvs.map((t) => [t.id, t.watching])) } : {}) } })
    }
    void ask()
    const t = setInterval(() => void ask(), 2000)
    watchers.set(id, {
      users: 1,
      stop: () => {
        alive = false
        clearInterval(t)
        useFeedHealthStore.setState({ [id]: null })
      },
    })
  }
  let done = false
  return () => {
    if (done) return
    done = true
    const w = watchers.get(id)
    if (w && --w.users === 0) {
      w.stop()
      watchers.delete(id)
    }
  }
}

/** What a browser feed's pages are doing, while the feed is on. */
export function useFeedHealth(id: string, on: boolean): FeedHealth | null {
  useEffect(() => (on ? watchFeed(id) : undefined), [id, on])
  const health = useFeedHealthStore((s) => s[id] ?? null)
  return on ? health : null
}

/** The output card's words for a feed's health. */
export function feedHealthLabel(h: FeedHealth | null): string | null {
  if (!h) return null
  if (h.watching === 0) return "No page is showing it"
  const who = h.watching === 1 ? "1 page" : `${h.watching} pages`
  const state = h.behind ? `${who} · behind: not showing the latest` : h.current ? `${who} · showing the latest` : `${who} · updating…`
  // Its timers follow this computer, but its own clock is off: worth setting right (#196).
  return h.clockSkewMs !== undefined && Math.abs(h.clockSkewMs) > SKEW_WARN_MS ? `${state} · its clock is ${skewWords(h.clockSkewMs)} this computer's` : state
}
