import { describe, expect, it, vi } from "vitest"
import {
  LIBRARY_TARGET_PREFERENCES_KEY,
  LOCAL_DRAFT_TARGET_OWNER,
  readLibraryTargetPreferences,
  writeLibraryTargetPreferences,
  type LibraryTargetStorage,
} from "./library-target-store"

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const storage: LibraryTargetStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
  }
  return { storage, values }
}

describe("Library destination preferences", () => {
  it("round-trips a separate destination for each saved service", () => {
    const { storage, values } = memoryStorage()

    writeLibraryTargetPreferences(storage, {
      "service-a": "header:event-a",
      "service-b": "header:phase-b",
      [LOCAL_DRAFT_TARGET_OWNER]: "end-of-run-of-show",
    })

    expect(JSON.parse(values.get(LIBRARY_TARGET_PREFERENCES_KEY)!)).toEqual({
      version: 1,
      byServiceId: {
        "service-a": "header:event-a",
        "service-b": "header:phase-b",
      },
    })
    expect(readLibraryTargetPreferences(storage)).toEqual({
      "service-a": "header:event-a",
      "service-b": "header:phase-b",
    })
  })

  it("ignores malformed, unsupported, and empty preference entries", () => {
    const malformed = memoryStorage({ [LIBRARY_TARGET_PREFERENCES_KEY]: "{" })
    expect(readLibraryTargetPreferences(malformed.storage)).toEqual({})

    const unsupported = memoryStorage({
      [LIBRARY_TARGET_PREFERENCES_KEY]: JSON.stringify({
        version: 2,
        byServiceId: { "service-a": "header:event-a" },
      }),
    })
    expect(readLibraryTargetPreferences(unsupported.storage)).toEqual({})

    const invalidEntries = memoryStorage({
      [LIBRARY_TARGET_PREFERENCES_KEY]: JSON.stringify({
        version: 1,
        byServiceId: {
          "": "header:empty-owner",
          "service-a": "",
          "service-b": 42,
          [LOCAL_DRAFT_TARGET_OWNER]: "end-of-run-of-show",
          "service-c": "header:event-c",
        },
      }),
    })
    expect(readLibraryTargetPreferences(invalidEntries.storage)).toEqual({
      "service-c": "header:event-c",
    })
  })

  it("keeps Library usable when browser storage is unavailable", () => {
    const storage: LibraryTargetStorage = {
      getItem: vi.fn(() => { throw new Error("storage denied") }),
      setItem: vi.fn(() => { throw new Error("storage denied") }),
    }

    expect(readLibraryTargetPreferences(storage)).toEqual({})
    expect(() => writeLibraryTargetPreferences(storage, { "service-a": "header:event-a" })).not.toThrow()
  })
})
