import type { TakeAttemptOutcome, TakeAttemptStatus } from "@/stores/take-attempt-store"

export interface TakeAttemptNoticeEntry {
  id: number
  reference: string
  status: TakeAttemptStatus
  outcome?: TakeAttemptOutcome
  by?: string
  error?: string
}

const LABEL: Record<TakeAttemptStatus, string> = {
  pending: "Take pending",
  awaiting_approval: "Take waiting for approval",
  succeeded: "Take succeeded",
  failed: "Take failed",
  superseded: "Take superseded",
}

const STYLE: Record<TakeAttemptStatus, string> = {
  pending: "border-primary/30 bg-primary/5 text-foreground",
  awaiting_approval: "border-confidence-mid/40 bg-confidence-mid/10 text-foreground",
  succeeded: "border-confidence-high/40 bg-confidence-high/10 text-foreground",
  failed: "border-destructive/40 bg-destructive/5 text-foreground",
  superseded: "border-border bg-muted text-muted-foreground",
}

/** A Take result is deliberately shown beside, not in place of, the actual program and event-clock state. */
export function TakeAttemptNotice({ attempts }: { attempts?: readonly TakeAttemptNoticeEntry[] }) {
  const latest = attempts?.at(-1)
  if (!latest) return null
  const reason = latest.error ?? (latest.status === "failed" && latest.outcome ? ` · ${latest.outcome.replaceAll("_", " ")}` : "")
  return (
    <p role="status" aria-live="polite" aria-atomic="true" data-take-status={latest.status} className={`rounded-md border px-2.5 py-1.5 text-xs ${STYLE[latest.status]}`}>
      <span className="font-semibold">{LABEL[latest.status]}:</span> {latest.reference}{reason}{latest.by ? ` · by ${latest.by}` : ""}
    </p>
  )
}
