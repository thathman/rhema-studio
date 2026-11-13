import { toast } from "sonner"
import { savedServiceCount } from "@/lib/run-of-show"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useServiceStore } from "@/stores/service-store"
import { useShellStore } from "@/studio/shell-store"
import { approvalState } from "@/lib/approval"
import { archiveMonthAt, formatServiceCalendarDate, serviceCalendarDate, serviceDateInMonth } from "@/lib/archive-calendar"
import { validTimeZone } from "@/lib/church-time"
import { systemTimeZone } from "@/lib/setup-readiness"
import { useState } from "react"
import { SongUsageBlock } from "@/studio/archive/song-usage-block"
import { JournalBlock } from "@/studio/archive/service-runs"
import { RunChronologyPage } from "@/studio/archive/run-chronology"
import { RecorderArchive } from "@/studio/archive/recorder-archive"
import { useSettingsStore } from "@/stores/settings-store"

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-panel">
      <h2 className="text-base font-bold tracking-[-0.03em]">{title}</h2>
      {sub && <p className="mb-3 text-xs text-muted-foreground">{sub}</p>}
      <div className={sub ? "" : "mt-3"}>{children}</div>
    </section>
  )
}

/** Review service runs, saved plans and song usage. Data management lives in Settings. */
export function ArchiveWorkspace() {
  const programs = useServiceStore((s) => s.programs)
  const current = useServiceStore((s) => s.current)
  const dirty = useServiceStore((s) => s.dirty)
  const configuredTimeZone = useSettingsStore((s) => s.setup.timeZone)
  const services = programs.filter((p) => !p.is_template).sort((a, b) => (b.service_date ?? "").localeCompare(a.service_date ?? ""))
  const timeZone = validTimeZone(configuredTimeZone)
  const month = archiveMonthAt(new Date().getTime(), timeZone)
  const monthName = month.monthName
  const year = month.year
  const thisMonth = services.filter((p) => serviceDateInMonth(p.service_date, month))
  const timeZoneDescription = timeZone
    ? `Month uses ${timeZone} church time. Saved service dates stay on their calendar day.`
    : `Month uses this computer's time${systemTimeZone() ? ` (${systemTimeZone()})` : ""}. Saved service dates stay on their calendar day.`
  const stats: Array<[string, string, string]> = [
    ["Services this month", String(thisMonth.length), thisMonth.length ? savedServiceCount(thisMonth.reduce((t, p) => ({ item_count: t.item_count + p.item_count, event_count: t.event_count + (p.event_count ?? 0) }), { item_count: 0, event_count: 0 })) : "None dated this month yet"],
    ["Saved services", String(services.length), "On this computer"],
    ["Approved", String(services.filter((p) => approvalState(p) === "approved").length), "Ready for their Sunday"],
  ]
  const open = (id: string) =>
    void useServiceStore.getState().openProgram(id).then((r) => {
      if (r === "ok") useShellStore.getState().goTo("prepare")
      // Refused, said: an open service with changes, or items not in a service yet (#411).
      else if (r === "unsaved") toast.warning("Save what is open in Prepare first", { description: "It has changes, or items not yet in a service." })
      else toast.error("Could not open service", { description: useServiceStore.getState().error ?? undefined })
    })
  // One run's chronology page (#854 G10) replaces the overview until Back.
  const [openRunId, setOpenRunId] = useState<string | null>(null)
  if (openRunId) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex max-w-[1700px] flex-col gap-5 px-8 pt-6 pb-16 max-[1200px]:px-5">
          <RunChronologyPage runId={openRunId} onBack={() => setOpenRunId(null)} />
        </div>
      </div>
    )
  }
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1700px] flex-col gap-5 px-8 pt-6 pb-16 max-[1200px]:px-5">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow">Every Sunday has a story</p>
            <h1 className="mt-1 text-[1.625rem] leading-tight font-bold tracking-[-0.035em]">History and records.</h1>
            {/* #824 F13: the records are not edited here, but logs can be kept, saved and deleted, so it does not claim "read-only". */}
            <p className="mt-1 text-xs text-muted-foreground">Every saved service, and what happened during each run. Reviewing a run never changes an output or restores a service. You can keep, save or delete logs and add after-action notes; the run's own record is never rewritten.</p>
          </div>
        </header>

        <section aria-label="At a glance" className="rounded-lg border border-border bg-card px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold">{monthName} at a glance</h2>
              <p className="text-xs text-muted-foreground">{timeZoneDescription}</p>
            </div>
            <span className="rounded-[5px] bg-tone-green px-2 py-1 text-[0.6875rem] font-bold text-tone-green-foreground">{monthName} {year}</span>
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-4 max-[700px]:grid-cols-1">
            {stats.map(([label, value, note]) => (
              <div key={label}>
                <dt className="eyebrow">{label}</dt>
                <dd className="mt-1 text-4xl font-bold tracking-[-0.04em] tabular-nums">{value}</dd>
                <dd className="text-[0.6875rem] text-muted-foreground">{note}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="past" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="past" className="text-lg font-bold tracking-[-0.03em]">Saved services</h2>
            {/* #804 R5: the one full list of saved services; Home shows the latest few and links here. */}
            <p className="text-xs text-muted-foreground">Every one on this computer ({services.length}), newest first{dirty ? " · save or close the open one to open another" : ""}</p>
          </div>
          {services.length === 0 && <p className="rounded-lg border border-border bg-card px-5 py-6 text-center text-xs text-muted-foreground">None yet. Create one in Prepare.</p>}
          <ul className="flex flex-col gap-2.5">
            {services.map((p) => {
              const d = serviceCalendarDate(p.service_date)
              const shortDate = formatServiceCalendarDate(p.service_date, { month: "short" })
              const fullDate = formatServiceCalendarDate(p.service_date, { day: "numeric", month: "short", year: "numeric" })
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-4 rounded-[14px] border border-border bg-card px-[18px] py-4">
                  <span className="flex w-[53px] shrink-0 flex-col items-center rounded-lg bg-accent py-1.5 text-accent-foreground tabular-nums">
                    {d && shortDate ? <><span className="text-[1.4375rem] leading-none font-bold">{d.day}</span><span className="mt-0.5 text-[0.625rem] font-semibold uppercase">{shortDate}</span></> : <span className="py-2 text-[0.625rem]">undated</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{p.title}</span>
                    <span className="block text-xs text-muted-foreground">{[fullDate, savedServiceCount(p)].filter(Boolean).join(" · ")}</span>
                  </span>
                  {p.archived_at ? <Badge variant="neutral">Archived</Badge> : approvalState(p) === "approved" ? <Badge variant="green">Approved</Badge> : approvalState(p) === "changed" ? <Badge variant="amber">Changed since approval</Badge> : <Badge variant="neutral">Not approved</Badge>}
                  {current?.id === p.id ? <span className="text-xs text-muted-foreground">open</span> : <Button size="sm" variant="outline" disabled={dirty} onClick={() => open(p.id)}>Open</Button>}
                </li>
              )
            })}
          </ul>
        </section>

        <RecorderArchive />

        <div className="grid grid-cols-2 gap-5 max-[1100px]:grid-cols-1">
          <Card title="Service runs and logs" sub="This session's log, each saved run's chronology and after-action notes, and the logs you kept. Opening a run never restores a service or sends anything to a screen.">
            <JournalBlock onOpenRun={setOpenRunId} />
          </Card>
          {/* #843 S19: counted from what was shown during runs; a plan-based count is labelled "planned". */}
          <Card title="Song usage" sub="Songs shown on screen during service runs, for licence reports. Planned counts from saved services are labelled planned.">
            <SongUsageBlock />
          </Card>
        </div>
      </div>
    </div>
  )
}
