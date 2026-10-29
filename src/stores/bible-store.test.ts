import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGet = vi.fn()
const mockSet = vi.fn()
const mockSave = vi.fn()
const mockLoad = vi.fn()
const mockInvoke = vi.fn()

vi.mock("@tauri-apps/plugin-store", () => ({
  load: (...args: unknown[]) => mockLoad(...args),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

describe("bible store persistence", () => {
  beforeEach(async () => {
    mockGet.mockReset()
    mockSet.mockReset()
    mockSave.mockReset()
    mockLoad.mockReset()
    mockInvoke.mockReset()
    mockLoad.mockResolvedValue({
      get: mockGet,
      set: mockSet,
      save: mockSave,
    })
    mockInvoke.mockResolvedValue(undefined)
    vi.resetModules()
  })

  describe("hydrateBibleStore", () => {
    it("loads from bible.json and sets stored translation in Zustand", async () => {
      mockGet.mockImplementation((key: string) =>
        Promise.resolve(key === "activeTranslationId" ? 5 : null)
      )
      const { hydrateBibleStore, useBibleStore } = await import("./bible-store")

      await hydrateBibleStore()

      expect(mockLoad).toHaveBeenCalledWith("bible.json", {
        autoSave: false,
        defaults: {},
      })
      expect(mockGet).toHaveBeenCalledWith("activeTranslationId")
      expect(useBibleStore.getState().activeTranslationId).toBe(5)
      expect(useBibleStore.getState().secondaryTranslationId).toBeNull()
    })

    it("restores valid saved references and ignores malformed entries", async () => {
      const saved = { id: "4:43:3:16", translationId: 4, bookNumber: 43, chapter: 3, verse: 16, reference: "John 3:16" }
      mockGet.mockImplementation((key: string) => Promise.resolve(key === "activeTranslationId" ? 5 : key === "savedPassages" ? [saved, { ...saved, id: "bad" }, { ...saved, reference: "Jude 4:5" }, null] : null))
      const { hydrateBibleStore, useBibleStore } = await import("./bible-store")

      await hydrateBibleStore()

      expect(useBibleStore.getState().savedPassages).toEqual([saved])
    })

    it("restores a distinct secondary translation", async () => {
      mockGet.mockImplementation((key: string) =>
        Promise.resolve(key === "activeTranslationId" ? 5 : 8)
      )
      const { hydrateBibleStore, useBibleStore } = await import("./bible-store")

      await hydrateBibleStore()

      expect(useBibleStore.getState().activeTranslationId).toBe(5)
      expect(useBibleStore.getState().secondaryTranslationId).toBe(8)
    })

    it("invokes set_active_translation with the hydrated value", async () => {
      mockGet.mockResolvedValue(5)
      const { hydrateBibleStore } = await import("./bible-store")

      await hydrateBibleStore()

      expect(mockInvoke).toHaveBeenCalledWith("set_active_translation", {
        translationId: 5,
      })
    })

    it("leaves default (1) when stored value is null and still pushes to Rust", async () => {
      mockGet.mockResolvedValue(null)
      const { hydrateBibleStore, useBibleStore } = await import("./bible-store")

      await hydrateBibleStore()

      expect(useBibleStore.getState().activeTranslationId).toBe(1)
      expect(mockInvoke).toHaveBeenCalledWith("set_active_translation", {
        translationId: 1,
      })
    })

    it("a first run (nothing saved) starts in KJV, found by name", async () => {
      mockGet.mockResolvedValue(undefined)
      mockInvoke.mockImplementation(async (cmd: string) => (cmd === "list_translations" ? [{ id: 1, abbreviation: "AMP", is_downloaded: true }, { id: 4, abbreviation: "KJV", is_downloaded: true }] : undefined))
      const { hydrateBibleStore, useBibleStore } = await import("./bible-store")
      await hydrateBibleStore()
      expect(useBibleStore.getState().activeTranslationId).toBe(4)
      expect(mockInvoke).toHaveBeenCalledWith("set_active_translation", { translationId: 4 })
    })

    it("leaves default (1) when stored value is undefined and still pushes to Rust", async () => {
      mockGet.mockResolvedValue(undefined)
      const { hydrateBibleStore, useBibleStore } = await import("./bible-store")

      await hydrateBibleStore()

      expect(useBibleStore.getState().activeTranslationId).toBe(1)
      expect(mockInvoke).toHaveBeenCalledWith("set_active_translation", {
        translationId: 1,
      })
    })

    it("handles load rejection gracefully without throwing", async () => {
      mockLoad.mockRejectedValue(new Error("store not available"))
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      const { hydrateBibleStore } = await import("./bible-store")

      await hydrateBibleStore()

      expect(warnSpy).toHaveBeenCalledWith(
        "[bible] Failed to hydrate bible store, using defaults"
      )
      warnSpy.mockRestore()
    })
  })

  describe("initBiblePersistence", () => {
    it("writes to bible.json when activeTranslationId changes", async () => {
      vi.useFakeTimers()
      const { initBiblePersistence, useBibleStore } =
        await import("./bible-store")

      await initBiblePersistence()
      useBibleStore.getState().setActiveTranslation(3)

      await vi.advanceTimersByTimeAsync(500)

      expect(mockSet).toHaveBeenCalledWith("activeTranslationId", 3)
      expect(mockSet).toHaveBeenCalledWith("secondaryTranslationId", null)
      expect(mockSave).toHaveBeenCalled()
      vi.useRealTimers()
    })

    it("debounces rapid changes and only persists the last value", async () => {
      vi.useFakeTimers()
      const { initBiblePersistence, useBibleStore } =
        await import("./bible-store")

      await initBiblePersistence()
      useBibleStore.getState().setActiveTranslation(2)
      await vi.advanceTimersByTimeAsync(200)
      useBibleStore.getState().setActiveTranslation(3)
      await vi.advanceTimersByTimeAsync(200)
      useBibleStore.getState().setActiveTranslation(4)
      await vi.advanceTimersByTimeAsync(500)

      expect(mockSet).toHaveBeenCalledTimes(2)
      expect(mockSet).toHaveBeenCalledWith("activeTranslationId", 4)
      expect(mockSet).toHaveBeenCalledWith("secondaryTranslationId", null)
      vi.useRealTimers()
    })

    it("persists the selected secondary translation", async () => {
      vi.useFakeTimers()
      const { initBiblePersistence, useBibleStore } =
        await import("./bible-store")

      await initBiblePersistence()
      useBibleStore.getState().setSecondaryTranslation(8)
      await vi.advanceTimersByTimeAsync(500)

      expect(mockSet).toHaveBeenCalledWith("secondaryTranslationId", 8)
      vi.useRealTimers()
    })

    it("persists saved Scripture references through bible.json", async () => {
      const { initBiblePersistence, useBibleStore } = await import("./bible-store")
      await initBiblePersistence()
      const saved = await useBibleStore.getState().savePassage({ id: 1, translation_id: 4, book_number: 43, book_name: "John", book_abbreviation: "John", chapter: 3, verse: 16, text: "For God so loved the world." })

      expect(saved).toBe(true)
      expect(mockSet).toHaveBeenCalledWith("savedPassages", [{ id: "4:43:3:16", translationId: 4, bookNumber: 43, chapter: 3, verse: 16, reference: "John 3:16" }])
      expect(mockSave).toHaveBeenCalled()
    })

    it("does not claim a saved passage when bible.json cannot write it", async () => {
      mockSet.mockRejectedValue(new Error("disk full"))
      const { useBibleStore } = await import("./bible-store")

      const saved = await useBibleStore.getState().savePassage({ id: 1, translation_id: 4, book_number: 43, book_name: "John", book_abbreviation: "John", chapter: 3, verse: 16, text: "For God so loved the world." })

      expect(saved).toBe(false)
      expect(useBibleStore.getState().savedPassages).toEqual([])
    })

    it("handles store load failure gracefully without throwing", async () => {
      mockLoad.mockRejectedValue(new Error("disk error"))
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      const { initBiblePersistence } = await import("./bible-store")

      await initBiblePersistence()

      expect(warnSpy).toHaveBeenCalledWith(
        "[bible] Failed to init persistence subscription"
      )
      warnSpy.mockRestore()
    })
  })
})

describe("requestVerseReveal", () => {
  it("increments the counter and records the requested scroll block", async () => {
    const { useBibleStore } = await import("./bible-store")
    useBibleStore.setState({ revealRequest: 0, revealBlock: "nearest" })

    useBibleStore.getState().requestVerseReveal("center")

    expect(useBibleStore.getState().revealRequest).toBe(1)
    expect(useBibleStore.getState().revealBlock).toBe("center")
  })

  it("fires again for an identical consecutive request", async () => {
    const { useBibleStore } = await import("./bible-store")
    useBibleStore.setState({ revealRequest: 0, revealBlock: "nearest" })

    useBibleStore.getState().requestVerseReveal("nearest")
    useBibleStore.getState().requestVerseReveal("nearest")

    expect(useBibleStore.getState().revealRequest).toBe(2)
  })
})

describe("saved Bible passages", () => {
  beforeEach(() => {
    mockSet.mockReset()
    mockSave.mockReset()
    mockLoad.mockReset()
    mockLoad.mockResolvedValue({ get: mockGet, set: mockSet, save: mockSave })
    vi.resetModules()
  })

  it("saves a translation-specific passage once and removes it from the library", async () => {
    const { useBibleStore } = await import("./bible-store")
    const passage = { id: 12, translation_id: 4, book_number: 43, book_name: "John", book_abbreviation: "John", chapter: 3, verse: 16, text: "For God so loved the world." }

    expect(await useBibleStore.getState().savePassage(passage)).toBe(true)
    expect(await useBibleStore.getState().savePassage(passage)).toBe(true)

    expect(useBibleStore.getState().savedPassages).toHaveLength(1)
    expect(useBibleStore.getState().savedPassages[0]).toMatchObject({
      id: "4:43:3:16",
      translationId: 4,
      bookNumber: 43,
      chapter: 3,
      verse: 16,
      reference: "John 3:16",
    })

    expect(await useBibleStore.getState().removeSavedPassage("4:43:3:16")).toBe(true)
    expect(useBibleStore.getState().savedPassages).toEqual([])
  })
})

describe("first-run translation", () => {
  it("is KJV by name (ids follow the library file: id 1 is AMP in the bundled one)", async () => {
    const { defaultTranslationId } = await import("./bible-store")
    const t = (id: number, abbreviation: string, is_downloaded = true) => ({ id, abbreviation, is_downloaded })
    expect(defaultTranslationId([t(1, "AMP"), t(2, "OYCB"), t(4, "KJV")])).toBe(4)
    expect(defaultTranslationId([t(1, "AMP", false), t(2, "OYCB")])).toBe(2)
    expect(defaultTranslationId([])).toBeNull()
  })
})
