/**
 * The main desk's named-output scene Take (#410), checked by this host in-process: no server, LAN
 * API or network round trip. Three separate truths, never merged:
 *   1. accepted: the host checked the output and scene against what Preview reviewed, and moved
 *      the output's revision (a joined desk acting on the old one is refused);
 *   2. applied: the app's store put the scene on that one output (`takeScene`);
 *   3. drawn: a receiver acknowledged a frame carrying it (browser feeds only; windows and NDI
 *      report no acknowledgement).
 * Preview stays private: reading revisions changes nothing, and nothing is taken until
 * `takeSceneOnOutput` is called. Source Take (what content is live) is a different thing.
 */
import { invoke } from "@tauri-apps/api/core"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { publishLiveState } from "@/lib/live-state"

/** The output's and scene's host revisions a Take acts on; read at Preview, sent back at Take. */
export interface SceneTakeRevisions {
  output: number
  scene: number
}

/**
 * Why the host refused: `stale` (the output or scene changed or is gone: re-read and review
 * again), `not-congregation` (scenes go to congregation outputs only), `unavailable` (the host's
 * Live State is not ready: try again), `invalid` (bad id), `not-main-desk` (another window asked).
 */
export interface SceneTakeRefusal {
  code: "stale" | "not-congregation" | "unavailable" | "invalid" | "not-main-desk"
  message: string
}

/** Where to look for the receiver's confirmation of this Take. */
export type SceneTakeReceiver =
  | { kind: "feed"; feedSeq: number } // confirmed once the feed acknowledges `feedSeq` or later
  | { kind: "none" } // a window or NDI: the host can say it sent it, not that anyone saw it

export type SceneTakeResult =
  | { ok: true; acceptedRevision: number; receiver: SceneTakeReceiver }
  | { ok: false; refusal: SceneTakeRefusal }

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
 * Take `sceneId` on `outputId` only, if both are still what Preview reviewed (`seen`). A refusal
 * changes nothing on any output.
 */
export async function takeSceneOnOutput(outputId: string, sceneId: string, seen: SceneTakeRevisions): Promise<SceneTakeResult> {
  // Anything changed on this desk since Preview is in the Live State the host checks against.
  publishLiveState()
  let acceptedRevision: number
  try {
    acceptedRevision = await invoke<number>("local_scene_take", { output: outputId, scene: sceneId, seen })
  } catch (e) {
    return { ok: false, refusal: refusal(e) }
  }
  const b = useBroadcastStore.getState()
  b.takeScene(outputId, sceneId)
  const output = useBroadcastStore.getState().outputs.find((o) => o.id === outputId)
  if (output?.sceneId !== sceneId) {
    // Accepted, but the app could not apply it (the scene or output went in between). The moved
    // revision only makes other desks look again.
    return { ok: false, refusal: { code: "stale", message: "That output or scene changed as you pressed Take; check Preview and Take again" } }
  }
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
