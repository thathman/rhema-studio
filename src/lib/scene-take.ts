/**
 * The main desk's named-output scene Take (#410), checked by this host in-process: no server, LAN
 * API or network round trip. Three separate truths, never merged:
 *   1. accepted: the host checked the output and scene against what Preview reviewed (and, in an
 *      approved service, that the scene and the output's look are pinned in that approval), and
 *      moved the output's revision (a joined desk acting on the old one is refused);
 *   2. applied: the app's store put the scene on that one output: the approved service's pinned
 *      scene and look as the host returned them, or the saved scene when the service is not approved;
 *   3. drawn: a receiver acknowledged a frame carrying it (browser feeds only; windows and NDI
 *      report no acknowledgement).
 * Preview stays private: reading revisions changes nothing, and nothing is taken until
 * `takeSceneOnOutput` is called. Source Take (what content is live) is a different thing.
 */
import { invoke } from "@tauri-apps/api/core"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { publishLiveState } from "@/lib/live-state"
import type { Scene, SceneAppearanceSnapshot } from "@/types"

/**
 * What a Take acts on, read at Preview and sent back unchanged at Take: the output's and scene's
 * host revisions, the service open, and its approved revision (null: not approved).
 */
export interface SceneTakeRevisions {
  output: number
  scene: number
  service: string | null
  approved: number | null
}

/** An approved service's pinned scene and each output's pinned look, as the host read them. */
export interface ApprovedSceneTake {
  programId: string
  revision: number
  approvedAt: string | null
  approvedBy: string | null
  scene: Scene
  outputs: Record<string, SceneAppearanceSnapshot>
}

/**
 * Why the Take did not happen: `stale` (the output, scene, service or approval changed or is gone:
 * re-read and review again), `not-congregation` (scenes go to congregation outputs only),
 * `not-approved` (the service is approved and this scene or output's look is not pinned in it),
 * `unavailable` (the host is not ready: try again), `invalid` (bad id), `not-main-desk` (another
 * window asked), `not-applied` (the host accepted it but the app could not put it up: nothing changed
 * on screen; `acceptedRevision` says the output's revision moved anyway, so other desks look again).
 */
export interface SceneTakeRefusal {
  code: "stale" | "not-congregation" | "not-approved" | "unavailable" | "invalid" | "not-main-desk" | "not-applied"
  message: string
}

/** Where to look for the receiver's confirmation of this Take. */
export type SceneTakeReceiver =
  | { kind: "feed"; feedSeq: number } // confirmed once the feed acknowledges `feedSeq` or later
  | { kind: "none" } // a window or NDI: the host can say it sent it, not that anyone saw it

export type SceneTakeResult =
  | { ok: true; acceptedRevision: number; receiver: SceneTakeReceiver }
  | { ok: false; refusal: SceneTakeRefusal; acceptedRevision?: number }

const refusal = (e: unknown): SceneTakeRefusal =>
  e && typeof e === "object" && typeof (e as SceneTakeRefusal).code === "string"
    ? (e as SceneTakeRefusal)
    : { code: "unavailable", message: String(e) }

/**
 * The revisions to keep with a Preview of `sceneId` on `outputId`. Publishes the desk's state
 * first, so a change made a moment ago is part of what is reviewed.
 */
export async function readSceneTakeRevisions(outputId: string, sceneId: string): Promise<{ ok: true; seen: SceneTakeRevisions } | { ok: false; refusal: SceneTakeRefusal }> {
  publishLiveState()
  try {
    return { ok: true, seen: await invoke<SceneTakeRevisions>("live_take_revisions", { output: outputId, scene: sceneId }) }
  } catch (e) {
    return { ok: false, refusal: refusal(e) }
  }
}

/**
 * Put a host-checked scene Take on one output (#410): `approved` (from the host) puts up the pinned
 * scene and look; null puts up the saved scene, for a service that is not approved. True only when
 * the output now shows exactly that. The one apply path for the main desk, a joined desk's Take.
 */
export function applySceneTake(outputId: string, sceneId: string, approved: ApprovedSceneTake | null): boolean {
  const b = useBroadcastStore.getState()
  if (approved) {
    const look = approved.outputs[outputId]
    if (approved.scene?.id !== sceneId || !look) return false
    b.takeSceneRevision(outputId, approved.scene, look, approved.programId, approved.revision, undefined, true, { approvedAt: approved.approvedAt, approvedBy: approved.approvedBy })
  } else {
    b.takeScene(outputId, sceneId)
  }
  const output = useBroadcastStore.getState().outputs.find((o) => o.id === outputId)
  if (output?.sceneId !== sceneId) return false
  const pin = output.sceneAppearanceSnapshot?.approved
  return approved ? pin?.programId === approved.programId && pin.revision === approved.revision : true
}

/** What the host allows for a scene Take a joined desk or group Take was accepted for: see `applySceneTake`. */
export async function sceneTakeApproval(sceneId: string, outputIds: string[]): Promise<{ ok: true; approved: ApprovedSceneTake | null } | { ok: false; refusal: SceneTakeRefusal }> {
  try {
    return { ok: true, approved: await invoke<ApprovedSceneTake | null>("scene_take_approval", { scene: sceneId, outputs: outputIds }) }
  } catch (e) {
    return { ok: false, refusal: refusal(e) }
  }
}

/**
 * Take `sceneId` on `outputId` only, if the output, scene, service and approval are still what
 * Preview reviewed (`seen`). A refusal changes nothing on any output.
 */
export async function takeSceneOnOutput(
  outputId: string,
  sceneId: string,
  seen: SceneTakeRevisions,
  isCurrent: () => boolean = () => true,
): Promise<SceneTakeResult> {
  // Anything changed on this desk since Preview is in the Live State the host checks against.
  publishLiveState()
  let accepted: { revision: number; approved: ApprovedSceneTake | null }
  try {
    accepted = await invoke<{ revision: number; approved: ApprovedSceneTake | null }>("local_scene_take", { output: outputId, scene: sceneId, seen })
  } catch (e) {
    return { ok: false, refusal: refusal(e) }
  }
  const acceptedRevision = accepted.revision
  // A newer Preview may be chosen while the host command is in flight. The host has
  // accepted this revision, but the operator's newer choice wins locally.
  if (!isCurrent()) {
    return {
      ok: false,
      acceptedRevision,
      refusal: {
        code: "not-applied",
        message: "Preview changed while Take was being checked; nothing was applied to Program. Review the current scene before taking again",
      },
    }
  }
  if (!applySceneTake(outputId, sceneId, accepted.approved)) {
    // Accepted, but not applied (the scene or output went in between): the screen is unchanged.
    // The moved revision only makes other desks look again; it never means the output changed.
    return { ok: false, acceptedRevision, refusal: { code: "not-applied", message: "That output or scene changed as you pressed Take; nothing changed on screen. Check Preview and Take again" } }
  const output = useBroadcastStore.getState().outputs.find((o) => o.id === outputId)!
  if (output.type !== "browser" || !useBroadcastStore.getState().outputStatus[outputId]?.feedActive) {
    return { ok: true, acceptedRevision, receiver: { kind: "none" } }
  }
  // Send its frame now; the host handles calls in order, so the sequence read next is that frame's
  // or a later one's, never one from before the Take.
  useBroadcastStore.getState().syncBroadcastOutputFor(outputId)
  const status = await invoke<{ seq: number } | null>("feed_status", { id: outputId }).catch(() => null)
  return { ok: true, acceptedRevision, receiver: status ? { kind: "feed", feedSeq: status.seq } : { kind: "none" } }
}

/** Whether a receiver has drawn the Take: `confirmed`, `waiting`, `no-receiver`, or `unknown` (feed off or gone). */
export async function sceneTakeDrawn(outputId: string, receiver: SceneTakeReceiver): Promise<"confirmed" | "waiting" | "no-receiver" | "unknown"> {
  if (receiver.kind !== "feed") return "unknown"
  const s = await invoke<{ watching: number; seq: number; acked: number } | null>("feed_status", { id: outputId }).catch(() => null)
  // A host restart starts the feed's count again: an older Take's frame cannot be told apart.
  if (!s || s.seq < receiver.feedSeq) return "unknown"
  if (s.acked >= receiver.feedSeq) return "confirmed"
  return s.watching > 0 ? "waiting" : "no-receiver"
}
