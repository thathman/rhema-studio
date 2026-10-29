import { useBroadcastStore } from "@/stores/broadcast-store"

/** A Screens scene request never fans out implicitly; the host selects one output in Live → Scenes. */
export function runSceneNoticeAction(sceneId: string): string | null {
  if (!useBroadcastStore.getState().scenes.some((scene) => scene.id === sceneId)) return "that scene is no longer there"
  return "This request did not change any output. Open Live → Scenes and choose one output; group Take is unavailable."
}
