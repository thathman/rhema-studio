import { invoke } from "@tauri-apps/api/core"

/** What a collection can hold (#853 G9); matches the content crate's `library_collection_items.item_kind`. */
export type CollectionItemKind = "song" | "slide" | "media" | "design"

export interface CollectionSummary {
  id: string
  name: string
  item_count: number
  created_at: string
  updated_at: string
}

export interface CollectionItem {
  kind: CollectionItemKind
  item_id: string
  /** The library item's title now; null when it is no longer in the library. */
  title: string | null
  /** hymn/song, slide/announcement, image/video/audio. */
  detail: string | null
  position: number
}

export interface Collection {
  summary: CollectionSummary
  items: CollectionItem[]
}

export const collectionsApi = {
  list: () => invoke<CollectionSummary[]>("content_list_collections"),
  get: (id: string) => invoke<Collection | null>("content_get_collection", { id }),
  create: (name: string) => invoke<CollectionSummary>("content_create_collection", { name }),
  rename: (id: string, name: string) => invoke<CollectionSummary>("content_rename_collection", { id, name }),
  remove: (id: string) => invoke<void>("content_delete_collection", { id }),
  add: (id: string, kind: CollectionItemKind, itemId: string) => invoke<Collection>("content_add_to_collection", { id, kind, itemId }),
  take: (id: string, kind: CollectionItemKind, itemId: string) => invoke<Collection>("content_remove_from_collection", { id, kind, itemId }),
}

export function collectionItemLabel(item: Pick<CollectionItem, "kind" | "detail">): string {
  if (item.kind === "song") return item.detail === "hymn" ? "Hymn" : "Song"
  if (item.kind === "slide") return item.detail === "announcement" ? "Announcement" : "Slide"
  if (item.kind === "media") return item.detail === "audio" ? "Sound" : item.detail === "video" ? "Video" : "Picture"
  return "Visual design"
}
