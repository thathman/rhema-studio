import { ask } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import { disableOutput } from "@/lib/broadcast-output-control"
import { outputOnAir } from "@/lib/output-on-air"
import { designDraftId } from "@/lib/design-drafts"
import { themeUsedBy } from "@/lib/look-library"
import { useBroadcastStore } from "@/stores"
import type { BroadcastOutput, BroadcastTheme } from "@/types"

// Deletes in Outputs and the theme library that cannot be undone are asked first (#831 S7).

/**
 * Delete a theme, asked first (#831 S7): it cannot be undone. Refused, with the outputs named,
 * while an output uses it or shows a scene with a layer in it (`themeUsedBy`, as Reset), so
 * nothing on air changes look; checked again after the answer. Scenes that use it but are not
 * shown are named in the question.
 */
export async function deleteThemeAsked(theme: BroadcastTheme): Promise<"deleted" | "kept" | "in-use"> {
  const refuse = (inUse: string[]) => {
    toast.error(`${theme.name} is used by ${inUse.join(", ")}`, { description: "Choose another look for those outputs, or take a scene that does not use it, first: Design → Where used opens each one." })
    return "in-use" as const
  }
  const usedBy = () => {
    const { outputs, scenes } = useBroadcastStore.getState()
    return themeUsedBy(theme.id, outputs, scenes)
  }
  const users = usedBy()
  if (users.length) return refuse(users)
  const { scenes, designDrafts, editingThemeId } = useBroadcastStore.getState()
  const inScenes = scenes.filter((scene) => scene.layers.some((layer) => layer.themeId === theme.id)).map((scene) => scene.name)
  const hasDraft = editingThemeId === theme.id || designDrafts.some((draft) => draft.id === designDraftId("theme", theme.id))
  const message = [
    `Delete the theme “${theme.name}”?`,
    inScenes.length ? `Scenes that use it (${inScenes.join(", ")}) will show in each output's own look.` : "",
    hasDraft ? "Its unsaved draft goes too." : "",
    "This cannot be undone.",
  ].filter(Boolean).join(" ")
  let ok = false
  try {
    ok = await ask(message, { title: "Delete theme?", kind: "warning", okLabel: "Delete", cancelLabel: "Keep theme" })
  } catch {
    ok = false
  }
  if (!ok) return "kept"
  // Checked again: an output or a shown scene may have taken it while the question was open.
  const now = usedBy()
  if (now.length) return refuse(now)
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
  // Read again: it may have been removed or edited while the question was open; then nothing is done.
  const current = useBroadcastStore.getState().outputs.find((o) => o.id === output.id)
  if (current !== output) {
    if (current) toast.info(`${output.name} changed while you were asked; it was not removed.`)
    return "kept"
  }
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
