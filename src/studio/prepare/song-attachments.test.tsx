// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})

const mockInvoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args), convertFileSrc: (p: string) => p }))
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { Attachments } from "@/studio/prepare/song-editor"

const chart = { id: "chart-1", kind: "image", name: "Chord chart.pdf", file: "c.pdf", hash: "h", size: 1, mime: "application/pdf", width: null, height: null, duration_ms: null, source: "local", source_ref: "", original_path: "", created_at: "" }
let root: Root | null = null

beforeEach(() => {
  mockInvoke.mockReset()
  mockInvoke.mockImplementation(async (command: string) => {
    if (command === "content_list_song_attachments") return [chart]
    if (command === "content_remove_song_attachment") return []
    throw new Error(`Unexpected ${command}`)
  })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  root = createRoot(document.body.appendChild(document.createElement("div")))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

describe("song attachments (#831 S7)", () => {
  it("asks before removing an attachment, and Keep leaves it linked", async () => {
    await act(async () => { root!.render(<Attachments songId="song-1" />); await new Promise((resolve) => setTimeout(resolve, 0)) })
    const trash = document.querySelector<HTMLButtonElement>('[aria-label="Remove Chord chart.pdf"]')!
    await act(async () => trash.click())
    expect(mockInvoke).not.toHaveBeenCalledWith("content_remove_song_attachment", expect.anything())
    const keep = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Keep")!
    await act(async () => keep.click())
    expect(mockInvoke).not.toHaveBeenCalledWith("content_remove_song_attachment", expect.anything())
    expect(document.body.textContent).toContain("Chord chart.pdf")

    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Remove Chord chart.pdf"]')!.click())
    const remove = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Remove")!
    await act(async () => { remove.click(); await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(mockInvoke).toHaveBeenCalledWith("content_remove_song_attachment", { songId: "song-1", mediaId: "chart-1" })
  })
})
