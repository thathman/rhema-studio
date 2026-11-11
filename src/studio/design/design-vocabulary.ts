import { themeIdsOf } from "@/lib/output-themes"
import { sceneForOutput } from "@/lib/scenes"
import type { BroadcastOutput } from "@/types"
import type { Scene } from "@/types/scene"

/**
 * One save vocabulary across Design (#818): **Save draft** keeps changes private, **Apply to
 * outputs…** changes the looks outputs use (after naming them), and **Create version** freezes a
 * My Designs document for Prepare. Themes and the specialist tools share one draft bar.
 */
export const SAVE_VOCABULARY = "Save draft keeps changes private. Apply to outputs… changes what outputs show, after naming them. Create version freezes a My Designs design for Prepare."

/**
 * One set of template words in every context (#819): a template card adds a copy or customizes a
 * copy; in Prepare it can also be used for the moment being planned; a version is used in Prepare.
 */
export const TEMPLATE_LABELS = {
  add: "Add a copy",
  customize: "Customize a copy",
  useHere: "Use for this moment",
  useVersion: "Use in Prepare",
} as const

/** The outputs a theme reaches: assigned to it, or through a scene layer drawn with it. */
export function outputsUsingTheme(themeId: string, state: { outputs: BroadcastOutput[]; scenes: Scene[] }): BroadcastOutput[] {
  return state.outputs.filter((output) => themeIdsOf(output).includes(themeId) || !!sceneForOutput(output, state.scenes)?.layers.some((layer) => layer.themeId === themeId))
}
