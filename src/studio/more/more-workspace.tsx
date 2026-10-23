import {
  MonitorIcon,
  PaletteIcon,
  SettingsIcon,
  LayoutGridIcon,
  BookOpenIcon,
  LibraryIcon,
  TvIcon,
  ArchiveIcon,
  UsersIcon,
  PlugIcon,
  ChevronRightIcon,
} from "lucide-react"
import { AboutNotices } from "@/components/about-notices"
import { Badge } from "@/components/ui/badge"


import { openSettings } from "@/lib/settings-dialog"
import { useShellStore } from "@/studio/shell-store"
import { WorkspaceHeader } from "@/studio/ui/status-chip"

interface Row {
  icon: React.ReactNode
  label: string
  detail: string
  onClick?: () => void
  planned?: string
}

export function MoreWorkspace() {
  const setWorkspace = useShellStore((s) => s.setWorkspace)
  const setPresentView = useShellStore((s) => s.setPresentView)
  const openOutputs = useShellStore((s) => s.openOutputs)


  const groups: Array<{ title: string; rows: Row[] }> = [
    {
      title: "Production",
      rows: [
        { icon: <MonitorIcon />, label: "Outputs", detail: "Screens and NDI senders, which theme each one shows", onClick: openOutputs },
        { icon: <PaletteIcon />, label: "Themes", detail: "Design how scripture looks on screen", onClick: () => useShellStore.getState().openDesign("themes") },
        { icon: <PaletteIcon />, label: "Church brand", detail: "Logo, colours and fonts once; three matching themes", onClick: () => useShellStore.getState().openDesign("brand") },
        {
          icon: <LayoutGridIcon />,
          label: "Classic layout",
          detail: "The original Rhema dashboard with transcript and detections (Production view)",
          onClick: () => { setPresentView("production"); setWorkspace("present") },
        },
        { icon: <PlugIcon />, label: "Remote control", detail: "OSC and HTTP settings for Stream Deck and automation", onClick: () => openSettings("remote") },
      ],
    },
    {
      title: "Content",
      rows: [
        { icon: <BookOpenIcon />, label: "Bible", detail: "Translations and the secondary language", onClick: () => openSettings("bible") },
        { icon: <LibraryIcon />, label: "Library", detail: "Songs and hymnbooks: export, import (Rhema or OpenLyrics files)", onClick: () => useShellStore.getState().goTo("library") },
      ],
    },
    {
      title: "Later",
      rows: [
        { icon: <TvIcon />, label: "Signage", detail: "Foyer screens and announcement playlists", planned: "Milestone 8" },
        { icon: <ArchiveIcon />, label: "Archive", detail: "Earlier service logs: what actually went live, searchable (in Library)", onClick: () => useShellStore.getState().goTo("archive") },
        { icon: <UsersIcon />, label: "Team", detail: "Your name, approvals, comments and the church folder", onClick: () => useShellStore.getState().goTo("team") },
      ],
    },
    {
      title: "App",
      rows: [
        { icon: <SettingsIcon />, label: "Settings", detail: "Audio, speech (and the Deepgram key), display, diagnostics", onClick: () => openSettings() },
      ],
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader title="More" />
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-6" data-tour="more-list">
          {groups.map((g) => (
            <section key={g.title} aria-label={g.title}>
              <h2 className="mb-2 px-1 text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase">{g.title}</h2>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {g.rows.map((r) => (
                  <li key={r.label}>
                    <button
                      type="button"
                      disabled={!r.onClick}
                      onClick={r.onClick}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent [&_svg]:size-4"
                    >
                      <span className="text-muted-foreground">{r.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{r.label}</span>
                        <span className="block text-xs text-muted-foreground">{r.detail}</span>
                      </span>
                      {r.planned ? (
                        <Badge variant="outline" className="text-[0.6875rem]">Planned · {r.planned}</Badge>
                      ) : (
                        <ChevronRightIcon className="text-muted-foreground" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <AboutNotices />
        </div>
      </div>
    </div>
  )
}
