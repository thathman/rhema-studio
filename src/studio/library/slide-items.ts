import { create } from "zustand"
import { slideLabel } from "@/stores/service-store"
import type { ReusableSlide, ReusableSlideInput, SlideQueueItem } from "@/types"

/** A service copy of a saved reusable slide, pinned to its source revision (Library's Use and Collections). */
export function reusableSlideQueueItem(slide: ReusableSlide, media: ReadonlyArray<{ id: string; name: string }>): SlideQueueItem {
  const bg = slide.background_media_id
  return {
    id: crypto.randomUUID(), kind: "slide",
    slide: { title: slide.title, body: slide.body, ...(slide.link ? { link: slide.link } : {}), source_asset_id: slide.id, source_revision: slide.revision },
    reference: slideLabel({ title: slide.title, body: slide.body, ...(slide.link ? { link: slide.link } : {}) }), confidence: 1, source: "manual", added_at: Date.now(),
    ...(bg ? { background: { media_id: bg, name: media.find((asset) => asset.id === bg)?.name ?? "" } } : {}),
  }
}

/**
 * The reusable slide form, kept while the app is open (#833 S9): switching Library section or
 * leaving Library unmounts the form, and this brings its unsaved words back. In memory only.
 */
export const useSlideDraft = create<{ selectedId: string | null; form: ReusableSlideInput | null; editing: ReusableSlide | null }>(() => ({
  selectedId: null,
  form: null,
  editing: null,
}))

/** True when the form holds words that are not saved in the library (#833 S9). */
export function slideFormIsDirty(form: ReusableSlideInput, editing: ReusableSlide | null): boolean {
  if (editing) {
    return form.kind !== editing.kind
      || form.title !== editing.title
      || form.body !== editing.body
      || (form.link ?? null) !== editing.link
      || (form.background_media_id ?? null) !== editing.background_media_id
  }
  return form.title.trim() !== "" || form.body.trim() !== "" || !!form.link || !!form.background_media_id
}
