import { useState } from "react"
import { ClipboardCheckIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { showReviewNotice, showSetupCard } from "@/lib/setup-readiness"
import { useSettingsStore } from "@/stores/settings-store"
import { useShellStore } from "@/studio/shell-store"
import { useSetupStatus } from "@/studio/setup/use-setup-status"
import { installFacts, useSetupLaunch } from "@/studio/setup/setup-launch"

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Home's "Finish church setup" card (#298): only while one of the four essentials is
 * missing (church name, operator, Bible, saving). Optional or unused features never
 * show it. Separate from "Your attention", which is about this service. An existing
 * install that never saw the setup gets the one-time "Review your setup" in its place.
 */
export function SetupCard() {
  const { church } = useSetupStatus()
  const setup = useSettingsStore((s) => s.setup)
  const setupOpen = useShellStore((s) => s.setupOpen)
  const [now] = useState(() => Date.now())
  // Known only once the saved services have loaded (as the first-launch decision).
  const launchChecked = useSetupLaunch((s) => s.checked)
  if (setupOpen) return null
  if (launchChecked && showReviewNotice(installFacts(), setup)) return <ReviewNotice />
  if (!showSetupCard(church.missing, setup, now)) return null
  const missing = church.essentials.filter((e) => e.state === "attention")
  return (
    <section aria-labelledby="setup-card" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-4 py-3 shadow-panel">
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"><ClipboardCheckIcon className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <h2 id="setup-card" className="text-sm font-semibold">Finish church setup · {missing.length} {missing.length === 1 ? "item" : "items"}</h2>
        <p className="truncate text-xs text-muted-foreground">{missing.map((e) => e.label).join(" · ")}. Everything else can wait.</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" onClick={() => useShellStore.getState().setSetupOpen(true)}>Continue setup</Button>
        <Button size="sm" variant="soft" onClick={() => useShellStore.getState().setSetupStatusOpen(true)}>Setup status</Button>
        <Button size="sm" variant="ghost" onClick={() => useSettingsStore.getState().setSetup({ remindAfter: new Date(Date.now() + DAY_MS).toISOString() })}>Remind me tomorrow</Button>
        <Button size="icon-sm" variant="ghost" aria-label="Hide this reminder" title="Hide this reminder (setup stays in the Desk menu)" onClick={() => useSettingsStore.getState().setSetup({ homeCardHidden: true })}><XIcon /></Button>
      </div>
    </section>
  )
}

/**
 * For an install that was in use before the setup existed (#298 M7): one invitation to look over
 * the setup, never opening it by itself. Review opens it at the summary; either choice ends it.
 */
function ReviewNotice() {
  const review = () => {
    useSettingsStore.getState().setSetup({ lastStep: "finish" })
    useShellStore.getState().setSetupOpen(true)
  }
  return (
    <section aria-labelledby="review-setup" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-4 py-3 shadow-panel">
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"><ClipboardCheckIcon className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <h2 id="review-setup" className="text-sm font-semibold">Review your setup</h2>
        <p className="text-xs text-muted-foreground">Rhema now has a short setup: this computer's name, sound, backups and a summary of what is set. Your services, songs and screens stay as they are.</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" onClick={review}>Review setup</Button>
        <Button size="sm" variant="ghost" onClick={() => useSettingsStore.getState().setSetup({ dismissedAt: new Date().toISOString() })}>Not now</Button>
      </div>
    </section>
  )
}
