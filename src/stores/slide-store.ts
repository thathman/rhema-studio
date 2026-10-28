import { create } from "zustand"
import { invoke } from "@tauri-apps/api/core"
import type { ReusableSlide, ReusableSlideInput } from "@/types"
import { useQueueStore } from "@/stores/queue-store"

interface SlideState {
  slides: ReusableSlide[]
  loading: boolean
  error: string | null
  query: string
  pendingSourceId: string | null
  list: (query?: string) => Promise<ReusableSlide[]>
  create: (input: ReusableSlideInput) => Promise<ReusableSlide>
  update: (id: string, expectedRevision: number, input: ReusableSlideInput) => Promise<ReusableSlide>
  remove: (id: string, expectedRevision: number) => Promise<void>
  requestEdit: (id: string) => void
  clearEditRequest: () => void
}

const byTitle = (slides: ReusableSlide[]) => [...slides].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
const message = (error: unknown) => error instanceof Error ? error.message : typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error)

export const useSlideStore = create<SlideState>((set, get) => ({
  slides: [], loading: false, error: null, query: "", pendingSourceId: null,

  list: async (query = get().query) => {
    set({ loading: true, error: null, query })
    try {
      const slides = await invoke<ReusableSlide[]>("content_list_reusable_slides", { query: query.trim() || null, limit: 5000 })
      set({ slides, loading: false })
      return slides
    } catch (error) {
      set({ loading: false, error: message(error) })
      throw error
    }
  },

  create: async (input) => {
    set({ error: null })
    try {
      const slide = await invoke<ReusableSlide>("content_create_reusable_slide", { input })
      set((state) => ({ slides: byTitle([...state.slides.filter((s) => s.id !== slide.id), slide]) }))
      return slide
    } catch (error) {
      set({ error: message(error) })
      throw error
    }
  },

  update: async (id, expectedRevision, input) => {
    set({ error: null })
    try {
      const slide = await invoke<ReusableSlide>("content_update_reusable_slide", { id, expectedRevision, input })
      set((state) => ({ slides: byTitle([...state.slides.filter((s) => s.id !== id), slide]) }))
      return slide
    } catch (error) {
      set({ error: message(error) })
      throw error
    }
  },

  remove: async (id, expectedRevision) => {
    const inService = useQueueStore.getState().items.find((item) => item.kind === "slide" && item.slide.source_asset_id === id)
    if (inService) throw { kind: "in_use", message: `This reusable slide is still used by ${inService.reference} in the service on screen.`, titles: [inService.reference] }
    set({ error: null })
    try {
      await invoke("content_delete_reusable_slide", { id, expectedRevision })
      set((state) => ({ slides: state.slides.filter((slide) => slide.id !== id) }))
    } catch (error) {
      set({ error: message(error) })
      throw error
    }
  },

  requestEdit: (id) => set({ pendingSourceId: id }),
  clearEditRequest: () => set({ pendingSourceId: null }),
}))
