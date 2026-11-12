import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { ShieldAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { openSettings } from "@/lib/settings-dialog"
import { isOpenMode, OPEN_MODE_POLL_MS, type AuthStatus, type ListenerStatus } from "@/studio/present/open-mode"

/**
 * A standing warning in Live's header while open mode lasts. It cannot be dismissed: it goes away
 * only when keys are turned on or the LAN listeners stop. Its button opens Settings → Remote control.
 */
export function OpenModeWarning() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      const [http, osc, auth] = await Promise.all([
        invoke<ListenerStatus>("get_http_status").catch(() => null),
        invoke<ListenerStatus>("get_osc_status").catch(() => null),
        invoke<AuthStatus>("get_remote_auth_status").catch(() => null),
      ])
      if (cancelled) return
      // A failed read never hides the warning: with all three known, the host decides; with one
      // missing, keys off with a listener known to be on the LAN is still open mode, and anything
      // else keeps the last known state.
      if (http && osc && auth) setOpen(isOpenMode(http, osc, auth))
      else if (isOpenMode(http, osc, auth)) setOpen(true)
    }
    void poll()
    const interval = setInterval(() => void poll(), OPEN_MODE_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  if (!open) return null
  return (
    <div
      role="alert"
      data-testid="open-mode-warning"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-confidence-mid/50 bg-confidence-mid/10 px-3 py-2 text-xs"
    >
      <ShieldAlertIcon aria-hidden className="size-4 shrink-0 text-confidence-mid" />
      <p className="min-w-0 flex-1">
        <span className="font-bold text-confidence-mid">Remote keys are off on the network.</span>{" "}
        Any device on this network can control Rhema Studio, settings included, until keys are turned on or the network listener is stopped.
      </p>
      <Button size="xs" variant="outline" onClick={() => openSettings("remote")}>Open Remote Control settings</Button>
    </div>
  )
}
