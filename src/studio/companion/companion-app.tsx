import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Toaster, toast } from "sonner"
import { ErrorBoundary } from "@/components/error-boundary"
import { useJoin } from "@/stores/join-store"
import { useSettingsStore } from "@/stores/settings-store"
import { CompanionScreen } from "@/studio/companion/companion-screen"
import { trayName } from "@/lib/companion-app"

/**
 * Rhema Studio Companion (#209), the small app for a computer that runs OBS only: the companion screen,
 * joined only over the host's secure page, and this app's own choices. It joins its host again by
 * itself when it starts, since it may start with the computer with nobody at it.
 */
export function CompanionApp() {
  useEffect(() => {
    const { joinAddress, joinToken } = useSettingsStore.getState()
    if (joinAddress && joinToken && useJoin.getState().status === "off") void useJoin.getState().connect()
  }, [])
  return (
    <>
      <ErrorBoundary name="Rhema Studio Companion">
        <CompanionScreen secure>
          <ThisApp />
        </CompanionScreen>
      </ErrorBoundary>
      <Toaster position="bottom-center" />
    </>
  )
}

function ThisApp() {
  const [start, setStart] = useState<boolean | null>(null)
  const [version, setVersion] = useState("")
  useEffect(() => {
    invoke<boolean>("autostart_get").then((on) => setStart(on === true), () => setStart(null))
    invoke<string>("companion_version").then((v) => setVersion(typeof v === "string" ? v : ""), () => {})
  }, [])
  const change = (on: boolean) =>
    invoke<boolean>("autostart_set", { on }).then(
      (now) => setStart(now === true),
      (e) => toast.error("Not changed", { description: String(e) }),
    )
  return (
    <section aria-label="This app" className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-xs">
      <label className="flex items-center gap-2 font-medium">
        <input type="checkbox" checked={start === true} disabled={start === null} onChange={(e) => void change(e.target.checked)} />
        Start Rhema Studio Companion with the computer
      </label>
      <p className="text-muted-foreground">
        It then waits in {trayName()} and joins the host by itself. Closing this window keeps it running there, so OBS's cameras stay current; quit it from its icon.
      </p>
      {version && <p className="text-muted-foreground">Rhema Studio Companion {version}</p>}
    </section>
  )
}
