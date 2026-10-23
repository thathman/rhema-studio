import { invoke } from "@tauri-apps/api/core"
import { newFeedToken } from "@/lib/output-on-air"
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
