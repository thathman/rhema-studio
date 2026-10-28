import { beforeEach, describe, expect, it, vi } from "vitest"

const mockInvoke = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => null)
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args), convertFileSrc: (p: string) => p }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}) }))

import { mediaUsedHere, useMediaStore } from "./media-store"
import { useSongStore } from "./song-store"
import { useQueueStore } from "./queue-store"
import { themeDraftChanged, useBroadcastStore } from "./broadcast-store"
import { journalUnkept, keepJournal, useJournalStore } from "./journal-store"
import type { QueueItem } from "@/types"

const picture = (id: string, media_id: string) => ({ id, kind: "image", image: { media_id, name: "Welcome", fit: "cover" }, reference: "Welcome", confidence: 1, source: "manual", added_at: 0 }) as unknown as QueueItem
const song = (id: string, song_id: string) => ({ id, kind: "song", song: { song_id, title: "Grace", arrangement_id: null, languages: ["en"] }, reference: "Grace", confidence: 1, source: "manual", added_at: 0 }) as unknown as QueueItem

beforeEach(() => {
  mockInvoke.mockClear()
  useQueueStore.setState({ items: [], activeIndex: null })
})

describe("nothing in use on screen is deleted (data loss audit)", () => {
  it("a picture in the unsaved service on screen, or in a screen loop, is not removed", async () => {
    useQueueStore.setState({ items: [picture("a", "m1")] })
    await expect(useMediaStore.getState().remove("m1")).rejects.toMatchObject({ kind: "in_use", titles: ["the service on screen"] })
    useQueueStore.setState({ items: [] })
    const outputs = useBroadcastStore.getState().outputs
    useBroadcastStore.setState({ outputs: [{ ...outputs[0], name: "Foyer", signage: { mediaIds: [], seconds: 8, playlists: [{ name: "Morning", mediaIds: ["m1"], seconds: 8 }] } }] })
    expect(mediaUsedHere("m1")).toEqual(["the picture loop on Foyer"])
    expect(mockInvoke).not.toHaveBeenCalledWith("media_delete", expect.anything())
    useBroadcastStore.setState({ outputs })
    await useMediaStore.getState().remove("m1")
    expect(mockInvoke).toHaveBeenCalledWith("media_delete", { id: "m1" })
  })

  it("a song in the service on screen is not deleted", async () => {
    useQueueStore.setState({ items: [song("a", "s1")] })
    await expect(useSongStore.getState().remove("s1", 1)).rejects.toMatchObject({ kind: "in_use" })
    expect(mockInvoke).not.toHaveBeenCalledWith("content_delete_song", expect.anything())
  })

  it("the theme draft counts as changed only when it differs from the saved theme", () => {
    const theme = useBroadcastStore.getState().themes[0]
    useBroadcastStore.setState({ editingThemeId: theme.id, draftTheme: { ...theme, updatedAt: Date.now() + 5 } })
    expect(themeDraftChanged()).toBe(false)
    useBroadcastStore.setState({ draftTheme: { ...theme, name: "Changed" } })
    expect(themeDraftChanged()).toBe(true)
    // Saved: the draft is what was saved (a Brand Kit theme detached in both).
    useBroadcastStore.getState().saveTheme({ ...theme, id: "custom-1", builtin: false, brandManaged: true })
    useBroadcastStore.getState().startEditing("custom-1")
    useBroadcastStore.getState().updateDraft({ name: "Brand edit" })
    useBroadcastStore.getState().saveDraft()
    expect(themeDraftChanged()).toBe(false)
    useBroadcastStore.getState().renameTheme("custom-1", "Renamed")
    expect(themeDraftChanged()).toBe(false)
    // Deleted while open: nothing left to lose.
    useBroadcastStore.setState((s) => ({ themes: s.themes.filter((x) => x.id !== "custom-1") }))
    expect(themeDraftChanged()).toBe(false)
    useBroadcastStore.setState({ editingThemeId: null, draftTheme: null })
  })

  it("the service log is unkept after something is logged, kept by Keep log, and a new log starts kept", async () => {
    useJournalStore.getState().clear()
    expect(journalUnkept()).toBe(false)
    useJournalStore.getState().add({ kind: "live", label: "John 3:16" })
    expect(journalUnkept()).toBe(true)
    await keepJournal()
    expect(mockInvoke).toHaveBeenCalledWith("content_save_service_log", expect.objectContaining({ body: expect.stringContaining("John 3:16") }))
    expect(journalUnkept()).toBe(false)
    // What was said goes apart from the log, so retention can remove it alone (#246 C17).
    await keepJournal("\nTranscript (recognised speech by Whisper)\n09:02  Amen")
    expect(mockInvoke).toHaveBeenLastCalledWith("content_save_service_log", expect.objectContaining({ transcript: expect.stringContaining("Amen"), body: expect.not.stringContaining("Amen") }))
    useJournalStore.getState().add({ kind: "live", label: "John 3:17" })
    useJournalStore.getState().clear()
    expect(journalUnkept()).toBe(false)
  })
})
