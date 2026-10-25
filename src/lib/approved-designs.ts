import { captureSceneAppearance, normalizeScene } from "@/lib/scenes"
import { takeSteps } from "@/lib/item-intent"
import { themeIdsOf } from "@/lib/output-themes"
import { isImageItem, type ApprovedDesignSnapshot, type BroadcastOutput, type BroadcastTheme, type MediaAssetStatus, type QueueItem, type Scene } from "@/types"

/** Capture exactly the reusable scene/look revisions named by this saved Run of Show. */
export function captureApprovedDesigns(
  items: readonly QueueItem[],
  sourceScenes: readonly Scene[],
  themes: readonly BroadcastTheme[],
  outputs: readonly BroadcastOutput[],
  logoUrl: string | null,
  media: readonly MediaAssetStatus[] = [],
): ApprovedDesignSnapshot {
  const sceneIds = new Set<string>()
  const lookIds = new Set<string>()
  const mediaIds = new Set<string>()
  for (const item of items) {
    if (item.scene_id) sceneIds.add(item.scene_id)
    if (item.look_id) lookIds.add(item.look_id)
    for (const step of takeSteps(item)) if (step.kind === "scene") sceneIds.add(step.sceneId)
    if (item.background?.media_id) mediaIds.add(item.background.media_id)
    if (isImageItem(item)) mediaIds.add(item.image.media_id)
  }

  const scenes: ApprovedDesignSnapshot["scenes"] = {}
  const looks: ApprovedDesignSnapshot["looks"] = {}
  for (const id of lookIds) {
    const look = themes.find((candidate) => candidate.id === id)
    if (look) looks[id] = JSON.parse(JSON.stringify(look)) as BroadcastTheme
  }
  for (const id of sceneIds) {
    const found = sourceScenes.find((candidate) => candidate.id === id)
    if (!found) continue
    const scene = normalizeScene(found) ?? JSON.parse(JSON.stringify(found)) as Scene
    const sceneOutputs: ApprovedDesignSnapshot["scenes"][string]["outputs"] = {}
    for (const output of outputs) {
      if (output.role === "stage" || output.role === "signage") continue
      const appearance = captureSceneAppearance(scene, output, themes, logoUrl)
      sceneOutputs[output.id] = appearance
      for (const [themeId, theme] of Object.entries(appearance.themes)) looks[themeId] = theme
    }
    for (const layer of scene.layers) {
      if (layer.themeId) {
        const look = themes.find((candidate) => candidate.id === layer.themeId)
        if (look) looks[layer.themeId] = JSON.parse(JSON.stringify(look)) as BroadcastTheme
      }
      if (layer.mediaId) mediaIds.add(layer.mediaId)
      if (layer.mediaFile) {
        const asset = media.find((candidate) => candidate.file === layer.mediaFile)
        if (asset) mediaIds.add(asset.id)
      }
    }
    scenes[id] = { scene, outputs: sceneOutputs }
  }

  return { version: 1, scenes, looks, media_ids: [...mediaIds].sort() }
}

/** References which cannot be pinned on this computer are unsafe to approve as stable designs. */
export function approvedDesignBlockers(
  items: readonly QueueItem[],
  sourceScenes: readonly Scene[],
  themes: readonly BroadcastTheme[],
  outputs: readonly BroadcastOutput[],
  media: readonly MediaAssetStatus[],
): string[] {
  const sceneIds = new Set<string>()
  const lookIds = new Set<string>()
  const mediaIds = new Set<string>()
  for (const item of items) {
    if (item.scene_id) sceneIds.add(item.scene_id)
    if (item.look_id) lookIds.add(item.look_id)
    for (const step of takeSteps(item)) if (step.kind === "scene") sceneIds.add(step.sceneId)
    if (item.background?.media_id) mediaIds.add(item.background.media_id)
    if (isImageItem(item)) mediaIds.add(item.image.media_id)
  }
  const sceneById = new Map(sourceScenes.map((scene) => [scene.id, scene]))
  const themeById = new Map(themes.map((theme) => [theme.id, theme]))
  const mediaById = new Map(media.map((asset) => [asset.id, asset]))
  const errors: string[] = []
  for (const id of sceneIds) {
    const scene = sceneById.get(id)
    if (!scene) {
      errors.push(`Scene ${id} is not on this computer.`)
      continue
    }
    for (const layer of scene.layers) {
      if (layer.mediaId) mediaIds.add(layer.mediaId)
      if (layer.mediaFile && !media.some((asset) => asset.file === layer.mediaFile && asset.present)) errors.push(`Scene ${scene.name} is missing its video file.`)
    }
    for (const output of outputs) {
      if (output.role === "stage" || output.role === "signage") continue
      for (const id of sceneThemeIds(scene, output)) lookIds.add(id)
    }
  }
  for (const id of lookIds) if (!themeById.has(id)) errors.push(`Look ${id} is not on this computer.`)
  for (const id of mediaIds) if (!mediaById.get(id)?.present) errors.push(`Media ${id} is missing.`)
  return [...new Set(errors)]
}

function sceneThemeIds(scene: Scene, output: BroadcastOutput): string[] {
  const ids = new Set<string>()
  for (const layer of scene.layers) {
    if (layer.kind === "feed") {
      if (layer.themeId) ids.add(layer.themeId)
      else for (const id of themeIdsOf(output)) ids.add(id)
    } else if (layer.kind === "clock" || layer.kind === "camera") {
      ids.add(layer.themeId ?? output.themeId)
    } else if (layer.kind === "ticker" || layer.kind === "lowerThird") {
      ids.add(output.themeId)
    }
  }
  return [...ids]
}
