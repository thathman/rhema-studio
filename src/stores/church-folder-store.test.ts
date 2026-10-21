import { describe, expect, it, vi } from "vitest"

let resolveFirst!: (v: unknown) => void
const calls: string[] = []
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (_cmd: string, a: { folder: string }) => {
    calls.push(a.folder)
    if (a.folder === "/old") return new Promise((r) => { resolveFirst = r })
    return Promise.resolve([{ file_name: "new.rhema-service.json" }])
  },
}))

describe("church folder scan store", () => {
  it("never shows a previous folder's list, and scans a folder asked for during a scan", async () => {
    const { useChurchFolderStore, entriesFor } = await import("./church-folder-store")
    const first = useChurchFolderStore.getState().refresh("/old")
    void useChurchFolderStore.getState().refresh("/new")
    resolveFirst([{ file_name: "old.rhema-service.json" }])
    await first
    expect(calls).toEqual(["/old", "/new"])
    expect(entriesFor(useChurchFolderStore.getState(), "/new")?.[0].file_name).toBe("new.rhema-service.json")
    expect(entriesFor(useChurchFolderStore.getState(), "/old")).toBeNull()
  })
})
