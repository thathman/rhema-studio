import { create } from "zustand"

type SettingsSection =
  | "screens"
  | "audio"
  | "speech"
  | "bible"
  | "display"
  | "remote"
  | "assistants"
  | "diagnostics"
  | "help"

/**
 * Sections that moved, by their old names, so an old link still lands in the right place:
 * Cloud keys only ever showed the Deepgram key, which is edited under Speech Recognition (#299).
 */
const MOVED = { "api-keys": "speech" } as const satisfies Record<string, SettingsSection>
type SettingsSectionLink = SettingsSection | keyof typeof MOVED

/** Where a section name (old or current) opens now. */
function settingsSectionFor(section: SettingsSectionLink): SettingsSection {
  return section in MOVED ? MOVED[section as keyof typeof MOVED] : (section as SettingsSection)
}

interface SettingsDialogState {
  isOpen: boolean
  activeSection: SettingsSection
  openSettings: (section?: SettingsSectionLink) => void
  closeSettings: () => void
  setActiveSection: (section: SettingsSectionLink) => void
}

const useSettingsDialogStore = create<SettingsDialogState>((set) => ({
  isOpen: false,
  activeSection: "audio",
  openSettings: (section) =>
    set((state) => ({
      isOpen: true,
      activeSection: section ? settingsSectionFor(section) : state.activeSection,
    })),
  closeSettings: () => set({ isOpen: false }),
  setActiveSection: (section) => set({ activeSection: settingsSectionFor(section) }),
}))

export function openSettings(section?: SettingsSectionLink) {
  useSettingsDialogStore.getState().openSettings(section)
}

export { useSettingsDialogStore, settingsSectionFor }
export type { SettingsSection, SettingsSectionLink }
