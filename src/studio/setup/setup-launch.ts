import { create } from "zustand"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { newDeviceId, shouldAutoOpenSetup, type InstallFacts } from "@/lib/setup-readiness"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useShellStore } from "@/studio/shell-store"

/**
 * The first-launch decision, made once per session after settings, themes and the
 * saved services have loaded. The first-run tour waits for it, and does not start
 * by itself when the setup opened (the setup's Finish offers the tour instead).
 */
export const useSetupLaunch = create<{ checked: boolean; autoOpened: boolean }>(() => ({ checked: false, autoOpened: false }))

/** What this computer already holds, from the loaded stores. */
export function installFacts(): InstallFacts {
  const s = useSettingsStore.getState()
  const b = useBroadcastStore.getState()
  return {
    churchName: s.brandKit.churchName,
    operatorName: s.operatorName,
    onboardingComplete: s.onboardingComplete,
    savedServices: useServiceStore.getState().programs.length,
    customThemes: b.themes.filter((t) => !t.builtin).length,
    outputs: b.outputs.map((o) => ({ id: o.id, name: o.name, type: o.type, role: o.role, themeId: o.themeId })),
    defaultThemeId: BUILTIN_THEMES[0].id,
    pairedDevices: s.remoteDevices.length,
    joinAddress: s.joinAddress,
    churchFolder: s.churchFolder,
  }
}

/**
 * Open the setup by itself on a genuinely new install, once. `servicesKnown` is false
 * when the saved services could not be read: then nothing is assumed to be empty.
 */
export function decideSetupLaunch(servicesKnown: boolean): void {
  if (useSetupLaunch.getState().checked) return
  ensureDeviceId()
  const open = servicesKnown && shouldAutoOpenSetup(installFacts(), useSettingsStore.getState().setup)
  useSetupLaunch.setState({ checked: true, autoOpened: open })
  if (open) useShellStore.getState().setSetupOpen(true)
}

/**
 * This install's id (#298 M3): made once, at the first start after settings have loaded, and saved
 * with them. Reading the settings never writes them; this is the one deliberate change, and only
 * when an older file has no id yet.
 */
export function ensureDeviceId(): string {
  const s = useSettingsStore.getState()
  if (s.setup.deviceId) return s.setup.deviceId
  const id = newDeviceId()
  s.setSetup({ deviceId: id })
  return id
}
