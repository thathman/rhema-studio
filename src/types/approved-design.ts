import type { BroadcastTheme } from "./broadcast"
import type { Scene } from "./scene"
import type { SceneAppearanceSnapshot } from "./broadcast-output"

export interface ApprovedSceneSnapshot {
  scene: Scene
  /** Appearance snapshot taken for each congregation output configured at approval time. */
  outputs: Record<string, SceneAppearanceSnapshot>
}

/** Immutable scene, look and media references stored with one approved service revision. */
export interface ApprovedDesignSnapshot {
  version: 1
  scenes: Record<string, ApprovedSceneSnapshot>
  looks: Record<string, BroadcastTheme>
  /** Media files retained while this approved service revision remains in History. */
  media_ids: string[]
}
