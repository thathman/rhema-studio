import { useSettingsDialogStore } from "@/lib/settings-dialog"
import { useShellStore } from "@/studio/shell-store"

/** Close advanced settings before opening the host-owned device access workspace. */
export function openPermissions(): void {
  useSettingsDialogStore.getState().closeSettings()
  useShellStore.getState().goTo("permissions")
}
