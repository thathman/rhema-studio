import { ArrowRightIcon, BookOpenIcon, HouseIcon, ImageIcon, LibraryBigIcon, MonitorIcon, MusicIcon, PaletteIcon, PencilRulerIcon, PlayIcon, PlusIcon, PresentationIcon, SearchIcon, SettingsIcon, ArchiveIcon, MonitorCogIcon, ShieldCheckIcon, CableIcon } from "lucide-react"
import { useState } from "react"
import { defaultFilter } from "cmdk"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { useQueueStore } from "@/stores"
import { useShellStore, type DesignTab, type LibrarySection, type Workspace } from "@/studio/shell-store"
import { openSettings, type SettingsSection } from "@/lib/settings-dialog"
import { presentActions } from "@/studio/present-actions"
import { isImageItem, isSongItem, type QueueItem } from "@/types"
import { projectRunOfShowEvents } from "@/lib/run-of-show"
import { openProductionTab, type ProductionTab } from "@/studio/production/production-tab"

const PLACES: ReadonlyArray<readonly [Workspace, string, React.ReactNode, string]> = [
  ["home", "Home", <HouseIcon key="i" />, "overview readiness today"],
  ["prepare", "Prepare", <PencilRulerIcon key="i" />, "service builder rundown run of show plan edit history approve copy"],
  ["present", "Live", <PlayIcon key="i" />, "live console present show go live"],
  ["library", "Library", <LibraryBigIcon key="i" />, "songs hymns bible slides media files"],
  ["design", "Design", <PaletteIcon key="i" />, "themes looks studio"],
  ["permissions", "People & access", <ShieldCheckIcon key="i" />, "permissions paired devices roles access approval requests team people comments church folder operator name"],
  ["connections", "Connections", <CableIcon key="i" />, "tvs receivers camera phones remotes obs computers pairing nearby devices discover"],
  ["archive", "History", <ArchiveIcon key="i" />, "past services execution records logs"],
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
  ["used-on", "Where used", "which outputs show each look theme screen output looks"],
]

/** Library's sections (#402, #447), each by the words people use for it. */
const LIBRARY: ReadonlyArray<readonly [LibrarySection, string, string]> = [
  ["bible", "Bible", "scripture translations versions saved passages verses yoruba"],
  ["songs", "Songs & ministrations", "songs worship choir ministrations lyrics"],
  ["hymns", "Hymn book", "hymns hymn book cac numbers sss"],
  ["slides", "Slides & announcements", "slides announcements notices reusable welcome"],
  ["designs", "Visual designs", "designs saved versions pinned"],
  ["media", "Pictures & videos", "pictures images photos videos media"],
  ["audio", "Sounds", "sounds audio music mp3 walk-in backing track sting"],
  ["collections", "Collections", "collections sets groups favourites saved lists"],
  ["files", "Import & export", "import export files backup songs openlyrics"],
]

/** The Live tools, each findable by name: OBS, scenes, cameras, timers, operators, screens, health. */
const LIVE_TOOLS: ReadonlyArray<readonly [ProductionTab, string, string]> = [
  ["obs", "OBS", "obs stream streaming scenes switch record recording websocket"],
  ["programs", "Scenes", "scenes program take layout congregation"],
  ["cameras", "Cameras", "cameras phone camera video feed"],
  ["timekeeper", "Timer", "timer timers timekeeper clock countdown hold late service time"],
  ["operators", "Operators", "operators desks crew phones paired take back control"],
  ["screens", "Screens", "screens outputs on off feeds tvs"],
  ["health", "Show health", "health preflight check readiness ndi"],
]

/** Library sections that search by words handed from here (#407). */
const FIND_IN: ReadonlyArray<readonly [LibrarySection, string]> = [["hymns", "the Hymn book"], ["songs", "Songs"], ["bible", "the Bible"]]

const SETTINGS: ReadonlyArray<readonly [SettingsSection, string, string]> = [
  ["appearance", "Appearance", "light dark mode system theme night preferences"],
  ["church", "Church and profile", "church name campus ministry time zone your name operator computer name profile"],
  ["screens", "Outputs", "screens projector ndi displays settings"],
  ["bible", "Bible", "translations second language yoruba"],
  ["audio", "Audio", "microphone input level"],
  ["speech", "Speech Recognition", "listening detection transcript deepgram cloud key api keys whisper"],
  ["display", "Heard verses", "display live behaviour detected verses"],
  ["remote", "Network & remote access", "osc http stream deck phone obs websocket password connect network remote access"],
  ["assistants", "AI assistants", "ai mcp claude assistant drafts"],
  ["data", "Data & Sync", "data sync church folder backup restore"],
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
 * service's items (opened in Prepare; from Live, cued in Live's Preview, never shown live), and scripture,
 * hymns and songs through Live's Quick find (#407: it says so, and that
 * results there are previews: nothing goes on screen until Take).
 */
/** Letters without their accents, so "Yoruba" finds "Yorùbá" and "Jesu" finds "Jésù" (#407). */
const plain = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "")
const accentFreeFilter = (value: string, search: string, keywords?: string[]) =>
  defaultFilter(plain(value), plain(search), keywords?.map(plain))

export function GlobalSearch() {
  const open = useShellStore((s) => s.searchOpen)
  const inLive = useShellStore((s) => s.workspace === "present")
  const items = useQueueStore((s) => s.items)
  const headers = useQueueStore((s) => s.headers)
  // Each item's event (#404), so "Prayer" reads "Opening prayer · Prayer" and is found by either.
  const eventOf = new Map(projectRunOfShowEvents(items, headers).flatMap((e) => e.moments.map((m) => [m.id, e.title] as const)))
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
    <CommandDialog open={open} onOpenChange={(o) => (o ? useShellStore.getState().setSearchOpen(true) : close())} title="Find anything" description="Places, settings and this service here; scripture, hymns and songs open in the Library, or in Live’s Quick find as previews" className="sm:max-w-xl">
      {/* cmdk needs its root around the input and list (this dialog does not add one). */}
      <Command filter={accentFreeFilter}>
      <CommandInput placeholder="Find a place, a setting, an item, a verse or a song…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>Nothing here by that name. Type two letters or more to look in scripture, hymns and songs.</CommandEmpty>
        {query.trim().length > 1 && (
          // In the Library (#407): found there, previewed there; nothing reaches Live.
          <CommandGroup heading="Scripture, hymns and songs (in the Library)">
            {/* The Bible looks up references ("John 3:16", "jn 3 16"), so it is offered only for words with a number. */}
            {FIND_IN.filter(([section]) => section !== "bible" || /\d/.test(query)).map(([section, label]) => (
              <CommandItem key={section} value={`library find ${section} ${query}`} onSelect={() => run(() => useShellStore.getState().findInLibrary(section, query.trim()))}>
                <LibraryBigIcon /> <span className="truncate">Find “{query.trim()}” in {label}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">opens the Library</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {query.trim().length > 1 && (
          <CommandGroup heading="Scripture, hymns and songs (in Live)">
            <CommandItem value={`find ${query}`} onSelect={() => run(() => useShellStore.getState().findInPresent(query.trim()))}>
              <SearchIcon /> <span className="truncate">Search “{query.trim()}” in Live’s Quick find</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">opens Live · preview only</span>
              <ArrowRightIcon />
            </CommandItem>
          </CommandGroup>
        )}
        {items.length > 0 && (
          <CommandGroup heading={inLive ? "This service (to Live's Preview)" : "This service (opens in Prepare)"}>
            {items.map((it, i) => (
              // In Live it cues Preview (Live's own action); anywhere else it opens in Prepare and Live is untouched (#447).
              <CommandItem key={it.id} value={`${i + 1} ${eventOf.get(it.id) ?? ""} ${it.reference} item`} onSelect={() => run(() => {
                if (inLive) return presentActions.previewItem(it)
                useShellStore.getState().openInPrepare(it.id)
              })}>
                {itemIcon(it)} <span className="truncate">{eventOf.get(it.id) && <span className="text-muted-foreground">{eventOf.get(it.id)} · </span>}{it.reference}</span>
                <span className="ml-auto text-xs text-muted-foreground">{inLive ? "Live preview" : "open in Prepare"}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Go to">
          {PLACES.map(([w, label, icon, words]) => (
            <CommandItem key={w} value={`${label} ${words}`} onSelect={() => run(() => useShellStore.getState().goTo(w))}>{icon} {label}</CommandItem>
          ))}
          {/* Each Live tool by its own name (UX audit S1e): "obs" finds OBS, not a health page. */}
          {LIVE_TOOLS.map(([tab, label, words]) => (
            <CommandItem key={tab} value={`${label} ${words} live tools production`} onSelect={() => run(() => openProductionTab(tab))}><MonitorCogIcon /> Live · {label}</CommandItem>
          ))}
          {/* Services are built in Prepare only (#299): a new one starts there too. */}
          <CommandItem value="new service create sunday plan prepare" onSelect={() => run(() => { useShellStore.getState().setNewServiceOpen(true); useShellStore.getState().goTo("prepare") })}><PlusIcon /> New service</CommandItem>
          <CommandItem value="outputs screens projector ndi stage signage monitor" onSelect={() => run(() => useShellStore.getState().openOutputs())}><MonitorIcon /> Outputs</CommandItem>
        </CommandGroup>
        <CommandGroup heading="Library">
          {LIBRARY.map(([section, label, words]) => (
            <CommandItem key={section} value={`library ${label} ${words}`} onSelect={() => run(() => {
              // Through goTo, as every place here: leaving Design asks first about an unsaved draft.
              useShellStore.getState().setLibrarySection(section)
              useShellStore.getState().goTo("library")
            })}><LibraryBigIcon /> {label}</CommandItem>
          ))}
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
