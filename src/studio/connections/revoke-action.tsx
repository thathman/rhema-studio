import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Revoke, in two steps (#445, #801): a stray click never cuts a screen or a desk mid-service.
 * What it does is said first: the device's own key stops at once; everything else carries on.
 * Connections and Permissions both use this one, so revoking feels the same wherever it is done.
 *
 * Keyboard and screen readers: opening it moves focus to "Revoke now", Keep puts focus back on
 * "Revoke", and the explanation is read out from a live region that is always there (empty until
 * the confirm opens), so the change is announced.
 */
export function RevokeAction({ label, what, onRevoke }: { label: string; what: string; onRevoke: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const revokeButton = useRef<HTMLButtonElement>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const backToRevoke = useRef(false)

  useEffect(() => {
    if (confirm) {
      confirmButton.current?.focus()
      return
    }
    if (backToRevoke.current) {
      backToRevoke.current = false
      revokeButton.current?.focus()
    }
  }, [confirm])

  return (
    <span className={confirm ? "flex basis-full flex-wrap items-center justify-end gap-1" : "contents"}>
      <span role="status" className={cn(confirm ? "mr-auto text-xs text-muted-foreground" : "sr-only")}>{confirm ? what : ""}</span>
      {confirm ? (
        <>
          <Button ref={confirmButton} size="sm" variant="destructive" onClick={() => { setConfirm(false); onRevoke() }} aria-label={`Confirm revoke ${label}`}>Revoke now</Button>
          <Button size="sm" variant="ghost" onClick={() => { backToRevoke.current = true; setConfirm(false) }} aria-label={`Keep ${label}`}>Keep</Button>
        </>
      ) : (
        <Button ref={revokeButton} size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirm(true)} aria-label={`Revoke ${label}`} title={what}>Revoke</Button>
      )}
    </span>
  )
}
