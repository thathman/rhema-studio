import { useState } from "react"
import { toast } from "sonner"
import { ChevronDownIcon, PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useBroadcastStore } from "@/stores"
import { useShellStore } from "@/studio/shell-store"
import { existingFeed, FEED_PRESETS, readyMadeFeed, type FeedPreset, type FeedTransport } from "@/lib/feed-presets"

/**
 * Live → Production tools → Screens: add a ready-made feed (Rhema Bible | Full, Rhema Ticker | Alpha, Rhema
 * Clock…). Each click adds one new output, off (the clock feed with its scene); nothing existing
 * changes and nothing goes on air.
 */
export function ReadyMadeFeeds() {
  const outputs = useBroadcastStore((s) => s.outputs)
  const [transport, setTransport] = useState<FeedTransport>("ndi")

  const add = (preset: FeedPreset) => {
    const s = useBroadcastStore.getState()
    const result = readyMadeFeed(preset, transport, s.outputs, s.themes, undefined, s.scenes)
    if ("taken" in result) {
      toast(`“${preset.name}” is already set up`, { description: `The output “${result.taken.name}” has that name, so another one was not added. Edit that one instead.`, action: { label: "Edit it", onClick: () => useShellStore.getState().editOutput(result.taken.id) } })
      return
    }
    // The clock feed's own scene first, so the output has it from the start.
    if (result.scene) s.saveScene(result.scene)
    s.addOutput(result.output)
    toast(`Added “${preset.name}”, off`, {
      description: `${transport === "ndi" ? "An NDI source" : "A browser feed"} for OBS. Turn it on in Outputs when you need it; nothing else changed.`,
      action: { label: "Edit it", onClick: () => useShellStore.getState().editOutput(result.output.id) },
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline"><PlusIcon /> Add a ready-made feed <ChevronDownIcon /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="text-[0.6875rem]">Send as</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={transport} onValueChange={(v) => setTransport(v as FeedTransport)}>
          {/* Choosing how to send keeps the menu open, to pick a feed next. */}
          <DropdownMenuRadioItem value="ndi" onSelect={(e) => e.preventDefault()}>NDI (OBS, vMix, another computer)</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="browser" onSelect={(e) => e.preventDefault()}>Browser feed (OBS Browser source)</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[0.6875rem]">Feeds (each starts off)</DropdownMenuLabel>
        {FEED_PRESETS.map((p) => {
          const taken = existingFeed(p, outputs)
          return (
            <DropdownMenuItem key={p.id} onSelect={() => add(p)} className="flex-col items-start gap-0.5">
              <span className="font-semibold">{p.name}</span>
              <span className="text-[0.6875rem] text-muted-foreground">{taken ? `Already set up as “${taken.name}”` : p.description}</span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
