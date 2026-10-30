import { ArrowRightIcon, BookOpenIcon, HouseIcon, ImageIcon, LibraryBigIcon, MonitorIcon, MusicIcon, PaletteIcon, PencilRulerIcon, PlayIcon, PlusIcon, PresentationIcon, SearchIcon, SettingsIcon, ArchiveIcon, MonitorCogIcon, UsersIcon, ShieldCheckIcon } from "lucide-react"
import { useState } from "react"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { useQueueStore } from "@/stores"
import { useShellStore, type DesignTab, type Workspace } from "@/studio/shell-store"
import { openSettings, type SettingsSection } from "@/lib/settings-dialog"
import { presentActions } from "@/studio/present-actions"
import { isImageItem, isSongItem, type QueueItem } from "@/types"
import { openProductionTab } from "@/studio/production/production-tab"

const PLACES: ReadonlyArray<readonly [Workspace, string, React.ReactNode, string]> = [
  ["home", "Home", <HouseIcon key="i" />, "overview readiness today"],
  ["prepare", "Prepare", <PencilRulerIcon key="i" />, "service builder rundown run of show plan edit history approve copy"],
  ["present", "Live", <PlayIcon key="i" />, "live console present show go live"],
  ["library", "Library", <LibraryBigIcon key="i" />, "songs hymns bible slides media files"],
  ["design", "Design", <PaletteIcon key="i" />, "themes looks studio"],
  ["permissions", "Permissions", <ShieldCheckIcon key="i" />, "paired devices roles access approval requests"],
  ["archive", "History", <ArchiveIcon key="i" />, "past services execution records logs"],
  ["team", "Team", <UsersIcon key="i" />, "team approvals comments church folder remote"],
]

const DESIGN: ReadonlyArray<readonly [DesignTab, string, string]> = [
  ["themes", "Themes", "bible songs hymns slides pictures fonts colours background"],
  ["library", "Design templates", "ready-made looks starter templates built-in classic contemporary high contrast seasonal camera scene"],
  ["my-designs", "My Designs", "saved local design documents drafts immutable versions Saraswati editor"],
  ["lower-thirds", "Lower thirds", "name title scripture strip lyrics strip band"],
  ["ticker", "News ticker", "crawl announcements scrolling"],
  ["stage", "Stage display", "confidence monitor platform team timer next note band"],
  ["countdown", "Countdown display", "countdown timer red amber time up wrap up confidence monitor back of hall big clock"],
  ["brand", "Brand kit", "logo colours fonts church"],
  ["used-on", "Used on…", "which outputs show each look theme screen output looks"],
]

const SETTINGS: ReadonlyArray<readonly [SettingsSection, string, string]> = [
  ["bible", "Bible and languages", "translations second language yoruba"],
  ["audio", "Audio", "microphone input level"],
  ["speech", "Speech recognition", "listening detection transcript deepgram cloud key api keys whisper"],
  ["display", "Display", "live behaviour"],
  ["remote", "Remote control", "osc http stream deck phone"],
  ["diagnostics", "Diagnostics", "logs support export"],
  ["help", "Help", "tour shortcuts about"],
]

function itemIcon(it: QueueItem) {
  if (isSongItem(it)) return <MusicIcon />
  if (it.kind === "slide") return <PresentationIcon />
  if (isImageItem(it)) return <ImageIcon />
  if (it.kind === "audio") return <MusicIcon />
  return <BookOpenIcon />
}

/**
 * Find anything (Cmd/Ctrl+K): places, design and settings sections, this
 * service's items (previewed in Present, never shown live), and scripture,
 * hymns and songs through Present's Quick find.
 */
export function GlobalSearch() {
  const open = useShellStore((s) => s.searchOpen)
  const items = useQueueStore((s) => s.items)
  const [query, setQuery] = useState("")
  const close = () => {
    useShellStore.getState().setSearchOpen(false)
    setQuery("")
  }
  const run = (f: () => void) => {
    close()
    f()
  }
  return (
    <CommandDialog open={open} onOpenChange={(o) => (o ? useShellStore.getState().setSearchOpen(true) : close())} title="Find anything" description="Places, settings, this service, scripture, hymns and songs" className="sm:max-w-xl">
      {/* cmdk needs its root around the input and list (this dialog does not add one). */}
      <Command>
      <CommandInput placeholder="Find a place, a setting, an item, a verse or a song…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>Nothing here by that name. Press Enter on the first line to look in scripture and songs.</CommandEmpty>
        {query.trim().length > 1 && (
          <CommandGroup heading="Scripture, hymns and songs">
            <CommandItem value={`find ${query}`} onSelect={() => run(() => useShellStore.getState().findInPresent(query.trim()))}>
              <SearchIcon /> Find “{query.trim()}” in Present
              <ArrowRightIcon className="ml-auto" />
            </CommandItem>
          </CommandGroup>
        )}
        {items.length > 0 && (
          <CommandGroup heading="This service">
            {items.map((it, i) => (
              <CommandItem key={it.id} value={`${i + 1} ${it.reference} item`} onSelect={() => run(() => { presentActions.previewItem(it); useShellStore.getState().goTo("present") })}>
                {itemIcon(it)} <span className="truncate">{it.reference}</span>
                <span className="ml-auto text-xs text-muted-foreground">preview</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Go to">
          {PLACES.map(([w, label, icon, words]) => (
            <CommandItem key={w} value={`${label} ${words}`} onSelect={() => run(() => useShellStore.getState().goTo(w))}>{icon} {label}</CommandItem>
          ))}
          <CommandItem value="Live tools production control timekeeper timers hold screens outputs ndi health preflight cameras OBS operators" onSelect={() => run(() => openProductionTab("health"))}><MonitorCogIcon /> Live tools · Show health</CommandItem>
          {/* Services are built in Prepare only (#299): a new one starts there too. */}
          <CommandItem value="new service create sunday plan prepare" onSelect={() => run(() => { useShellStore.getState().setNewServiceOpen(true); useShellStore.getState().goTo("prepare") })}><PlusIcon /> New service</CommandItem>
          <CommandItem value="outputs screens projector ndi stage signage monitor" onSelect={() => run(() => useShellStore.getState().openOutputs())}><MonitorIcon /> Outputs</CommandItem>
        </CommandGroup>
        <CommandGroup heading="Design">
          {DESIGN.map(([tab, label, words]) => (
            <CommandItem key={tab} value={`design ${label} ${words}`} onSelect={() => run(() => useShellStore.getState().openDesign(tab))}><PaletteIcon /> {label}</CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Settings">
          {SETTINGS.map(([section, label, words]) => (
            <CommandItem key={section} value={`settings ${label} ${words}`} onSelect={() => run(() => openSettings(section))}><SettingsIcon /> {label}</CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  )
}
