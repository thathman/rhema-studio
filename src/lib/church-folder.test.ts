import { describe, expect, it } from "vitest"
import { newerInFolder, newestPerService, type FolderEntry } from "./church-folder"

const e = (file_name: string, over: Partial<FolderEntry>): FolderEntry => ({
  path: `/f/${file_name}`, file_name, modified: 100, sha256: file_name, title: "Sunday", service_date: "2026-10-25", source_id: "p1",
  revision: 1, approved_revision: null, approved_by: null, item_count: 3, error: null, ...over,
})

describe("church folder listing", () => {
  it("shows the newest version of each service, counts older ones, and keeps broken files apart", () => {
    const { services, broken } = newestPerService([
      e("Sunday v3", { revision: 3, modified: 50 }),
      e("Sunday v5", { revision: 5, modified: 40 }),
      e("Youth v1", { source_id: "p2", title: "Youth", service_date: "2026-10-31" }),
      e("Old file", { source_id: null, title: "Carol service", service_date: "2025-12-24", revision: null }),
      e("Half", { error: "damaged (checksum does not match); it may still be syncing" }),
    ])
    expect(services.map((s) => [s.newest.file_name, s.older])).toEqual([["Youth v1", 0], ["Sunday v5", 1], ["Old file", 0]])
    expect(broken.map((b) => b.file_name)).toEqual(["Half"])
  })

  it("says when the folder holds a newer version of the copy opened here, never an older one", () => {
    const { services } = newestPerService([e("v5", { revision: 5, sha256: "s5" }), e("v6", { revision: 6, sha256: "s6", approved_revision: 6 }), e("other", { source_id: "p9", sha256: "o1" })])
    const opened = { sha256: "s5", source_id: "p1", title: "Sunday", service_date: "2026-10-25", revision: 5 }
    expect(newerInFolder(opened, services)?.file_name).toBe("v6")
    expect(newerInFolder({ ...opened, sha256: "s6", revision: 6 }, services)).toBeNull()
    expect(newerInFolder({ ...opened, revision: 9, sha256: "s9" }, services)).toBeNull()
    expect(newerInFolder({ ...opened, source_id: "gone" }, services)).toBeNull()
  })
})
