import { useState } from "react"
import { Button } from "@/components/ui/button"

/**
 * Revoke, in two steps (#445, #801): a stray click never cuts a screen or a desk mid-service.
 * What it does is said first: the device's own key stops at once; everything else carries on.
 * Connections and Permissions both use this one, so revoking feels the same wherever it is done.
 */
export function RevokeAction({ label, what, onRevoke }: { label: string; what: string; onRevoke: () => void }) {
  const [confirm, setConfirm] = useState(false)
  return confirm ? (
    <span className="flex basis-full flex-wrap items-center justify-end gap-1">
      <span role="status" className="mr-auto text-xs text-muted-foreground">{what}</span>
      <Button size="sm" variant="destructive" onClick={() => { setConfirm(false); onRevoke() }} aria-label={`Confirm revoke ${label}`}>Revoke now</Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirm(false)} aria-label={`Keep ${label}`}>Keep</Button>
    </span>
  ) : (
    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirm(true)} aria-label={`Revoke ${label}`} title={what}>Revoke</Button>
  )
}
