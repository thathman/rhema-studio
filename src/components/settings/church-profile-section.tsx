import { ChurchStep, OperatorStep } from "@/studio/setup/setup-steps"
import { useSettingsDialogStore } from "@/lib/settings-dialog"
import { openConnectionsHub } from "@/studio/connections/navigation"

/**
 * Church and profile (#447): who the church is and who is at this desk, the same fields the
 * first-install setup fills in (#298), so a church can correct them later without running setup
 * again. Nothing here changes what is on the screens.
 */
export function ChurchProfileSection() {
  const joinAnother = () => {
    useSettingsDialogStore.getState().closeSettings()
    openConnectionsHub()
  }
  return (
    <div className="flex max-w-2xl flex-col gap-6 text-sm">
      <p className="text-xs text-muted-foreground">Saved on this computer and shared with computers that join it. Nothing here changes what is on the screens. Logo and colours are in Design → Brand kit.</p>
      <section aria-label="Church" className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Church</h3>
        <ChurchStep error={null} />
      </section>
      <section aria-label="You and this computer" className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">You and this computer</h3>
        <OperatorStep error={null} onJoin={joinAnother} />
      </section>
    </div>
  )
}
