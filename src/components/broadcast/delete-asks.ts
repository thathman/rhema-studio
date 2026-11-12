import { ask } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import { disableOutput } from "@/lib/broadcast-output-control"
import { outputOnAir } from "@/lib/output-on-air"
import { themeIdsOf } from "@/lib/output-themes"
import { useBroadcastStore } from "@/stores"
import type { BroadcastOutput, BroadcastTheme } from "@/types"

// Deletes in Outputs and the theme library that cannot be undone are asked first (#831 S7).

/**
 * Delete a theme, asked first (#831 S7): it cannot be undone. One an output uses is refused
 * with the outputs named; scenes whose layers use it are named in the question.
 */
export async function deleteThemeAsked(theme: BroadcastTheme): Promise<"deleted" | "kept" | "in-use"> {
  const refuse = (inUse: string[]) => {
    toast.error(`${theme.name} is used by ${inUse.join(", ")}`, { description: "Choose another look for those outputs first: Design → Used on… opens each one." })
    return "in-use" as const
  }
  const { outputs, scenes } = useBroadcastStore.getState()
  const users = outputs.filter((o) => themeIdsOf(o).includes(theme.id)).map((o) => o.name)
  if (users.length) return refuse(users)
  const inScenes = scenes.filter((scene) => scene.layers.some((layer) => layer.themeId === theme.id)).map((scene) => scene.name)
  let ok = false
  try {
    ok = await ask(
      `Delete the theme “${theme.name}”?${inScenes.length ? ` Scenes that use it: ${inScenes.join(", ")}.` : ""} Its unsaved draft goes too. This cannot be undone.`,
      { title: "Delete theme?", kind: "warning", okLabel: "Delete", cancelLabel: "Keep theme" },
    )
  } catch {
    ok = false
  }
  if (!ok) return "kept"
  // Checked again: an output may have taken it while the question was open.
  const { inUse } = useBroadcastStore.getState().deleteTheme(theme.id)
  if (inUse.length) return refuse(inUse)
  // The theme being edited is gone: close its draft (Save would bring it back).
  if (useBroadcastStore.getState().editingThemeId === theme.id) useBroadcastStore.getState().stopEditing()
  return "deleted"
}

/**
 * Remove an output, asked first (#831 S7): it cannot be undone. Its screen, feed, look and
 * signage settings go, and an output on air stops now, which the question says.
 */
export async function removeOutputAsked(output: BroadcastOutput): Promise<"removed" | "kept" | "failed"> {
  const onAir = outputOnAir(output, useBroadcastStore.getState().outputStatus[output.id])
  let ok = false
  try {
    ok = await ask(
      `${onAir ? `${output.name} is on air: it stops now. ` : ""}Its screen, feed and look settings are deleted. This cannot be undone.`,
      { title: `Remove the output “${output.name}”?`, kind: "warning", okLabel: "Remove", cancelLabel: "Keep output" },
    )
  } catch {
    ok = false
  }
  if (!ok) return "kept"
  // Stop the transport first: close_broadcast_window only hides the window
  // while NDI is still running for that output.
  // If the sender did not stop, keep the output: removed, nothing could stop it any more.
  if ((await disableOutput(output)) === false) {
    toast.error(`${output.name} was not removed`, { description: "Its NDI sender did not stop. Try again, or restart Rhema Studio." })
    return "failed"
  }
  useBroadcastStore.getState().removeOutput(output.id)
  toast.success(`Removed ${output.name}`)
  return "removed"
}
