import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useApprovalGateStore } from "@/stores/approval-gate-store"

/** CL-002: the first go-live of a service that is not approved as it stands waits for the operator. */
export function ApprovalHoldDialog() {
  const held = useApprovalGateStore((s) => s.held)
  const { presentAnyway, dismiss } = useApprovalGateStore.getState()
  return (
    <Dialog open={held !== null} onOpenChange={(o) => { if (!o) dismiss() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>This service is not approved</DialogTitle>
          <DialogDescription>
            "{held?.title}" has not been approved, or was changed after it was approved. Nothing has gone on screen.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Present anyway goes live now, and this service is not asked about again in this session. To stop asking, approve the service in Prepare or turn off
          "Ask before showing an unapproved service" in Team.
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={dismiss}>Not now</Button>
          <Button onClick={presentAnyway}>Present anyway</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
