import type { AudioQueueItem, ImageQueueItem, MediaAssetStatus } from "@/types"

/** A library picture as a rundown item: fills the screen by default. */
export function imageQueueItem(asset: MediaAssetStatus, id: string = crypto.randomUUID()): ImageQueueItem {
  if (asset.kind !== "image" && asset.kind !== "video") throw new Error(`${asset.name} is not a picture or video`)
  return { id, kind: "image", image: { media_id: asset.id, name: asset.name, fit: "cover" }, reference: asset.name, confidence: 1, source: "manual", added_at: Date.now() }
}

/** A media file intended to play on this computer only; no public screen is attached. */
export function audioQueueItem(asset: MediaAssetStatus, id: string = crypto.randomUUID()): AudioQueueItem {
  if (asset.kind !== "audio") throw new Error(`${asset.name} is not an audio file`)
  return { id, kind: "audio", audio: { media_id: asset.id, name: asset.name }, reference: asset.name, confidence: 1, source: "manual", added_at: Date.now() }
}

/** Route each supported library asset to its distinct rundown item model. */
export function mediaQueueItem(asset: MediaAssetStatus, id: string = crypto.randomUUID()): ImageQueueItem | AudioQueueItem {
  if (asset.kind === "audio") return audioQueueItem(asset, id)
  if (asset.kind === "image" || asset.kind === "video") return imageQueueItem(asset, id)
  throw new Error(`${asset.name} is not a picture, video or sound`)
}
