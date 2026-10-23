import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { newFeedToken } from "@/lib/output-on-air"
import { useFeedHealthStore } from "@/lib/show-health"
import { useBroadcastStore } from "@/stores/broadcast-store"

/**
 * Browser feeds (ARCH-002): every output of type "browser" has a secret for its link, and the LAN
 * listener knows which feeds exist. Kept in step with the outputs; a renewed secret closes the old
 * link at once.
 */
let last = ""

function sync() {
  const b = useBroadcastStore.getState()
  for (const o of b.outputs) if (o.type === "browser" && !o.feedToken) b.updateOutput(o.id, { feedToken: newFeedToken() })
  const feeds = useBroadcastStore.getState().outputs.filter((o) => o.type === "browser" && o.feedToken).map((o) => ({ id: o.id, token: o.feedToken! }))
  const key = JSON.stringify(feeds)
  if (key === last) return
  last = key
  void invoke("feeds_set", { feeds }).catch(() => {})
}

export function startBrowserFeeds(): () => void {
  sync()
  return useBroadcastStore.subscribe((s, p) => { if (s.outputs !== p.outputs) sync() })
}

/** The link to give OBS Browser Source or a TV's browser. */
export function feedUrl(host: string, port: number, id: string, token: string): string {
  return `http://${host}:${port}/feed/${encodeURIComponent(id)}?k=${token}`
}

export interface FeedHealth {
  watching: number
  /** A page drew the newest frame. */
  current: boolean
  /** The newest frame has not been drawn for a while (a page is stuck or too slow). */
  behind: boolean
}

/** What a browser feed's pages are doing, asked every 2 s while the feed is on (#246 item 9). */
export function useFeedHealth(id: string, on: boolean): FeedHealth | null {
  const [health, setHealth] = useState<FeedHealth | null>(null)
  useEffect(() => {
    if (!on) return
    let last = { seq: -1, behindSince: 0 }
    const ask = async () => {
      const s = await invoke<{ watching: number; seq: number; acked: number } | null>("feed_status", { id }).catch(() => null)
      if (!s) return setHealth(null)
      const current = s.acked >= s.seq
      const behindSince = current ? 0 : s.seq === last.seq && last.behindSince ? last.behindSince : Date.now()
      last = { seq: s.seq, behindSince }
      const h = { watching: s.watching, current, behind: !current && s.watching > 0 && Date.now() - behindSince >= 3000 }
      setHealth(h)
      useFeedHealthStore.setState({ [id]: h })
    }
    void ask()
    const t = setInterval(() => void ask(), 2000)
    return () => {
      clearInterval(t)
      setHealth(null)
      useFeedHealthStore.setState({ [id]: null })
    }
  }, [id, on])
  return health
}

/** The output card's words for a feed's health. */
export function feedHealthLabel(h: FeedHealth | null): string | null {
  if (!h) return null
  if (h.watching === 0) return "No page is showing it"
  const who = h.watching === 1 ? "1 page" : `${h.watching} pages`
  return h.behind ? `${who} · behind: not showing the latest` : h.current ? `${who} · showing the latest` : `${who} · updating…`
}
