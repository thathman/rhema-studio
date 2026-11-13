import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { useBroadcastStore } from "@/stores"
import { autoModeOf, type AutoMode } from "@/stores/broadcast-store"

/** Where heard verses go by themselves (Off by default, FR-01). Lives in Live tools → Listening (UX audit slice 4); the status bar shows an amber pill while it is on. */
export function AutoModeControl() {
  const autoMode = useBroadcastStore(autoModeOf)
  return (
    <label
      className={cn(
        // Amber while heard verses can reach screens without Take (UX audit S1c).
        "flex items-center gap-2 rounded-full px-2",
        autoMode !== "manual" && "border border-amber-500/50 bg-amber-500/10",
      )}
      title="Auto: On: while on air, a verse heard while listening goes live without Take source live (while a song, hymn or slide is up it goes only to the feeds that follow Bible). Bible feeds only: it goes to the feeds that follow Bible and never the main screens. Off (the default): heard verses wait in the preview."
    >
      <span className={cn("whitespace-nowrap text-xs font-medium transition-colors", autoMode !== "manual" ? "text-amber-600 dark:text-amber-300" : "text-muted-foreground")}>
        {autoMode === "manual" ? "Heard verses: wait" : "Heard verses go live"}
      </span>
      <Select value={autoMode} onValueChange={(v) => useBroadcastStore.getState().setAutoMode(v as AutoMode)}>
        <SelectTrigger size="sm" className="text-xs" aria-label="Auto: where heard verses go by themselves"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="manual">Off</SelectItem>
          <SelectItem value="bible">Bible feeds only</SelectItem>
          <SelectItem value="auto">On</SelectItem>
        </SelectContent>
      </Select>
    </label>
  )
}
