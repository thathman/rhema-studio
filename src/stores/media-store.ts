import { create } from "zustand"
import { invoke, convertFileSrc } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { readFile } from "@tauri-apps/plugin-fs"
import { isAudioItem, isImageItem, type MediaAssetStatus, type MediaImportResult, type QueueItem } from "@/types"
import { useQueueStore } from "@/stores/queue-store"
import { useBroadcastStore } from "@/stores/broadcast-store"

interface MediaState {
  assets: MediaAssetStatus[]
  loading: boolean
  /** True once a list has completed (even with no pictures or with an error), so "missing" is never judged against an unloaded list. */
  loaded: boolean
  error: string | null
  /** Data URLs by asset id, decoded once and shared with the output window as part of the render data. */
  urls: Record<string, string>

  list: () => Promise<MediaAssetStatus[]>
  /** Native picker → copy into the media folder → index. Returns the per-file report. */
  /** Pick files and import them; `filters` defaults to pictures. */
  importFiles: (filters?: Array<{ name: string; extensions: string[] }>) => Promise<MediaImportResult[] | null>
  remove: (id: string) => Promise<void>
  /** The picture as a data URL (read from the media folder, cached). Null when missing. */
  dataUrl: (id: string) => Promise<string | null>
  /** Streamed URL for a video (asset protocol); never reads the file into memory. Null when missing. */
  fileUrl: (id: string) => Promise<string | null>
}

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

/** Width and height of an image data URL, or null outside a browser. */
function measure(url: string): Promise<{ width: number; height: number } | null> {
  if (typeof Image === "undefined") return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/** Where a picture or video is used outside saved services: the rundown on screen, signage loops and scenes' video layers. */
export function mediaUsedHere(id: string): string[] {
  const uses = (i: QueueItem) => i.background?.media_id === id || (isImageItem(i) && i.image.media_id === id) || (isAudioItem(i) && i.audio.media_id === id)
  const where: string[] = []
  if (useQueueStore.getState().items.some(uses)) where.push("the service on screen")
  // A scene's video layer plays the file itself (a picture layer keeps its own copy).
  for (const sc of useBroadcastStore.getState().scenes) if (sc.layers.some((l) => l.kind === "video" && l.mediaId === id)) where.push(`the scene ${sc.name}`)
  for (const o of useBroadcastStore.getState().outputs) {
    const lists = [o.signage?.mediaIds ?? [], ...(o.signage?.playlists ?? []).map((p) => p.mediaIds)]
    if (lists.some((l) => l.includes(id))) where.push(`the picture loop on ${o.name}`)
  }
  return where
}

export const useMediaStore = create<MediaState>((set, get) => ({
  assets: [],
  loading: false,
  loaded: false,
  error: null,
  urls: {},

  list: async () => {
    set({ loading: true, error: null })
    try {
      const assets = await invoke<MediaAssetStatus[]>("media_list")
      if (!Array.isArray(assets)) throw new Error("The local media library returned an invalid list.")
      set({ assets, loading: false, loaded: true })
      return assets
    } catch (e) {
      set({ loading: false, loaded: true, error: e instanceof Error ? e.message : String(e) })
      return []
    }
  },

  importFiles: async (filters = [{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }]) => {
    const selected = await open({ multiple: true, filters })
    if (!selected) return null
    const paths = Array.isArray(selected) ? selected : [selected]
    const results = await invoke<MediaImportResult[]>("media_import", { paths })
    await get().list()
    // Record dimensions for new pictures (the crate stores what the webview measures).
    for (const r of results) {
      if (r.status === "imported" && r.asset.width === null) {
        const url = await get().dataUrl(r.asset.id)
        const dims = url ? await measure(url) : null
        if (dims) {
          try {
            await invoke("media_set_dimensions", { id: r.asset.id, width: dims.width, height: dims.height, durationMs: null })
          } catch {
            // dimensions are informational
          }
        }
      }
    }
    await get().list()
    return results
  },

  remove: async (id) => {
    // Saved services are checked by the database; the service on screen (maybe unsaved) and screen loops here.
    const here = mediaUsedHere(id)
    if (here.length) throw { kind: "in_use", message: `in use: ${here.join(", ")}`, titles: here }
    await invoke("media_delete", { id })
    set((s) => {
      const urls = { ...s.urls }
      delete urls[id]
      return { assets: s.assets.filter((a) => a.id !== id), urls }
    })
  },

  fileUrl: async (id) => {
    // Always a fresh listing: a file removed since the library loaded must not go live (the outputs would show an error).
    const asset = (await get().list()).find((a) => a.id === id)
    if (!asset || !asset.present) return null
    return convertFileSrc(asset.path)
  },

  dataUrl: async (id) => {
    const cached = get().urls[id]
    if (cached) return cached
    let asset = get().assets.find((a) => a.id === id)
    if (!asset) asset = (await get().list()).find((a) => a.id === id)
    // Videos stream through fileUrl; reading one whole into a data URL would stall the app.
    if (!asset || !asset.present || asset.kind !== "image") return null
    try {
      const bytes = await readFile(asset.path)
      const url = `data:${asset.mime};base64,${toBase64(bytes)}`
      set((s) => ({ urls: { ...s.urls, [id]: url } }))
      return url
    } catch (e) {
      console.warn("[media] could not read picture", e)
      return null
    }
  },
}))
