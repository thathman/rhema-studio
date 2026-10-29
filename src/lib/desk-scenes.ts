import { toast } from "sonner"
import { normalizeScene } from "@/lib/scenes"
import { isCountdownTo } from "@/lib/countdown"
import { useRouterHealth, whepUrl } from "@/lib/cameras"
import { outputsForScreens, useBroadcastStore } from "@/stores/broadcast-store"
import { useJournalStore } from "@/stores/journal-store"
import { useNotices } from "@/stores/notices-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useJoin } from "@/stores/join-store"
import { createSceneEditApproval, decideSceneEditApproval, hydrateSceneApprovals, useSceneApprovalsStore, type SceneEditApproval } from "@/stores/scene-approvals-store"
import { CONTENT_TYPES, type ContentType } from "@/types/broadcast"
import { NO_SIGNALS } from "@/types/scene"
import type { Scene, SceneBox, SceneCrop, SceneLayer, SceneLayerKind } from "@/types"

/**
 * Scenes made and changed from joined desks (#243 SC.16, SC.17). The host publishes each scene's
 * definition (not its pictures or videos); a Screens or settings desk sends a changed scene back,
 * and the host's server refuses one made from an older copy with the same revision check as every
 * other command ("scene:<id>" in the Live State's `revisions`).
 *
 * The approval rule, the default until the owner chooses another: a new scene, or a change to a
 * scene that is on no screen, goes in at once. A change to a scene that is on a screen, deleting
 * one, and any scene change while Approvals is on (Team → Approvals), becomes a request the main desk
 * accepts or declines in its notices. In rehearsal a desk's changes are not on air, so only a
 * scene on a real screen waits. The server applies the same rule; the host checks again here and
 * never lets a waiting change in by itself.
 *
 * A scene from a desk is rebuilt here from the fields a desk may set, each checked: never spread
 * from what arrived. Pictures, videos and held copies come only from the host's own scene.
 */

/** What a layer keeps only on the host: its picture, its video's address here and a held copy. */
const HOST_ONLY = ["imageUrl", "videoUrl", "held"] as const

/** Persist only the proposed arrangement; the unchanged host scene remains the source of local media. */
function approvalScene(scene: Scene): Scene {
  return {
    ...scene,
    layers: scene.layers.map((layer) => {
      const copy = { ...layer }
      for (const key of ["mediaId", "mediaFile", ...HOST_ONLY] as const) delete copy[key]
      return copy
    }),
  }
}

/** A scene as the Live State carries it to joined desks. */
export type DeskScene = Omit<Scene, "layers" | "createdAt" | "updatedAt" | "libraryLookId"> & { onScreen: boolean; layers: SceneLayer[] }

/** Whether a scene in a host's Live State can be edited on a joined desk: a newer host sent its arrangement. */
export const deskEditable = (s: { layers?: unknown }): boolean => Array.isArray(s.layers)

/** A scene for the Live State: its arrangement without pictures, video addresses or held copies. */
export function sceneForDesk(scene: Scene, onScreen: boolean): DeskScene {
  return {
    id: scene.id,
    name: scene.name,
    background: scene.background,
    ...(scene.fadeMs ? { fadeMs: scene.fadeMs } : {}),
    onScreen,
    layers: scene.layers.map((l) => {
      const out: SceneLayer = { ...l }
      for (const k of HOST_ONLY) delete out[k]
      return out
    }),
  }
}

/** The scenes on a real screen now (rehearsal's own takes are not). */
export function scenesOnScreen(s: Parameters<typeof outputsForScreens>[0] = useBroadcastStore.getState()): Set<string> {
  return new Set(outputsForScreens(s).flatMap((o) => (o.sceneId ? [o.sceneId] : [])))
}

const KINDS: readonly SceneLayerKind[] = ["feed", "color", "picture", "video", "camera", "clock", "ticker", "lowerThird", "logo"]
const HEX = /^#[0-9a-f]{6}$/i
const text = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : undefined)
const num = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined)
const pick = <T extends string>(v: unknown, set: readonly T[]): T | undefined => set.find((x) => x === v)

/** A scene background a desk may set: transparent, or one colour as #rrggbb. */
export const deskBackground = (v: unknown): string | null => (v === "transparent" ? v : typeof v === "string" && HEX.test(v) ? v : null)

/** The router addresses of the church's named cameras (Live → Production tools → Cameras), the only ones a desk may choose. */
export function namedCameraUrls(): Set<string> {
  const r = useRouterHealth.getState().status
  if (!r?.running || !r.lanAddress) return new Set()
  return new Set(useSettingsStore.getState().cameras.map((c) => whepUrl(r.lanAddress!, r.ports, c.name)))
}

/**
 * One layer from a desk, built from the fields it may set: its kind from the known kinds, numbers
 * clamped, choices from their sets, words limited in length, a colour as #rrggbb, a look only of
 * this host's, a camera only one of the church's named cameras (or the one the layer already had).
 * Anything else is dropped; pictures, videos and held copies come from `had` (the host's own layer).
 */
function deskLayer(raw: unknown, had: SceneLayer | undefined, cameras: Set<string>, themes: Set<string>): SceneLayer | null {
  if (!raw || typeof raw !== "object") return null
  const l = raw as Record<string, unknown>
  const id = text(l.id, 100)
  const kind = pick(l.kind, KINDS)
  if (!id || !kind) return null
  const b = (l.box ?? {}) as Record<string, unknown>
  const box: SceneBox = { x: num(b.x, 0, 100) ?? 0, y: num(b.y, 0, 100) ?? 0, w: num(b.w, 1, 100) ?? 100, h: num(b.h, 1, 100) ?? 100 }
  const c = l.crop && typeof l.crop === "object" ? (l.crop as Record<string, unknown>) : null
  const crop: SceneCrop | undefined = c ? { l: num(c.l, 0, 90) ?? 0, t: num(c.t, 0, 90) ?? 0, r: num(c.r, 0, 90) ?? 0, b: num(c.b, 0, 90) ?? 0 } : undefined
  const shows = Array.isArray(l.shows) ? l.shows.filter((k): k is ContentType => (CONTENT_TYPES as readonly unknown[]).includes(k)) : []
  const cameraUrl = typeof l.cameraUrl === "string" && (cameras.has(l.cameraUrl) || l.cameraUrl === had?.cameraUrl) ? l.cameraUrl : undefined
  const themeId = typeof l.themeId === "string" && themes.has(l.themeId) ? l.themeId : undefined
  const fadeMs = num(l.fadeMs, 0, 3000)
  const until = typeof l.until === "string" && /^\d{1,2}:\d{2}$/.test(l.until) ? l.until : undefined
  const layer: SceneLayer = {
    id,
    name: text(l.name, 80) ?? "Layer",
    kind,
    box,
    opacity: num(l.opacity, 0, 1) ?? 1,
    visible: l.visible !== false,
    ...(crop ? { crop } : {}),
    ...(kind === "feed" && shows.length ? { shows: [...new Set(shows)] } : {}),
    ...(kind === "camera" && cameraUrl ? { cameraUrl } : {}),
    ...(kind === "camera" && text(l.cameraFallback, 120) ? { cameraFallback: text(l.cameraFallback, 120) } : {}),
    ...(kind === "camera" && pick(l.noSignal, NO_SIGNALS) ? { noSignal: pick(l.noSignal, NO_SIGNALS) } : {}),
    ...(kind === "camera" && l.noSignalName === true ? { noSignalName: true } : {}),
    ...(kind === "clock" && pick(l.clockShows, ["time", "until", "countdown"] as const) ? { clockShows: pick(l.clockShows, ["time", "until", "countdown"] as const) } : {}),
    ...(kind === "clock" && until ? { until } : {}),
    ...(kind === "clock" && isCountdownTo(l.countdownTo) && l.countdownTo.length <= 120 ? { countdownTo: l.countdownTo } : {}),
    ...((kind === "feed" || kind === "clock") && themeId ? { themeId } : {}),
    ...(kind === "color" && typeof l.color === "string" && HEX.test(l.color) ? { color: l.color } : {}),
    ...(kind === "feed" && pick(l.language, ["both", "first", "second"] as const) ? { language: pick(l.language, ["both", "first", "second"] as const) } : {}),
    ...(fadeMs ? { fadeMs } : {}),
  }
  // Media is the host's: a layer keeps its own picture, video and held copy, a new one has none.
  if (had && had.kind === kind) for (const k of ["mediaId", "mediaFile", ...HOST_ONLY] as const) if (had[k] !== undefined) Object.assign(layer, { [k]: had[k] })
  return layer
}

/**
 * A scene from a desk, rebuilt from what a desk may set (see `deskLayer`) and made safe, with
 * what only the host has given back. Null when it is not a scene, or its background is anything but
 * transparent or a #rrggbb colour. The scene keeps when it was made and the look it came from.
 */
export function mergeDeskScene(raw: unknown, existing: Scene | undefined, opts: { cameras?: Set<string>; themes?: Set<string> } = {}): Scene | null {
  if (!raw || typeof raw !== "object") return null
  const s = raw as Record<string, unknown>
  const id = text(s.id, 100)
  const background = deskBackground(s.background ?? "#000000")
  if (!id || !background || (existing && existing.id !== id)) return null
  const cameras = opts.cameras ?? namedCameraUrls()
  const themes = opts.themes ?? new Set(useBroadcastStore.getState().themes.map((t) => t.id))
  const before = new Map(existing?.layers.map((l) => [l.id, l]) ?? [])
  const layers = (Array.isArray(s.layers) ? s.layers.slice(0, 40) : []).flatMap((l) => {
    const out = deskLayer(l, before.get((l as { id?: unknown } | null)?.id as string), cameras, themes)
    return out ? [out] : []
  })
  const fadeMs = num(s.fadeMs, 0, 3000)
  const now = Date.now()
  const scene = normalizeScene({ id, name: text(s.name, 80) ?? "Scene", background, layers, ...(fadeMs ? { fadeMs } : {}), createdAt: existing?.createdAt ?? now, updatedAt: existing?.updatedAt ?? now, ...(existing?.libraryLookId ? { libraryLookId: existing.libraryLookId } : {}) })
  // normalizeScene names every optional field; keep only those that are set.
  return scene && { ...scene, layers: scene.layers.map((l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined)) as unknown as SceneLayer) }
}

/** Why a change to this scene waits for the main desk, or null when it goes in at once. */
export function waitsForMainDesk(sceneId: string): string | null {
  const b = useBroadcastStore.getState()
  if (useSettingsStore.getState().requireApproval && !b.rehearsal) return "Approvals is on at the main desk (Team → Approvals)"
  if (scenesOnScreen(b).has(sceneId)) return "that scene is on a screen"
  return null
}

/** Compatibility name for the host-persisted, typed scene approval ledger. */
export const useSceneRequests = useSceneApprovalsStore

const savedAt = (sceneId: string): number | null => useBroadcastStore.getState().scenes.find((s) => s.id === sceneId)?.updatedAt ?? null

function apply(r: Pick<SceneEditApproval, "scene" | "sceneId" | "name" | "by">, accepted: boolean) {
  const b = useBroadcastStore.getState()
  if (r.scene) b.saveScene(r.scene)
  else b.deleteScene(r.sceneId)
  const what = r.scene ? (b.scenes.some((s) => s.id === r.sceneId) ? "changed" : "made") : "deleted"
  useJournalStore.getState().add({ kind: "scene", label: `Scene ${r.name} ${what} by ${r.by}${accepted ? " (accepted on the main desk)" : ""}` })
}

const asText = (v: unknown, n: number): string => (typeof v === "string" ? v.trim().slice(0, n) : "")

/**
 * A scene change from a desk, as the host's server passed it on (`remote:save_scene` or, with
 * `deleting`, `remote:delete_scene`): saved at once, or a request in the main desk's notices.
 */
export async function receiveDeskScene(p: Record<string, unknown>, deleting = false): Promise<void> {
  const by = asText(p.by, 60) || "a remote"
  const byId = asText(p.byId, 100)
  const sceneId = deleting ? asText(p.id, 100) : asText((p.scene as { id?: unknown } | null)?.id, 100)
  if (!sceneId) return
  const existing = useBroadcastStore.getState().scenes.find((s) => s.id === sceneId)
  if (deleting && !existing) return
  const scene = deleting ? null : mergeDeskScene(p.scene, existing)
  if (!deleting && !scene) {
    toast.warning(`${by}'s scene change was not saved`, { description: "It was not a scene this computer can use." })
    return
  }
  const name = scene?.name ?? existing?.name ?? "the scene"
  const why = p.request === true ? waitsForMainDesk(sceneId) ?? "the host's server asked for it" : waitsForMainDesk(sceneId)
  if (!why) return apply({ scene, sceneId, name, by }, false)
  let request: Awaited<ReturnType<typeof createSceneEditApproval>>
  try {
    await hydrateSceneApprovals()
    request = await createSceneEditApproval({ scene: scene ? approvalScene(scene) : null, sceneId, name, savedAt: savedAt(sceneId), by, at: Date.now() })
  } catch (error) {
    toast.error("Scene request was not saved", { description: error instanceof Error ? error.message : String(error) })
    return
  }
  const verb = deleting ? "delete" : existing ? "change" : "add"
  useNotices.getState().send({ from: by, ...(byId ? { fromId: byId } : {}), to: "host", priority: "normal", text: `Asks to ${verb} the scene “${name}”, because ${why}. Accept puts it in; Decline leaves the scene as it is.`, action: { kind: "sceneEdit", value: request.id } })
}

/** Accept a waiting scene change (the main desk's notice button): null when done, else why not. */
export async function acceptSceneRequest(id: string): Promise<string | null> {
  if (useJoin.getState().status !== "off") return "only the main host can approve scene changes"
  try {
    await hydrateSceneApprovals()
  } catch {
    return "scene approvals could not be loaded from this host"
  }
  const r = useSceneRequests.getState().requests.find((x) => x.id === id)
  if (!r) return "that change was already answered, or Rhema Studio restarted since"
  if (r.status !== "pending") return r.status === "needs-review" ? "that request needs a fresh review from the operator" : "that request was already handled"
  if (savedAt(r.sceneId) !== r.savedAt) {
    try {
      await decideSceneEditApproval(id, "needs-review", useSettingsStore.getState().operatorName || "Main desk", "The host scene changed after this request was made.")
    } catch {
      return "the scene changed here since it was asked, and its review status could not be saved"
    }
    return "the scene changed here since it was asked; a fresh request is needed"
  }
  // Deleting a saved scene also clears any output that uses it. Keep the approval pending until
  // every real output has moved elsewhere so an approval can never change the public program.
  if (!r.scene && scenesOnScreen().has(r.sceneId)) return "that scene is still on a screen; move each output to another scene before approving its deletion"
  const existing = useBroadcastStore.getState().scenes.find((scene) => scene.id === r.sceneId)
  const proposed = r.scene ? mergeDeskScene(r.scene, existing) : null
  if (r.scene && !proposed) return "that scene proposal could not be restored safely; ask the desk to send it again"
  try {
    if (!await decideSceneEditApproval(id, "approved", useSettingsStore.getState().operatorName || "Main desk")) return "that request was already handled"
  } catch {
    return "the decision could not be saved on this host; the scene was left unchanged"
  }
  apply({ ...r, scene: proposed }, true)
  return null
}

/** Decline a waiting scene change: the scene stays as it is. */
export async function declineSceneRequest(id: string): Promise<boolean> {
  if (useJoin.getState().status !== "off") return false
  try {
    await hydrateSceneApprovals()
  } catch {
    return false
  }
  const r = useSceneRequests.getState().requests.find((x) => x.id === id && (x.status === "pending" || x.status === "needs-review"))
  if (!r) return false
  try {
    if (!await decideSceneEditApproval(id, "declined", useSettingsStore.getState().operatorName || "Main desk")) return false
  } catch {
    return false
  }
  useJournalStore.getState().add({ kind: "scene", label: `Scene change to ${r.name} from ${r.by} declined on the main desk` })
  return true
}
