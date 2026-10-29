import { useState } from "react"
import { Button } from "@/components/ui/button"
import { acceptPartialRecovery, dismissDurableRunNotice, dismissRecovery, dismissRecoveryDamage, putBack, useRecovery } from "@/lib/live-recovery"
import { useShellStore } from "@/studio/shell-store"

/** After Rhema closed unexpectedly: offer to put back what was on the screens (never on its own). "Not now" leaves it in the Desk menu. */
export function RecoveryBanner() {
  const offer = useRecovery((s) => s.offer)
  const dismissed = useRecovery((s) => s.dismissed)
  const damaged = useRecovery((s) => s.damaged)
  const restoreError = useRecovery((s) => s.restoreError)
  const durableRuns = useRecovery((s) => s.durableRuns)
  const durableRunsDismissed = useRecovery((s) => s.durableRunsDismissed)
  const [busy, setBusy] = useState(false)
  const durableNotice = durableRuns.length > 0 && !durableRunsDismissed ? (
    <div role="status" className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/40 px-4 py-2 text-sm">
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Saved service activity is available in History.</span>{" "}
        <span className="text-muted-foreground">
          {durableRuns.length === 1 ? `“${durableRuns[0].title}” has a saved checkpoint.` : `${durableRuns.length} unfinished service runs have saved checkpoints.`} Time after the last confirmed checkpoint is unknown. Nothing was restored to the screens.
        </span>
      </p>
      <Button size="sm" onClick={() => { useShellStore.getState().goTo("archive"); dismissDurableRunNotice() }}>Open History</Button>
      <Button size="sm" variant="ghost" onClick={dismissDurableRunNotice}>Dismiss</Button>
    </div>
  ) : null
  if (damaged) {
    return (
      <>
        <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm">
          <p className="min-w-0 flex-1">{durableRuns.length ? "Local recovery data could not be read. A durable service checkpoint remains available in History." : "Saved recovery data could not be read. Nothing was restored."}</p>
          <Button size="sm" variant="ghost" onClick={dismissRecoveryDamage}>Dismiss</Button>
        </div>
        {durableNotice}
      </>
    )
  }
  if (!offer || dismissed) return durableNotice
  const at = new Date(offer.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  const what = [offer.isLive && offer.liveVerse ? offer.liveVerse.reference || "a slide" : null, offer.outputsOn.length ? `${offer.outputsOn.length} output${offer.outputsOn.length === 1 ? "" : "s"} on` : null].filter(Boolean).join(" · ")
  return (
    <>
      {durableNotice}
      <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-on-air/40 bg-on-air/10 px-4 py-2 text-sm">
        <p className="min-w-0 flex-1">
          <span className="font-semibold">Rhema Studio closed unexpectedly at {at}{offer.service ? ` during ${offer.service.title}` : ""}.</span>{" "}
          <span className="text-muted-foreground">On the screens then: {what || "nothing"}. {restoreError ? "The recovery attempt is incomplete; some service state may already be back." : "Nothing goes back until you choose."}</span>
          {restoreError && <span className="block font-medium text-destructive">{restoreError}</span>}
        </p>
        <Button size="sm" disabled={busy} onClick={() => { setBusy(true); void putBack(offer).finally(() => setBusy(false)) }}>Put back on the screens</Button>
        {restoreError && <Button size="sm" variant="outline" disabled={busy} onClick={acceptPartialRecovery}>Continue with available state</Button>}
        <Button size="sm" variant="ghost" title="The Desk menu keeps this until Rhema Studio closes" onClick={dismissRecovery}>Not now</Button>
      </div>
    </>
  )
}
