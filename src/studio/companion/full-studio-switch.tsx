import { useState } from "react"
import { LaptopIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { switchMode } from "@/stores/companion-mode"

/** Rhema's OBS companion mode (#209): the way back to the full studio, asked once more first. */
export function FullStudioSwitch() {
  const [asking, setAsking] = useState(false)
  return asking ? (
    <div role="group" aria-label="Open the full studio" className="flex max-w-[320px] flex-col gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs">
      <p>Use this computer as the full Rhema Studio again? Rhema Studio starts again; the cameras stay in OBS.</p>
      <div className="flex gap-1.5">
        <Button size="xs" onClick={() => void switchMode(false)}>Start the full studio</Button>
        <Button size="xs" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
      </div>
    </div>
  ) : (
    <Button size="sm" variant="outline" onClick={() => setAsking(true)}><LaptopIcon /> Open the full studio…</Button>
  )
}
