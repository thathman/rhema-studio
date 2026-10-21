import { ask } from "@tauri-apps/plugin-dialog"
import { themeDraftChanged } from "@/stores/broadcast-store"

/** True when the Designer may leave the theme being edited: nothing unsaved, or the operator agrees to discard it. */
export async function mayLeaveThemeDraft(): Promise<boolean> {
  if (!themeDraftChanged()) return true
  try {
    return await ask("Your changes to this theme are not saved. Discard them?", { title: "Discard theme changes?", kind: "warning", okLabel: "Discard", cancelLabel: "Keep editing" })
  } catch {
    return false
  }
}
