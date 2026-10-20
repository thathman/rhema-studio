import { useEffect, useState } from "react"
import { getVersion } from "@tauri-apps/api/app"
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
import { Badge } from "@/components/ui/badge"
import { openSettings } from "@/lib/settings-dialog"
import { useBroadcastStore } from "@/stores"
import { useShellStore } from "@/studio/shell-store"
import { WorkspaceHeader } from "@/studio/ui/status-chip"
import { LibraryDialog } from "@/studio/more/library-dialog"

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
  const [version, setVersion] = useState<string | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(null))
  }, [])

  const groups: Array<{ title: string; rows: Row[] }> = [
    {
      title: "Production",
      rows: [
        { icon: <MonitorIcon />, label: "Outputs", detail: "Screens and NDI senders, which theme each one shows", onClick: openOutputs },
        { icon: <PaletteIcon />, label: "Themes", detail: "Design how scripture looks on screen", onClick: () => useBroadcastStore.getState().setDesignerOpen(true) },
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
        { icon: <LibraryIcon />, label: "Library", detail: "Songs and hymnbooks: export, import (Rhema or OpenLyrics files)", onClick: () => setLibraryOpen(true) },
      ],
    },
    {
      title: "Later",
      rows: [
        { icon: <TvIcon />, label: "Signage", detail: "Foyer screens and announcement playlists", planned: "Milestone 8" },
        { icon: <ArchiveIcon />, label: "Archive", detail: "Service history and what actually went live", planned: "Milestone 9" },
        { icon: <UsersIcon />, label: "Team", detail: "People, roles and approvals", planned: "Milestone 7" },
      ],
    },
    {
      title: "App",
      rows: [
        { icon: <SettingsIcon />, label: "Settings", detail: "Audio, speech, display, API keys, diagnostics", onClick: () => openSettings() },
      ],
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader title="More" />
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
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
                        <Badge variant="outline" className="text-[0.625rem]">Planned · {r.planned}</Badge>
                      ) : (
                        <ChevronRightIcon className="text-muted-foreground" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section aria-label="About" className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
            <p className="mb-1 text-sm font-medium text-foreground">
              Rhema Studio {version ? `v${version}` : ""}
            </p>
            <p>
              Built on <span className="text-foreground">Rhema</span> by OpenBezal (MIT licence, © 2025 OpenBezal).
              Rhema Studio keeps the upstream licence and attribution.
            </p>
            <p className="mt-2">
              Yoruba scripture: <span className="text-foreground">Open Yoruba Contemporary Bible</span>, © 2009, 2017 by
              Biblica, Inc., used under CC BY-SA 4.0. The original work by Biblica, Inc. is available for free at
              www.biblica.com and open.bible. The text has been converted to this app's database format; see
              licenses/YORUBA-OYCB-LICENSE.md in the application resources for the changes made. Other translations carry
              their own licences; see the Bible section in Settings and the README.
            </p>
          </section>
        </div>
      </div>
      <LibraryDialog open={libraryOpen} onClose={() => setLibraryOpen(false)} />
    </div>
  )
}
