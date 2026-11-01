import { useMediaStore } from "@/stores/media-store"
import type { Scene } from "@/types/scene"

/**
 * Design documents persist a content-addressed asset URL. An output frame cannot assume that a
 * browser on another device can read the host's Tauri asset protocol, so materialize its library
 * references only when a scene is previewed or sent to an output.
 */
export async function hydrateDesignSceneMedia(scene: Scene): Promise<{ scene: Scene | null; issue?: string }> {
  const failures: string[] = []
  let changed = false
  const layers = await Promise.all(scene.layers.map(async (layer) => {
    if (layer.kind !== "picture" || !layer.mediaId || layer.imageUrl?.startsWith("data:")) return layer
    const imageUrl = await useMediaStore.getState().dataUrl(layer.mediaId).catch(() => null)
    if (!imageUrl) {
      failures.push(layer.name || "Picture layer")
      return layer
    }
    changed ||= imageUrl !== layer.imageUrl
    return { ...layer, imageUrl }
  }))

  if (failures.length) {
    const names = [...new Set(failures)]
    return {
      scene: null,
      issue: names.length === 1
        ? `The Library picture “${names[0]}” is unavailable on this computer.`
        : `These Library pictures are unavailable on this computer: ${names.join(", ")}.`,
    }
  }
  return { scene: changed ? { ...scene, layers } : scene }
}
