import { churchSetup, equipment, type ChurchSetup, type EquipmentItem } from "@/lib/setup-readiness"
import { outputOnAir } from "@/lib/output-on-air"
import { useFeedHealthStore } from "@/lib/show-health"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useJoin } from "@/stores/join-store"
import { useObsStore } from "@/stores/obs-store"
import { useSettingsStore } from "@/stores/settings-store"

/** Church setup and equipment as they are now (#298), for the setup's Finish step and Home's card. */
export function useSetupStatus(): { church: ChurchSetup; equipment: { items: EquipmentItem[]; notUsing: string[]; attention: number } } {
  const s = useSettingsStore()
  const translations = useBibleStore((b) => b.translations)
  const themes = useBroadcastStore((b) => b.themes)
  const outputs = useBroadcastStore((b) => b.outputs)
  const outputStatus = useBroadcastStore((b) => b.outputStatus)
  const feeds = useFeedHealthStore()
  const obsStatus = useObsStore((o) => o.status)
  const obsError = useObsStore((o) => o.error)
  const joinStatus = useJoin((j) => j.status)
  return {
    church: churchSetup({
      churchName: s.brandKit.churchName,
      operatorName: s.operatorName,
      // The list loads at startup; empty means not looked up yet (Home's service check reports a Bible that fails to load).
      translations: translations.length ? translations : null,
      settingsSaveFailed: s.settingsSaveFailed,
      logoUrl: s.brandKit.logoUrl,
      brandApplied: themes.some((t) => t.brandManaged),
      churchFolder: s.churchFolder,
      campus: s.setup.campus,
      serviceLanguages: s.setup.serviceLanguages,
      deviceName: s.setup.deviceName,
    }),
    equipment: equipment({
      outputs: outputs.map((o) => ({
        id: o.id,
        name: o.name,
        type: o.type,
        on: outputOnAir(o, outputStatus[o.id]),
        ndiError: outputStatus[o.id]?.ndiError ?? null,
        receivers: outputStatus[o.id]?.ndiReceivers ?? null,
        feed: feeds[o.id] ?? null,
      })),
      obs: { enabled: s.obs.enabled, status: obsStatus, error: obsError },
      // Only whether a key exists: the key itself never leaves the settings store.
      speech: { provider: s.sttProvider, keySaved: !!s.deepgramApiKey?.trim(), consentGiven: !!s.cloudSpeechConsentAt },
      mcpEnabled: s.mcpEnabled,
      join: { address: s.joinAddress, status: joinStatus },
      pairedDevices: s.remoteDevices.length,
    }),
  }
}
