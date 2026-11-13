import { Button } from "@/components/ui/button"
import { useRecovery } from "@/lib/live-recovery"
import { useShellStore } from "@/studio/shell-store"

/**
 * Attention lines that were set aside (UX audit §5.6: the tray keeps what was dismissed). Showing one again
 * brings back its full line, so putting the screens back still goes through that line's own choice.
 */
export function SetAsideNotices() {
  const offer = useRecovery((s) => s.offer)
  const dismissed = useRecovery((s) => s.dismissed)
  const durableRuns = useRecovery((s) => s.durableRuns)
  const durableDismissed = useRecovery((s) => s.durableRunsDismissed)
  const recovery = offer && dismissed
  const durable = durableRuns.length > 0 && durableDismissed
  if (!recovery && !durable) return null
  return (
    <section aria-label="Set aside" className="mb-3 flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-2 text-xs">
      <p className="font-semibold">Set aside</p>
      {recovery && (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1">What was on the screens at {new Date(offer.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}, before Rhema Studio closed, can still be put back.</span>
          <Button size="xs" variant="outline" onClick={() => useRecovery.setState({ dismissed: false })}>Show again</Button>
        </div>
      )}
      {durable && (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1">{durableRuns.length === 1 ? `“${durableRuns[0].title}” has` : `${durableRuns.length} service runs have`} a saved checkpoint in History.</span>
          <Button size="xs" variant="outline" onClick={() => useShellStore.getState().goTo("archive")}>Open History</Button>
        </div>
      )}
    </section>
  )
}
