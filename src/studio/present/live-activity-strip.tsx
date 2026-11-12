import { CircleAlertIcon, ShieldCheckIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useApprovalRequestsStore } from "@/studio/permissions/approval-requests-store"
import { useJoin } from "@/stores/join-store"
import { useShellStore } from "@/studio/shell-store"
import { HostNotices } from "@/studio/shell/host-notices"
import { LiveCrewStatus } from "@/studio/present/live-crew-status"

/** One compact Live entry point for current crew, host requests and private Comms. */
export function LiveActivityStrip() {
  const joinStatus = useJoin((state) => state.status)
  const hydrated = useApprovalRequestsStore((state) => state.hydrated)
  const error = useApprovalRequestsStore((state) => state.error)
  const pending = useApprovalRequestsStore(
    (state) =>
      state.requests.filter((request) => request.state === "submitted").length
  )
  const showUnavailable = joinStatus === "off" && hydrated && !!error
  const showPending = joinStatus === "off" && hydrated && !error && pending > 0

  return (
    <div
      role="group"
      aria-label="Live team activity"
      data-testid="live-activity-strip"
      className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1"
    >
      <LiveCrewStatus />
      {showUnavailable && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          data-testid="live-approval-status"
          aria-label="Open Permissions because approval status is unavailable"
          title="The main computer's approval request status could not be loaded. Open Permissions to retry; the pending count is unknown."
          onClick={() => useShellStore.getState().goTo("permissions")}
        >
          <CircleAlertIcon /> Requests unavailable
        </Button>
      )}
      {showPending && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          data-testid="live-approval-status"
          aria-label={`Open ${pending} pending approval ${pending === 1 ? "request" : "requests"} in Permissions`}
          title={`${pending} request${pending === 1 ? "" : "s"} recorded on the main computer await review. Open Permissions to inspect the exact requests.`}
          onClick={() => useShellStore.getState().goTo("permissions")}
        >
          <ShieldCheckIcon /> Requests{" "}
          <span className="tabular-nums">{pending}</span>
        </Button>
      )}
      <span className="ml-auto">
        <HostNotices compact />
      </span>
    </div>
  )
}
