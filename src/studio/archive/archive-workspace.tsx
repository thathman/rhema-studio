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
    <section className="rounded-lg border border-border bg-card p-5 shadow-panel">
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
  const now = new Date()
  const monthName = now.toLocaleDateString(undefined, { month: "long" })
  const year = now.getFullYear()
  const thisMonth = services.filter((p) => p.service_date?.startsWith(`${year}-${String(now.getMonth() + 1).padStart(2, "0")}`))
  const stats: Array<[string, string, string]> = [
    ["Services this month", String(thisMonth.length), thisMonth.length ? `${thisMonth.reduce((n, p) => n + p.item_count, 0)} items in all` : "None dated this month yet"],
    ["Saved services", String(services.length), "On this computer"],
    ["Approved", String(services.filter((p) => approvalState(p) === "approved").length), "Ready for their Sunday"],
  ]
  const open = (id: string) =>
    void useServiceStore.getState().openProgram(id).then((r) => {
      if (r === "ok") useShellStore.getState().goTo("prepare")
      else if (r !== "unsaved") toast.error("Could not open service", { description: useServiceStore.getState().error ?? undefined })
    })
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1700px] flex-col gap-5 px-8 pt-6 pb-16 max-[1200px]:px-5">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Every Sunday has a story</p>
            <h1 className="mt-1 text-[1.625rem] leading-tight font-bold tracking-[-0.035em]">Keep the good work.</h1>
            <p className="mt-1 text-xs text-muted-foreground">Find your past services, open a favourite structure, and remember what actually went on screen.</p>
          </div>
        </header>

        <section aria-label="At a glance" className="rounded-lg border border-border bg-card px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold">{monthName} at a glance</h2>
              <p className="text-xs text-muted-foreground">From the services saved on this computer.</p>
            </div>
            <span className="rounded-[5px] bg-tone-green px-2 py-1 text-[0.6875rem] font-bold text-tone-green-foreground">{monthName} {year}</span>
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-4 max-[700px]:grid-cols-1">
            {stats.map(([label, value, note]) => (
              <div key={label}>
                <dt className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">{label}</dt>
                <dd className="mt-1 text-4xl font-bold tracking-[-0.04em] tabular-nums">{value}</dd>
                <dd className="text-[0.6875rem] text-muted-foreground">{note}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="past" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="past" className="text-lg font-bold tracking-[-0.03em]">Past services</h2>
            <p className="text-xs text-muted-foreground">{services.length} on this computer, newest first{dirty ? " · save or close the open one to open another" : ""}</p>
          </div>
          {services.length === 0 && <p className="rounded-lg border border-border bg-card px-5 py-6 text-center text-xs text-muted-foreground">None yet. Create one in Prepare.</p>}
          <ul className="flex flex-col gap-2.5">
            {services.map((p) => {
              const d = p.service_date ? new Date(`${p.service_date}T12:00:00`) : null
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-4 rounded-[14px] border border-border bg-card px-[18px] py-4">
                  <span className="flex w-[53px] shrink-0 flex-col items-center rounded-lg bg-accent py-1.5 text-accent-foreground tabular-nums">
                    {d ? <><span className="text-[1.4375rem] leading-none font-bold">{d.getDate()}</span><span className="mt-0.5 text-[0.625rem] font-semibold uppercase">{d.toLocaleDateString(undefined, { month: "short" })}</span></> : <span className="py-2 text-[0.625rem]">undated</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{p.title}</span>
                    <span className="block text-xs text-muted-foreground">{[d?.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }), `${p.item_count} item${p.item_count === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</span>
                  </span>
                  {p.archived_at ? <Badge variant="neutral">Archived</Badge> : approvalState(p) === "approved" ? <Badge variant="green">Approved</Badge> : approvalState(p) === "changed" ? <Badge variant="amber">Changed since approval</Badge> : <Badge variant="neutral">Not approved</Badge>}
                  {current?.id === p.id ? <span className="text-xs text-muted-foreground">open</span> : <Button size="sm" variant="outline" disabled={dirty} onClick={() => open(p.id)}>Open</Button>}
                </li>
              )
            })}
          </ul>
        </section>

        <div className="grid grid-cols-2 gap-5 max-[1100px]:grid-cols-1">
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
          <Card title="Backups" sub="Services, songs, settings, outputs and looks in one file (no saved keys or passwords), and back again.">
            <DatabaseBlock />
          </Card>
        </div>
      </div>
    </div>
  )
}
