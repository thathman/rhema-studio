import { useState } from "react"
import { TriangleAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

const RISK_PHRASE = "ALLOW UNAUTHENTICATED LAN CONTROL"

interface RemoteAuthSettingProps {
  required: boolean
  /** A shared key or paired device keeps authentication required. */
  locked: boolean
  onRequiredChange: (required: boolean) => void
}

/** Deliberate, typed risk acceptance before the legacy open-LAN setting can be turned off. */
export function RemoteAuthSetting({ required, locked, onRequiredChange }: RemoteAuthSettingProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [phrase, setPhrase] = useState("")

  const closeConfirmation = () => {
    setConfirmOpen(false)
    setPhrase("")
  }
  const change = (next: boolean) => {
    if (locked) return
    if (next) {
      onRequiredChange(true)
      return
    }
    setPhrase("")
    setConfirmOpen(true)
  }
  const confirm = () => {
    if (!required || locked || phrase !== RISK_PHRASE) return
    onRequiredChange(false)
    closeConfirmation()
  }

  return (
    <>
      <label className="flex items-start gap-2 text-xs">
        <input
          aria-label="Require a key or a paired device"
          type="checkbox"
          className="mt-0.5"
          checked={required || locked}
          disabled={locked}
          onChange={(event) => change(event.target.checked)}
        />
        <span>
          Require a key or a paired device
          <span className="block text-xs text-muted-foreground">
            {locked
              ? "On while a key is set or a device is paired. Removing the last one keeps it on: nothing is accepted until you deliberately turn this off."
              : required
                ? "On: only a paired device or the shared key can send remote commands. With none configured, remote commands are refused. Turning this off requires typing a risk phrase."
                : "Off: commands from devices on local/private networks do not need a key or pairing. Public-source commands are refused. This saved setting is preserved from an earlier setup. Turn it on to require a paired device or the shared key."}
          </span>
        </span>
      </label>

      <Dialog open={confirmOpen} onOpenChange={(open) => { if (!open) closeConfirmation() }}>
        <DialogContent showCloseButton={false} className="border-destructive/50 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <TriangleAlertIcon aria-hidden className="size-5 shrink-0" />
              Allow unauthenticated LAN commands?
            </DialogTitle>
            <DialogDescription>
              Turning this off lets ANY device on a local/private network that can reach a LAN listener send remote commands without a key or pairing. That can include commands to change or take the live display. Public-source commands, pairing, status, and health requests are refused. VPN peers using private or link-local source addresses are treated as local; keep authentication on for routed peers you do not fully trust. The server checks the immediate peer address and ignores forwarded-client headers; do not expose it through an Internet-facing proxy or tunnel. Rhema has no Internet relay.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
            <p className="font-semibold">To accept this risk, type exactly:</p>
            <p className="mt-1 select-all font-mono font-bold tracking-wide">{RISK_PHRASE}</p>
          </div>
          <Input
            aria-label={`Type ${RISK_PHRASE}`}
            autoComplete="off"
            spellCheck={false}
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
          />
          <DialogFooter>
            <Button aria-label="Cancel risk confirmation" variant="outline" onClick={closeConfirmation}>Cancel</Button>
            <Button aria-label="Allow unauthenticated LAN control" variant="destructive" disabled={phrase !== RISK_PHRASE || !required || locked} onClick={confirm}>
              Turn off authentication
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
