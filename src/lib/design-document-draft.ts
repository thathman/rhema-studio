import { ask } from "@tauri-apps/plugin-dialog"
import { useUnsavedStore } from "@/stores/unsaved-store"

/** True when the My Designs editor may close: nothing is dirty, or the operator agrees to discard it. */
export async function mayLeaveDesignDocumentDraft(): Promise<boolean> {
  const { designEditor: title, specialistDraft } = useUnsavedStore.getState()
  // A lower third, ticker, stage or countdown look edited and not saved (#411).
  if (!title && specialistDraft) {
    try {
      return await ask(`Your changes to ${specialistDraft} are not saved. Discard them?`, { title: "Discard design changes?", kind: "warning", okLabel: "Discard", cancelLabel: "Keep editing" })
    } catch {
      return false
    }
  }
  if (!title) return true
  try {
    return await ask(`Your changes to ‘${title}’ are not saved. Discard them?`, {
      title: "Discard design changes?",
      kind: "warning",
      okLabel: "Discard",
      cancelLabel: "Keep editing",
    })
  } catch {
    return false
  }
}
