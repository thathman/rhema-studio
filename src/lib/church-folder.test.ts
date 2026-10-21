import { describe, expect, it } from "vitest"
import { newerInFolder, newestPerService, publishLineage, type FolderEntry } from "./church-folder"

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

describe("publishing a copy again (lineage)", () => {
  const from = { sha256: "a", source_id: "home-id", title: "Sunday", service_date: "2026-10-25", revision: 11, local_revision: 2 }
  it("goes back as the same service, numbered on from the version it was opened at", () => {
    expect(publishLineage(from, "church-copy-id", 3)).toEqual({ source_id: "home-id", revision_offset: 9 }) // local r3 → v12
    expect(publishLineage(undefined, "home-id", 12)).toBeNull() // made here: its own source
    expect(publishLineage({ ...from, source_id: "home-id" }, "home-id", 12)).toBeNull()
    // A record from before local_revision was kept: the next version after the one opened.
    const { local_revision: _unused, ...old } = from
    void _unused
    expect(publishLineage(old, "church-copy-id", 5)).toEqual({ source_id: "home-id", revision_offset: 7 }) // r5 → v12
  })

  it("the computer that made the service hears of the newer version once it has published", () => {
    const entry = (revision: number, sha256: string) => ({ path: "", file_name: `${revision}`, modified: revision, sha256, title: "Sunday", service_date: "2026-10-25", source_id: "home-id", revision, approved_revision: null, approved_by: null, item_count: 1, error: null })
    const services = [{ newest: entry(12, "tolu"), older: 1, versions: [entry(12, "tolu"), entry(11, "ade")] }]
    expect(newerInFolder({ sha256: "ade", source_id: "home-id", title: "Sunday", service_date: "2026-10-25", revision: 11, local_revision: 11 }, services)?.revision).toBe(12)
  })
})

