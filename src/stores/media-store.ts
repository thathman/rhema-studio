import { create } from "zustand"
import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { readFile } from "@tauri-apps/plugin-fs"
import type { MediaAssetStatus, MediaImportResult } from "@/types"

interface MediaState {
  assets: MediaAssetStatus[]
  loading: boolean
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

export const useMediaStore = create<MediaState>((set, get) => ({
  assets: [],
  loading: false,
  error: null,
  urls: {},

  list: async () => {
    set({ loading: true, error: null })
    try {
      const assets = await invoke<MediaAssetStatus[]>("media_list")
      set({ assets, loading: false })
      return assets
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) })
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
    await invoke("media_delete", { id })
    set((s) => {
      const urls = { ...s.urls }
      delete urls[id]
      return { assets: s.assets.filter((a) => a.id !== id), urls }
    })
  },

  dataUrl: async (id) => {
    const cached = get().urls[id]
    if (cached) return cached
    let asset = get().assets.find((a) => a.id === id)
    if (!asset) asset = (await get().list()).find((a) => a.id === id)
    if (!asset || !asset.present) return null
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
