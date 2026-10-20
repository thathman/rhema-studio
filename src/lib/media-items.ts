import type { ImageQueueItem, MediaAssetStatus } from "@/types"

/** A library picture as a rundown item: fills the screen by default. */
export function imageQueueItem(asset: MediaAssetStatus, id: string = crypto.randomUUID()): ImageQueueItem {
  return { id, kind: "image", image: { media_id: asset.id, name: asset.name, fit: "cover" }, reference: asset.name, confidence: 1, source: "manual", added_at: Date.now() }
}
