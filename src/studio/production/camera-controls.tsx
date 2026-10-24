import { PauseIcon, PlayIcon, RefreshCwIcon, ShuffleIcon, Undo2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cameraSourceId } from "@/lib/live-sources"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore, type CameraSource } from "@/stores/settings-store"



/**
 * A camera's recovery controls (#213 P0), on every screen whose scene has it: Retry (each screen and
 * TV connects to it again), Switch to backup (its backup camera plays in its places; chosen here),
 * and Freeze (the screens hold its last frame). Not in rehearsal: the real screens are not the app's then.
 */
export function CameraControls({ cam, chooseBackup = false }: { cam: CameraSource; chooseBackup?: boolean }) {
  const cameras = useSettingsStore((s) => s.cameras)
  const ctl = useBroadcastStore((s) => s.stateSources[cameraSourceId(cam.name)])
  const rehearsal = useBroadcastStore((s) => s.rehearsal)
  const control = useBroadcastStore((s) => s.cameraControl)
  const backup = cameras.find((c) => c.name === cam.backup && c.name !== cam.name)
  const onBackup = !!ctl?.backup && !!backup
  const why = rehearsal ? "Rehearsal is on: the real screens are not changed" : undefined
  const setBackup = (name: string) => useSettingsStore.getState().setCameras(useSettingsStore.getState().cameras.map((c) => (c.name === cam.name ? { ...c, backup: name || undefined } : c)))
  return (
    <div role="group" aria-label={`${cam.label} camera controls`} className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={rehearsal} title={why ?? "Every screen and TV playing it connects to it again"} onClick={() => control(cam.name, "retry")} aria-label={`Retry ${cam.label}`}>
        <RefreshCwIcon /> Retry
      </Button>
      {onBackup ? (
        <Button size="sm" variant="default" disabled={rehearsal} title={why ?? `Its scenes play ${cam.label} again`} onClick={() => control(cam.name, "unbackup")} aria-label={`Back to ${cam.label}`}>
          <Undo2Icon /> Back to {cam.label}
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled={rehearsal || !backup} title={why ?? (backup ? `Its scenes play ${backup.label} in its places until you switch back` : "Choose a backup camera first")} onClick={() => control(cam.name, "backup")} aria-label={`Switch ${cam.label} to its backup`}>
          <ShuffleIcon /> Switch to backup{backup ? ` (${backup.label})` : ""}
        </Button>
      )}
      {ctl?.hold ? (
        <Button size="sm" variant="default" disabled={rehearsal} title={why ?? "The screens show it live again"} onClick={() => control(cam.name, "unfreeze")} aria-label={`Unfreeze ${cam.label}`}>
          <PlayIcon /> Unfreeze
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled={rehearsal} title={why ?? "The screens hold its last frame (the picture stops moving) until you unfreeze it"} onClick={() => control(cam.name, "freeze")} aria-label={`Freeze ${cam.label}`}>
          <PauseIcon /> Freeze
        </Button>
      )}
      {chooseBackup && (
        <label className="flex items-center gap-1.5 text-muted-foreground">
          Backup camera
          <select aria-label={`Backup camera for ${cam.label}`} value={backup?.name ?? ""} onChange={(e) => setBackup(e.target.value)} className="h-8 rounded-md border border-input bg-card px-2 text-foreground">
            <option value="">None</option>
            {cameras.filter((c) => c.name !== cam.name).map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
          </select>
        </label>
      )}
    </div>
  )
}
