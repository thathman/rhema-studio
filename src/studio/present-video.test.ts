import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ImageQueueItem, ProgramWithItems } from "@/types"

const mockInvoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
}))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }))
const mockReadFile = vi.fn()
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: (...a: unknown[]) => mockReadFile(...a) }))

import { presentImage } from "@/hooks/use-broadcast"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useMediaStore } from "@/stores/media-store"
import { toItemInputs, toQueueItems } from "@/stores/service-store"

const asset = (id: string, kind: "image" | "video", present = true) => ({ id, kind, name: "Countdown", file: `${id}.mp4`, hash: "a".repeat(64), size: 4, mime: kind === "video" ? "video/mp4" : "image/png", width: null, height: null, duration_ms: null, source: "local", source_ref: "", original_path: "", created_at: "", path: `/media/${id}.mp4`, present })
const clip = (media_id = "v-1", extra: Partial<ImageQueueItem["image"]> = {}): ImageQueueItem => ({ id: "item-v", kind: "image", image: { media_id, name: "Countdown", fit: "cover", ...extra }, reference: "Countdown", confidence: 1, source: "manual", added_at: 0, notes: null })

beforeEach(() => {
  mockInvoke.mockReset()
  mockReadFile.mockReset()
  mockInvoke.mockImplementation(async (cmd: string) => (cmd === "media_list" ? [asset("v-1", "video"), asset("v-gone", "video", false)] : null))
  useBroadcastStore.setState({ isLive: false, liveVerse: null, liveSourceVerse: null, liveItem: null, liveSlide: null, liveItemId: null, heldLive: null, presentWarning: null, rehearsal: false })
  useMediaStore.setState({ assets: [], urls: {}, loaded: false, loading: false })
})

describe("video items", () => {
  it("go live as a streamed URL, never read into memory, with loop and sound from the item", async () => {
    expect(await presentImage(clip("v-1", { loop: true, sound: false }), { goLive: true })).toBe("presented")
    const s = useBroadcastStore.getState()
    expect(s.isLive).toBe(true)
    expect(s.liveItemId).toBe("item-v")
    expect(s.liveVerse?.video).toEqual({ url: `asset://localhost/${encodeURIComponent("/media/v-1.mp4")}`, fit: "cover", loop: true, sound: false, name: "Countdown" })
    expect(s.liveVerse?.image).toBeUndefined()
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(await useMediaStore.getState().dataUrl("v-1")).toBeNull()
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it("leave the screen alone with a warning when the file is missing", async () => {
    expect(await presentImage(clip("v-gone"), { goLive: true })).toBe("empty")
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(useBroadcastStore.getState().presentWarning).toContain("video file is missing")
  })

  it("keep loop and sound through save and reopen; defaults stay out of the payload", () => {
    const [saved] = toItemInputs([clip("v-1", { loop: true, sound: false })])
    expect(JSON.parse(saved.payload ?? "{}")).toEqual({ media_id: "v-1", fit: "cover", loop: true, sound: false })
    const [plain] = toItemInputs([clip("v-1")])
    expect(JSON.parse(plain.payload ?? "{}")).toEqual({ media_id: "v-1", fit: "cover" })
    const data: ProgramWithItems = {
      program: { id: "p1", title: "Sunday", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 1 },
      items: [{ id: "item-v", program_id: "p1", position: 0, kind: "image", reference: "Countdown", book_number: null, chapter: null, verse: null, translation: null, secondary_translation: null, notes: null, payload: saved.payload ?? null }],
    }
    const { items } = toQueueItems(data, 1, [])
    expect(items[0]).toMatchObject({ kind: "image", image: { media_id: "v-1", loop: true, sound: false } })
  })
})
