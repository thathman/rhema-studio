import { useState } from "react"
import { Button } from "@/components/ui/button"
import { dismissRecovery, putBack, useRecovery } from "@/lib/live-recovery"

/** After Rhema closed unexpectedly: offer to put back what was on the screens (never on its own). "Not now" leaves it in the Desk menu. */
export function RecoveryBanner() {
  const offer = useRecovery((s) => s.offer)
  const dismissed = useRecovery((s) => s.dismissed)
  const [busy, setBusy] = useState(false)
  if (!offer || dismissed) return null
  const at = new Date(offer.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  const what = [offer.isLive && offer.liveVerse ? offer.liveVerse.reference || "a slide" : null, offer.outputsOn.length ? `${offer.outputsOn.length} output${offer.outputsOn.length === 1 ? "" : "s"} on` : null].filter(Boolean).join(" · ")
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-on-air/40 bg-on-air/10 px-4 py-2 text-sm">
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Rhema closed unexpectedly at {at}{offer.service ? ` during ${offer.service.title}` : ""}.</span>{" "}
        <span className="text-muted-foreground">On the screens then: {what || "nothing"}. Nothing goes back until you choose.</span>
      </p>
      <Button size="sm" disabled={busy} onClick={() => { setBusy(true); void putBack(offer).finally(() => setBusy(false)) }}>Put back on the screens</Button>
      <Button size="sm" variant="ghost" title="The Desk menu keeps this until Rhema closes" onClick={dismissRecovery}>Not now</Button>
    </div>
  )
}
