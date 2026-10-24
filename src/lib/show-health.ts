import { create } from "zustand"
import type { FeedHealth } from "@/lib/browser-feeds"
import type { RouterStatus } from "@/lib/cameras"
import { outputOnAir } from "@/lib/output-on-air"
import type { OutputFrame } from "@/stores/broadcast-store"
import type { CameraSource } from "@/stores/settings-store"
import type { BroadcastOutput, BroadcastOutputStatus, ReceiverTv, Scene } from "@/types"

/** Browser feed health by output id, as the open cards last saw it (#213 show health). */
export const useFeedHealthStore = create<Record<string, FeedHealth | null>>(() => ({}))

export interface Attention {
  /** high: the audience may be seeing the wrong thing; medium: something nobody is watching. */
  level: "high" | "medium"
  outputId: string
  text: string
}

/**
 * How a camera is doing, from the camera router (#213): checking (no answer yet), router-off,
 * not-sending, sending, or elsewhere (a camera layer whose address is not Rhema's router: Rhema
 * cannot see whether it sends).
 */
export type CameraState = "checking" | "router-off" | "not-sending" | "sending" | "elsewhere"

export interface CameraHealth {
  /** The router's name for it, or the layer's address when it is not one of the router's. */
  key: string
  label: string
  state: CameraState
  /** What it sends (e.g. ["H264"]), while sending. */
  tracks: string[]
  /** Screens, TVs and programs (OBS) taking it from the router now. */
  readers: number
  /** Camera layer addresses that play it. */
  urls: string[]
  /** Scenes with a camera layer that plays it. */
  scenes: string[]
  /** Outputs set to one of those scenes, and those of them on air now. */
  assigned: string[]
  onAir: string[]
}

/** The router's name in a camera layer's address (http://192.168.1.20:8889/pulpit/whep → "pulpit"), or null. */
export function cameraPathOf(url: string): string | null {
  try {
    const m = new URL(url).pathname.match(/^\/([^/]+)\/whep\/?$/)
    return m ? decodeURIComponent(m[1]) : null
  } catch {
    return null
  }
}

/** "Pulpit" → "Pulpit camera"; a name that already says camera stays as it is. */
export function cameraWords(label: string): string {
  return /camera$/i.test(label.trim()) ? label.trim() : `${label.trim()} camera`
}

/**
 * Every camera Rhema knows (#213): those added in Production → Cameras and every camera layer in a
 * scene, with what the router says about each and where it is used. `router` undefined: no answer yet.
 */
export function cameraHealth(cameras: CameraSource[], scenes: Scene[], outputs: BroadcastOutput[], status: Record<string, BroadcastOutputStatus | undefined>, router: RouterStatus | null | undefined): CameraHealth[] {
  const rows = new Map<string, CameraHealth>()
  const row = (key: string, label: string, ours: boolean) => {
    let r = rows.get(key)
    if (!r) {
      const path = router?.paths.find((p) => p.name === key)
      const state: CameraState = !ours ? "elsewhere" : router === undefined ? "checking" : !router?.running ? "router-off" : path?.live ? "sending" : "not-sending"
      r = { key, label, state, tracks: state === "sending" ? (path?.tracks ?? []) : [], readers: state === "sending" ? (path?.readers ?? 0) : 0, urls: [], scenes: [], assigned: [], onAir: [] }
      rows.set(key, r)
    }
    return r
  }
  for (const c of cameras) row(c.name, c.label, true)
  for (const sc of scenes) {
    for (const l of sc.layers) {
      if (l.kind !== "camera" || !l.cameraUrl) continue
      const name = cameraPathOf(l.cameraUrl)
      const ours = !!name && (cameras.some((c) => c.name === name) || !!router?.paths.some((p) => p.name === name))
      const r = row(ours ? name! : l.cameraUrl, ours ? (cameras.find((c) => c.name === name)?.label ?? name!) : l.name, ours)
      if (!r.urls.includes(l.cameraUrl)) r.urls.push(l.cameraUrl)
      if (!r.scenes.includes(sc.name)) r.scenes.push(sc.name)
      for (const o of outputs) {
        if (o.sceneId !== sc.id) continue
        if (!r.assigned.includes(o.name)) r.assigned.push(o.name)
        if (outputOnAir(o, status[o.id]) && !r.onAir.includes(o.name)) r.onAir.push(o.name)
      }
    }
  }
  return [...rows.values()]
}

/** A camera's state in a few words for Show health. */
export function cameraStateWords(c: CameraHealth): string {
  if (c.state === "checking") return "Checking…"
  if (c.state === "router-off") return "Camera router not running"
  if (c.state === "not-sending") return "Not sending"
  if (c.state === "elsewhere") return "Not from Rhema's camera router: Rhema cannot see whether it is sending"
  const watched = `watched by ${c.readers} ${c.readers === 1 ? "screen or program" : "screens or programs"}`
  return `Sending${c.tracks.length ? ` (${c.tracks.join(", ")})` : ""} · ${watched}`
}

/** A browser feed's screens in a few words for Show health: off, checking, nobody, behind or current. */
export function feedSummary(h: FeedHealth | null | undefined, on: boolean): { text: string; tone: "ok" | "warn" | "off" } {
  if (!on) return { text: "Off", tone: "off" }
  if (!h) return { text: "Checking…", tone: "off" }
  if (h.watching === 0) return { text: "No screen watching", tone: "warn" }
  const n = h.watching === 1 ? "1 screen" : `${h.watching} screens`
  if (h.behind) return { text: `Behind: ${n}, not showing the latest`, tone: "warn" }
  return { text: h.current ? `${n} showing the latest` : `${n} · updating…`, tone: "ok" }
}

/** The TVs a feed was sent to, with this one first; the same address is one TV (at most 8 kept). */
export function rememberTv(tvs: ReceiverTv[] | undefined, tv: ReceiverTv): ReceiverTv[] {
  const address = tv.address.trim()
  return [{ ...tv, address }, ...(tvs ?? []).filter((t) => t.address !== address)].slice(0, 8)
}

/** What a TV said to Check TV, in words: whether it shows this feed. */
export function tvCheckWords(reply: { name: string; feed: string | null; problem: string | null }, outputId: string, outputs: BroadcastOutput[]): { ok: boolean; text: string } {
  if (reply.feed === outputId) return reply.problem ? { ok: false, text: `Has this feed, but its screen says: ${reply.problem}` } : { ok: true, text: "Showing this feed" }
  if (reply.feed) {
    const other = outputs.find((o) => o.id === reply.feed)
    return { ok: false, text: `Showing another feed${other ? ` (${other.name})` : ""}` }
  }
  return { ok: false, text: "Not showing a feed: it shows its address and code" }
}

/**
 * What needs the operator's attention on the outputs, most serious first (#213 P1 "attention
 * required"): only real signals Rhema has (NDI failures and receivers, browser feed pages and
 * whether they drew the newest frame, cameras the router says are not sending), nothing guessed.
 */
export function attention(outputs: BroadcastOutput[], status: Record<string, BroadcastOutputStatus | undefined>, feeds: Record<string, FeedHealth | null>, cams?: { cameras: CameraHealth[]; scenes: Scene[] }): Attention[] {
  const out: Attention[] = []
  for (const o of outputs) {
    const st = status[o.id]
    if (!outputOnAir(o, st)) continue
    // A scene on air whose camera is not sending shows its fallback words (or its background) there.
    const scene = o.sceneId ? cams?.scenes.find((s) => s.id === o.sceneId) : undefined
    for (const l of scene?.layers ?? []) {
      if (l.kind !== "camera" || !l.cameraUrl) continue
      const c = cams!.cameras.find((x) => x.urls.includes(l.cameraUrl!))
      if (c?.state !== "not-sending" && c?.state !== "router-off") continue
      const why = c.state === "router-off" ? " (the camera router is not running)" : ""
      const text = `${cameraWords(c.label)} is not sending${why}; "${scene!.name}" on ${o.name} shows its ${l.cameraFallback?.trim() ? "fallback words" : "background"} there`
      if (!out.some((a) => a.text === text)) out.push({ level: "high", outputId: o.id, text })
    }
    if (o.type === "ndi" && st?.ndiError) out.push({ level: "high", outputId: o.id, text: `${o.name}: the NDI sender is failing (${st.ndiError})` })
    else if (o.type === "ndi" && st?.ndiReceivers === 0) out.push({ level: "medium", outputId: o.id, text: `${o.name}: no NDI receiver is watching it` })
    const f = feeds[o.id]
    if (o.type === "browser" && f?.behind) out.push({ level: "high", outputId: o.id, text: `${o.name}: a page is not showing the latest (stuck or slow browser)` })
    else if (o.type === "browser" && f && f.watching === 0) out.push({ level: "medium", outputId: o.id, text: `${o.name}: no page is showing it` })
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "high" ? -1 : 1))
}

/** What an output is showing now, in a few words, for the routing view. */
export function showing(o: BroadcastOutput, frame: OutputFrame | undefined, scenes: Scene[], on: boolean): string {
  if (!on) return "Off"
  if (o.role === "stage") return "Stage display"
  if (o.role === "signage") return "Signage"
  if (!frame) return "Starting…"
  if (frame.scene) return `Scene: ${scenes.find((s) => s.id === frame.scene!.sceneId)?.name ?? "a scene"}`
  const v = frame.verse
  if (!v) return "Nothing on air (its look)"
  if (v.screen === "black") return "Black"
  if (v.screen === "logo") return "Logo"
  return v.reference || v.lines?.[0] || "A slide"
}
