import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Scene } from "@/types"

const disk = vi.hoisted(() => ({ values: new Map<string, unknown>(), failSave: false }))
const mockLoad = vi.hoisted(() => vi.fn(async (...args: unknown[]) => {
  void args
  return {
    get: async (key: string) => disk.values.get(key),
    set: async (key: string, value: unknown) => { disk.values.set(key, value) },
    save: async () => { if (disk.failSave) throw new Error("disk unavailable") },
  }
}))

vi.mock("@tauri-apps/plugin-store", () => ({ load: (...args: unknown[]) => mockLoad(...args) }))

const { createSceneEditApproval, decideSceneEditApproval, reloadSceneApprovals, useSceneApprovalsStore } = await import("./scene-approvals-store")

const scene: Scene = { id: "welcome", name: "Welcome", background: "#000000", createdAt: 1, updatedAt: 2, layers: [] }
const input = { scene, sceneId: "welcome", name: "Welcome", savedAt: 2, by: "Screens operator", at: 10 }

beforeEach(() => {
  disk.values.clear()
  disk.failSave = false
  useSceneApprovalsStore.setState({ requests: [], audit: [], hydrated: false, error: null })
  mockLoad.mockClear()
})

describe("host scene approval records", () => {
  it("persists a typed request and restores it after a clean reload", async () => {
    const created = await createSceneEditApproval(input)

    expect(created).toMatchObject({ kind: "scene-edit", status: "pending", sceneId: "welcome", by: "Screens operator" })
    expect(disk.values.get("snapshot")).toMatchObject({ version: 1, requests: [created], audit: [{ action: "created", requestId: created.id }] })

    await reloadSceneApprovals()

    expect(useSceneApprovalsStore.getState().requests).toEqual([created])
    expect(useSceneApprovalsStore.getState().audit).toMatchObject([{ requestId: created.id, action: "created" }])
  })

  it("does not announce an approval request that could not be saved", async () => {
    disk.failSave = true

    await expect(createSceneEditApproval(input)).rejects.toThrow("disk unavailable")
    expect(useSceneApprovalsStore.getState().requests).toEqual([])
  })

  it("supersedes an older pending or stale request when the same desk sends a fresh one", async () => {
    const first = await createSceneEditApproval(input)
    expect(await decideSceneEditApproval(first.id, "needs-review", "Main desk", "The scene changed.")).toBe(true)
    const second = await createSceneEditApproval({ ...input, at: 11 })

    expect(useSceneApprovalsStore.getState().requests).toMatchObject([
      { id: first.id, status: "superseded", reason: "A newer request replaced it." },
      { id: second.id, status: "pending" },
    ])
  })
})
