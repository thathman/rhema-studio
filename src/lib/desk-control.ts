import { useJournalStore } from "@/stores/journal-store"
import { useSettingsStore } from "@/stores/settings-store"

/**
 * Host authority (#243): the main desk takes back control from a joined desk, or gives it back,
 * without unpairing it. While paused the desk's commands are refused by the host; it still sees
 * the Live State and keeps the talk channel and notices. Each change goes in the service log.
 */
export async function setDeskControl(hash: string, takeBack: boolean): Promise<boolean> {
  const device = useSettingsStore.getState().remoteDevices.find((d) => d.hash === hash)
  if (!device) return false
  if ((device.paused === true) === takeBack) return true
  const applied = await useSettingsStore.getState().setRemoteDevicePaused(hash, takeBack)
  if (!applied) return false
  useJournalStore.getState().add({ kind: "remote", label: takeBack ? `Main desk took back control from ${device.name}` : `Main desk gave control back to ${device.name}` })
  return true
}
