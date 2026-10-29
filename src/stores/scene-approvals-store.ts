import { load, type Store } from "@tauri-apps/plugin-store"
import { create } from "zustand"
import { normalizeScene } from "@/lib/scenes"
import type { Scene } from "@/types"

const FILE = "scene-approvals.json"
const KEY = "snapshot"
const VERSION = 1
const MAX_REQUESTS = 200
const MAX_AUDIT = 500
const MAX_SCENE_BYTES = 64 * 1024

export type SceneApprovalStatus = "pending" | "approved" | "declined" | "needs-review" | "superseded"
export type SceneApprovalAction = Exclude<SceneApprovalStatus, "pending">

export interface SceneEditApproval {
  id: string
  kind: "scene-edit"
  scene: Scene | null
  sceneId: string
  name: string
  /** Revision of the host scene the request was based on; null means it did not exist yet. */
  savedAt: number | null
  by: string
  at: number
  status: SceneApprovalStatus
  decidedAt?: number
  decidedBy?: string
  reason?: string
}

export interface SceneApprovalAudit {
  id: string
  requestId: string
  action: "created" | SceneApprovalAction
  actor: string
  at: number
  reason?: string
}

interface Snapshot {
  version: typeof VERSION
  requests: SceneEditApproval[]
  audit: SceneApprovalAudit[]
}

interface SceneApprovalsState {
  requests: SceneEditApproval[]
  audit: SceneApprovalAudit[]
  hydrated: boolean
  error: string | null
}

export const useSceneApprovalsStore = create<SceneApprovalsState>(() => ({
  requests: [],
  audit: [],
  hydrated: false,
  error: null,
}))

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max
const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
const STATUSES: readonly SceneApprovalStatus[] = ["pending", "approved", "declined", "needs-review", "superseded"]
const ACTIONS: readonly SceneApprovalAudit["action"][] = ["created", ...STATUSES.filter((s) => s !== "pending")]

function readRequest(value: unknown): SceneEditApproval | null {
  if (!isRecord(value) || value.kind !== "scene-edit" || !isText(value.id, 100) || !isText(value.sceneId, 100) || !isText(value.name, 80) || !isText(value.by, 60) || !isTime(value.at) || !STATUSES.includes(value.status as SceneApprovalStatus)) return null
  if (value.savedAt !== null && !isTime(value.savedAt)) return null
  let scene: Scene | null = null
  if (value.scene !== null) {
    scene = normalizeScene(value.scene)
    if (!scene || scene.id !== value.sceneId || JSON.stringify(scene).length > MAX_SCENE_BYTES) return null
  }
  if ((value.decidedAt !== undefined && !isTime(value.decidedAt)) || (value.decidedBy !== undefined && !isText(value.decidedBy, 60)) || (value.reason !== undefined && (typeof value.reason !== "string" || value.reason.length > 200))) return null
  return {
    id: value.id,
    kind: "scene-edit",
    scene,
    sceneId: value.sceneId,
    name: value.name,
    savedAt: value.savedAt as number | null,
    by: value.by,
    at: value.at,
    status: value.status as SceneApprovalStatus,
    ...(value.decidedAt === undefined ? {} : { decidedAt: value.decidedAt }),
    ...(value.decidedBy === undefined ? {} : { decidedBy: value.decidedBy }),
    ...(value.reason === undefined ? {} : { reason: value.reason }),
  }
}

function readAudit(value: unknown): SceneApprovalAudit | null {
  if (!isRecord(value) || !isText(value.id, 100) || !isText(value.requestId, 100) || !ACTIONS.includes(value.action as SceneApprovalAudit["action"]) || !isText(value.actor, 60) || !isTime(value.at)) return null
  if (value.reason !== undefined && (typeof value.reason !== "string" || value.reason.length > 200)) return null
  return {
    id: value.id,
    requestId: value.requestId,
    action: value.action as SceneApprovalAudit["action"],
    actor: value.actor,
    at: value.at,
    ...(value.reason === undefined ? {} : { reason: value.reason }),
  }
}

function readSnapshot(value: unknown): Snapshot | null {
  if (!isRecord(value) || value.version !== VERSION || !Array.isArray(value.requests) || !Array.isArray(value.audit) || value.requests.length > MAX_REQUESTS || value.audit.length > MAX_AUDIT) return null
  const requests = value.requests.map(readRequest)
  const audit = value.audit.map(readAudit)
  if (requests.some((request) => request === null) || audit.some((entry) => entry === null)) return null
  return { version: VERSION, requests: requests as SceneEditApproval[], audit: audit as SceneApprovalAudit[] }
}

let db: Store | null = null
let hydration: Promise<void> | null = null
let writes: Promise<void> = Promise.resolve()

async function openStore(): Promise<Store> {
  if (!db) db = await load(FILE, { autoSave: false, defaults: {} })
  return db
}

/** Load the host-owned request ledger before showing its badge or accepting a decision. */
export function hydrateSceneApprovals(forceReload = false): Promise<void> {
  if (forceReload) {
    hydration = null
    db = null
  }
  if (hydration) return hydration
  hydration = (async () => {
    try {
      const store = await openStore()
      const raw = await store.get<unknown>(KEY)
      if (raw == null) {
        useSceneApprovalsStore.setState({ requests: [], audit: [], hydrated: true, error: null })
        return
      }
      const parsed = readSnapshot(raw)
      if (!parsed) throw new Error("The saved approval request file is damaged or from an unsupported version.")
      useSceneApprovalsStore.setState({ requests: parsed.requests, audit: parsed.audit, hydrated: true, error: null })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      useSceneApprovalsStore.setState({ hydrated: false, error: message })
      hydration = null
      throw error
    }
  })()
  return hydration
}

/** Reload persisted records after a host restart or after an explicit recovery action. */
export function reloadSceneApprovals(): Promise<void> {
  return hydrateSceneApprovals(true)
}

function changeSnapshot(change: (current: SceneApprovalsState) => { requests: SceneEditApproval[]; audit: SceneApprovalAudit[]; result: boolean }): Promise<boolean> {
  const operation = writes.catch(() => undefined).then(async () => {
    await hydrateSceneApprovals()
    const current = useSceneApprovalsStore.getState()
    const next = change(current)
    if (!next.result) return false
    let requests = next.requests
    if (requests.length > MAX_REQUESTS) {
      const removable = requests.filter((item) => item.status !== "pending" && item.status !== "needs-review").slice(0, requests.length - MAX_REQUESTS)
      if (removable.length < requests.length - MAX_REQUESTS) throw new Error("The approval list is full of unresolved requests. Review or decline one before adding another.")
      const removed = new Set(removable.map((item) => item.id))
      requests = requests.filter((item) => !removed.has(item.id))
    }
    const snapshot: Snapshot = { version: VERSION, requests, audit: next.audit.slice(-MAX_AUDIT) }
    const store = await openStore()
    await store.set(KEY, snapshot)
    await store.save()
    useSceneApprovalsStore.setState({ requests: snapshot.requests, audit: snapshot.audit, hydrated: true, error: null })
    return true
  })
  writes = operation.then(() => undefined, () => undefined)
  return operation
}

export async function createSceneEditApproval(input: Omit<SceneEditApproval, "id" | "kind" | "status" | "decidedAt" | "decidedBy" | "reason">): Promise<SceneEditApproval> {
  if (input.scene && JSON.stringify(input.scene).length > MAX_SCENE_BYTES) throw new Error("The scene request is too large to save for approval.")
  const id = crypto.randomUUID()
  const request: SceneEditApproval = { ...input, id, kind: "scene-edit", status: "pending" }
  let created = request
  const saved = await changeSnapshot((current) => {
    const now = Date.now()
    const replaced = current.requests.filter((item) => (item.status === "pending" || item.status === "needs-review") && item.sceneId === request.sceneId && item.by === request.by)
    const replacedIds = new Set(replaced.map((item) => item.id))
    const requests = current.requests.map((item) => replacedIds.has(item.id) ? { ...item, status: "superseded" as const, decidedAt: now, decidedBy: "Main desk", reason: "A newer request replaced it." } : item)
    requests.push(request)
    const audit = [...current.audit, ...replaced.map((item) => ({ id: crypto.randomUUID(), requestId: item.id, action: "superseded" as const, actor: "Main desk", at: now, reason: "A newer request replaced it." })), { id: crypto.randomUUID(), requestId: request.id, action: "created" as const, actor: request.by, at: request.at }]
    created = request
    return { requests, audit, result: true }
  })
  if (!saved) throw new Error("The scene request could not be saved.")
  return created
}

export async function decideSceneEditApproval(id: string, action: Exclude<SceneApprovalAction, "superseded">, actor: string, reason?: string): Promise<boolean> {
  return changeSnapshot((current) => {
    const request = current.requests.find((item) => item.id === id && (item.status === "pending" || (action === "declined" && item.status === "needs-review")))
    if (!request) return { requests: current.requests, audit: current.audit, result: false }
    const at = Date.now()
    const cleanReason = reason?.trim().slice(0, 200)
    const requests = current.requests.map((item) => item.id === id ? {
      ...item,
      status: action,
      decidedAt: at,
      decidedBy: actor.trim().slice(0, 60) || "Main desk",
      ...(cleanReason ? { reason: cleanReason } : {}),
    } : item)
    const audit = [...current.audit, { id: crypto.randomUUID(), requestId: id, action, actor: actor.trim().slice(0, 60) || "Main desk", at, ...(cleanReason ? { reason: cleanReason } : {}) }]
    return { requests, audit, result: true }
  })
}
