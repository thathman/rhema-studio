import { useState } from "react"
import { PaletteIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { hostLookOffer, mergeHostLook, type ChurchLook } from "@/lib/church-look"
import { themeIdsOf } from "@/lib/output-themes"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"

/**
 * On a joined desk (#298 E4, M12, scenario G): the host's church look changed, offered once per
 * change. Nothing changes until the operator presses Use it and confirms; then only this desk's
 * Brand Kit and the themes made from it take the host's. Its own name, computer, screens and keys
 * stay. Not now puts this revision aside.
 */
export function HostLookOffer({ look, church }: { look: ChurchLook | undefined; church: string }) {
  const kit = useSettingsStore((s) => s.brandKit)
  const seen = useSettingsStore((s) => s.hostLookSeen)
  const themes = useBroadcastStore((s) => s.themes)
  const onAir = useBroadcastStore((s) => s.isLive && !!s.liveVerse)
  const [confirming, setConfirming] = useState(false)
  const offer = hostLookOffer(look, kit, themes, seen)
  if (!offer) return null
  const name = offer.kit.churchName.trim() || church || "the host"
  const count = offer.themes.length
  const use = () => {
    const b = useBroadcastStore.getState()
    const s = useSettingsStore.getState()
    const merged = mergeHostLook(offer, s.brandKit, b.themes, new Set(b.outputs.flatMap(themeIdsOf)))
    s.setBrandKit(merged.kit)
    useBroadcastStore.setState({ themes: merged.themes })
    s.setHostLookSeen(offer.revision)
    setConfirming(false)
    toast.success("Using the host's church look", { description: offer.logoLeftOut ? "The logo here stays as it was: the host's is too large to send. Copy it with a backup." : undefined })
  }
  return (
    <section role="region" aria-label="The host's church look" className="flex flex-col gap-2 rounded-md border border-border bg-card px-2.5 py-2">
      <p className="flex items-center gap-2 font-semibold"><PaletteIcon aria-hidden className="size-4 text-primary-text" /> The host's church look changed</p>
      <p className="text-muted-foreground">
        {name}'s Brand Kit (colours, fonts{offer.logoLeftOut ? "" : ", logo"}) and the {count === 1 ? "theme" : `${count} themes`} made from it. This computer's own name, screens and settings stay as they are.
      </p>
      {!confirming ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setConfirming(true)}>Use it</Button>
          <Button size="sm" variant="ghost" onClick={() => useSettingsStore.getState().setHostLookSeen(offer.revision)}>Not now</Button>
        </div>
      ) : (
        <div role="group" aria-label="Use the host's church look?" className="flex flex-col gap-2 rounded-md bg-muted px-2.5 py-2">
          <p>Replace this computer's Brand Kit and the themes made from it with the host's? Themes edited by hand here, and every other look, stay. Screens on this computer that show these themes change too.</p>
          {onAir && <p role="alert" className="font-medium text-confidence-mid">Something is on air on this computer. Clear its screens first.</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Keep this computer's</Button>
            <Button size="sm" disabled={onAir} onClick={use}>Use the host's look</Button>
          </div>
        </div>
      )}
    </section>
  )
}
