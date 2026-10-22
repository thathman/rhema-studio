import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useServiceStore } from "@/stores/service-store"
import { useShellStore } from "@/studio/shell-store"
import { approvalState } from "@/lib/approval"
import { SongUsageBlock } from "@/studio/more/song-usage-block"
import { ChurchFolderBlock, DatabaseBlock, JournalBlock, PackageBlock } from "@/studio/library/library-blocks"

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[17px] border border-border bg-card p-5 shadow-panel">
      <h2 className="text-base font-bold tracking-[-0.03em]">{title}</h2>
      {sub && <p className="mb-3 text-xs text-muted-foreground">{sub}</p>}
      <div className={sub ? "" : "mt-3"}>{children}</div>
    </section>
  )
}

/** Past services, what went live, song usage, sharing services, and backups. */
export function ArchiveWorkspace() {
  const programs = useServiceStore((s) => s.programs)
  const current = useServiceStore((s) => s.current)
  const dirty = useServiceStore((s) => s.dirty)
  const services = programs.filter((p) => !p.is_template).sort((a, b) => (b.service_date ?? "").localeCompare(a.service_date ?? ""))
  const open = (id: string) =>
    void useServiceStore.getState().openProgram(id).then((r) => {
      if (r === "ok") useShellStore.getState().goTo("prepare")
      else if (r !== "unsaved") toast.error("Could not open service", { description: useServiceStore.getState().error ?? undefined })
    })
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1700px] flex-col gap-5 px-8 pt-6 pb-16 max-[1200px]:px-5">
        <header>
          <p className="text-[0.6875rem] font-extrabold tracking-[0.15em] text-primary uppercase">Your church</p>
          <h1 className="mt-1 text-[1.75rem] leading-tight font-bold tracking-[-0.04em]">Keep the good work.</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every service, what actually went on screen, which songs you sing, and safe copies of it all.</p>
        </header>
        <div className="grid grid-cols-2 gap-5 max-[1100px]:grid-cols-1">
          <Card title="Services" sub={`${services.length} on this computer, newest first${dirty ? " · save or close the open one to open another" : ""}`}>
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {services.length === 0 && <li className="py-3 text-xs text-muted-foreground">None yet. Create one in Prepare.</li>}
              {services.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2">
                  <span className="flex w-14 shrink-0 flex-col items-center rounded-lg bg-surface-sunken py-1 text-[0.625rem] text-muted-foreground tabular-nums">{p.service_date ?? "undated"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.title}</span>
                    <span className="block text-xs text-muted-foreground">{p.item_count} item{p.item_count === 1 ? "" : "s"}</span>
                  </span>
                  {p.archived_at ? <Badge variant="neutral">Archived</Badge> : approvalState(p) === "approved" ? <Badge variant="green">Approved</Badge> : approvalState(p) === "changed" ? <Badge variant="amber">Changed since approval</Badge> : null}
                  {current?.id === p.id ? <span className="text-xs text-muted-foreground">open</span> : <Button size="sm" variant="outline" disabled={dirty} onClick={() => open(p.id)}>Open</Button>}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="What went live" sub="The service log: each item as it went on screen, with times.">
            <JournalBlock />
          </Card>
          <Card title="Songs sung" sub="How often each song was used, for licence reports.">
            <SongUsageBlock />
          </Card>
          <Card title="Share services" sub="The church folder (another computer, a NAS) and service files.">
            <div className="flex flex-col gap-3">
              <ChurchFolderBlock />
              <PackageBlock onClose={() => useShellStore.getState().goTo("prepare")} />
            </div>
          </Card>
          <Card title="Backups" sub="Everything (services and songs) in one file, and back again.">
            <DatabaseBlock />
          </Card>
        </div>
      </div>
    </div>
  )
}
