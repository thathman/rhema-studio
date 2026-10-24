import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { flushSettingsSave, useSettingsStore } from "@/stores/settings-store"
import { unsavedScratch, useServiceStore } from "@/stores/service-store"
import { useQueueStore } from "@/stores/queue-store"
import { useUnsavedStore } from "@/stores/unsaved-store"
import { themeDraftChanged } from "@/stores/broadcast-store"

/**
 * Rhema as an OBS companion, or the full studio again (#209), on a computer with the full app. Kept
 * apart from the companion's working state so Rhema Companion, the small app, does not load the
 * studio's service, song and queue stores.
 */

/** Work that is not saved yet (the same as the close question asks about). */
function unsavedWork(): boolean {
  return useServiceStore.getState().dirty || useUnsavedStore.getState().songEditor !== null || unsavedScratch(useQueueStore.getState().items, useServiceStore.getState().current) || themeDraftChanged()
}

/**
 * Become an OBS companion, or the full studio again: saved, then Rhema starts again in that mode.
 * Refused, with nothing changed, while a service or song has unsaved changes.
 */
export async function switchMode(companion: boolean): Promise<boolean> {
  if (companion && unsavedWork()) {
    toast.error("Save your work first", { description: "A service, song or look here has changes that are not saved. Save or close it, then make this computer an OBS companion." })
    return false
  }
  useSettingsStore.getState().setCompanionMode(companion)
  if (companion) useSettingsStore.getState().setObs({ enabled: true })
  await flushSettingsSave()
  await invoke("app_restart").catch(() => {
    // A browser preview (no Tauri): the window shows the other mode by itself.
  })
  return true
}
