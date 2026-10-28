import { useDismissedChecks } from "@/studio/dismissed-checks"
import { useSettingsStore } from "@/stores/settings-store"
import { openConnectionsHub } from "@/studio/connections/navigation"
import { approvalState } from "@/lib/approval"
import { ArrowRightIcon, BookOpenIcon, CalendarDaysIcon, CheckIcon, ChevronRightIcon, ImageIcon, InfoIcon, MonitorIcon, MusicIcon, PlayIcon, PlusIcon, PresentationIcon, TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { openSettings } from "@/lib/settings-dialog"
import { useQueueStore } from "@/stores"
import { useSongStore } from "@/stores/song-store"
import { hymnNumbersFromLibrary, songKindLabel } from "@/lib/song-kind"
import { useShellStore } from "@/studio/shell-store"
import { useServiceStore } from "@/stores/service-store"
import { type ReadinessCheck, type ReadinessFix } from "@/studio/readiness"
import { isImageItem, isSongItem } from "@/types"
import { isSkipped, plannedTimes } from "@/lib/run-of-show"
import { formatMinutes } from "@/lib/service-timing"
import { useReadiness } from "@/studio/use-readiness"
import { ChurchFolderCard } from "@/studio/home/church-folder-card"
import { SetupCard } from "@/studio/setup/setup-card"
import { TeamChanges } from "@/studio/home/team-changes"

function greeting(now = new Date()): string {
  const h = now.getHours()
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"
}

const ICON: Record<ReadinessCheck["status"], React.ReactNode> = {
  ok: <CheckIcon className="size-4 text-confidence-high" />,
  warn: <TriangleAlertIcon className="size-4 text-confidence-mid" />,
  info: <InfoIcon className="size-4 text-muted-foreground" />,
}

export function HomeWorkspace() {
  const songs = useSongStore((s) => s.songs)
  const { ready, checks, onAir, items, headers, activeIndex, current, dirty, programs, suggested, outputs, setWorkspace, openOutputs } = useReadiness()

  const fix = (f: ReadinessFix) => {
    if (f === "outputs") openOutputs()
    else if (f === "prepare") setWorkspace("prepare")
    else if (f === "cameras" || f === "obs") openConnectionsHub()
    else openSettings("diagnostics")
  }

  const nextIndex = activeIndex === null ? -1 : items.findIndex((_, index) => index > activeIndex && !isSkipped(items, headers, index))
  const next = nextIndex >= 0 ? items[nextIndex] : undefined
  // Warnings need something done; notes ("Listening is off") are listed but not counted against readiness.
  const okCount = checks.filter((c) => c.status === "ok").length
  const warnings = checks.filter((c) => c.status === "warn")
  const attention = checks.filter((c) => c.status !== "ok")
  const counted = okCount + warnings.length
  const skippedCount = items.reduce((count, _, index) => count + (isSkipped(items, headers, index) ? 1 : 0), 0)
  const minutes = items.reduce((total, item, index) => total + (isSkipped(items, headers, index) ? 0 : item.planned_minutes ?? 0), 0)
  const operatorName = useSettingsStore((s) => s.operatorName).trim()
  const churchName = useSettingsStore((s) => s.brandKit.churchName.trim())
  // Planned times from the run of show when the service has a start time (10:00, 10:02…), else the order.
  const plannedAt = plannedTimes(items, headers)
  const comingUp = current?.service_date ? new Date(`${current.service_date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" }) : null

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1700px] flex-col gap-5 px-8 pt-7 pb-16 max-[1200px]:px-5">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="max-w-full truncate text-[0.625rem] font-extrabold tracking-[0.16em] text-muted-foreground uppercase" title={churchName ? `${churchName} workspace` : "Set up your church"}>{churchName ? `${churchName} workspace` : "Set up your church"}</p>
            <h1 className="mt-1 text-[1.625rem] leading-tight font-bold tracking-[-0.035em]">{greeting()}{operatorName ? `, ${operatorName.split(/\s+/)[0]}` : ", team"} <span aria-hidden className="font-semibold text-muted-foreground">✳</span></h1>
            <p className="mt-1 max-w-[540px] text-xs text-muted-foreground">Everything for this Sunday's service, right where you need it.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setWorkspace("archive")}><CalendarDaysIcon /> View services</Button>
            <Button onClick={() => { useShellStore.getState().setNewServiceOpen(true); setWorkspace("prepare") }}><PlusIcon /> New service</Button>
          </div>
        </header>

        {/* The church's setup (#298), only while an essential is missing; this service's readiness stays in "Your attention". */}
        <SetupCard />

        {/* The approved hero (issue #215): a flat, editorial welcome with Sunday's readiness on a note. */}
        <section aria-labelledby="quick" className="relative grid grid-cols-[minmax(0,1.25fr)_290px] overflow-hidden rounded-[22px] border border-border bg-[#eeede6] dark:bg-card max-[1100px]:grid-cols-1">
          <div className="relative min-w-0 px-[34px] pt-[34px] pb-7">
            <p className="text-[0.625rem] font-bold tracking-[0.18em] text-muted-foreground uppercase">{comingUp ? `Coming up · ${comingUp}` : current ? `This service · ${current.title}` : "No service open"}</p>
            <h2 id="quick" className="mt-2 text-2xl leading-[1.05] font-bold tracking-[-0.045em]">
              Beautiful worship.
              <span className="block font-[Georgia,serif] font-bold text-primary-text italic">Without the chaos.</span>
            </h2>
            <p className="mt-3 max-w-[590px] text-[0.8125rem] text-muted-foreground">
              {items.length === 0
                ? "Start the service in Prepare: passages, songs, hymns, slides and pictures, in order. Nothing goes on a screen until you show it live."
                : ready
                  ? "Your service is ready. Turn the screens on and take it to the live console with confidence."
                  : "Your service is taking shape. Finish the final details, then take it to the live console with confidence."}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button onClick={() => setWorkspace("prepare")}>{items.length ? "Continue preparing" : "Prepare a service"} <ArrowRightIcon /></Button>
              <Button variant="outline" onClick={() => setWorkspace("present")}>Open live console <PlayIcon /></Button>
            </div>
          </div>
          <div className="relative flex items-center justify-center p-6 max-[1100px]:justify-start max-[1100px]:pt-0">
            <div className="w-full max-w-[235px] rotate-[-2deg] rounded-2xl border border-[#e3e4df] bg-[#fafaf8] px-[18px] py-5 shadow-[0_18px_40px_rgba(40,55,60,0.05)] dark:border-border dark:bg-background">
              <p className="text-xs text-muted-foreground">Sunday readiness</p>
              <p className="mt-1 text-[1.5625rem] leading-tight font-bold tracking-[-0.04em]">{ready ? "Ready." : warnings.length <= 2 ? "Almost ready." : "Not ready yet."}</p>
              <p className="mt-1 text-xs text-muted-foreground">{ready ? "Everything checks out" : `${warnings.length === 1 ? "One thing" : `${warnings.length} things`} to check before service`}</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#d7dbd8] dark:bg-muted" role="progressbar" aria-label="Readiness checks" aria-valuemin={0} aria-valuemax={counted} aria-valuenow={okCount}>
                <div className="h-full rounded-full bg-primary" style={{ width: `${counted ? (okCount / counted) * 100 : 0}%` }} />
              </div>
              <p className="mt-2 text-[0.6875rem] text-muted-foreground">{okCount} of {counted} checks complete</p>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-3 gap-4 max-[900px]:grid-cols-1">
          <Stat icon={<CalendarDaysIcon />} label="Sunday plan" value={String(items.length)} unit={items.length === 1 ? "item" : "items"} detail={current ? `${current.title}${skippedCount ? ` · ${skippedCount} skipped` : ""}${minutes ? ` · ${formatMinutes(minutes * 60_000)} scheduled` : ""}${dirty ? " · unsaved changes" : ""}` : "No saved service open"} />
          {/* Checks counted, not a percentage (#298: no arbitrary percentages). */}
          <Stat icon={<CheckIcon />} label="Content readiness" value={String(okCount)} unit={`of ${counted} check${counted === 1 ? "" : "s"}`} detail={ready ? "Ready to present" : `${warnings.length} to check`} />
          <Stat icon={<MonitorIcon />} label="Screens" value={String(onAir)} unit={`of ${outputs.length} on`} detail={onAir ? "On air when you show something live" : "Turn them on in Outputs"} />
        </div>

        <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-5 max-[1100px]:grid-cols-1">
          <section aria-labelledby="glance" className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 id="glance" className="text-[1.1875rem] font-bold tracking-[-0.035em]">Sunday at a glance</h2>
              <Button variant="ghost" size="sm" onClick={() => setWorkspace("prepare")}>Full rundown <ArrowRightIcon /></Button>
            </div>
            <div className="rounded-lg border border-border bg-card p-3 shadow-panel">
              {items.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">Nothing in the service yet. Open Prepare to add passages, songs and slides.</p>
              ) : (
                <ol className="divide-y divide-border">
                  {items.slice(0, 6).map((it, i) => {
                    const skipped = isSkipped(items, headers, i)
                    const skipLabel = it.hidden ? "Hidden for this service" : skipped ? "Phase skipped for this service" : null
                    const plannedTime = skipped ? null : plannedAt.get(i)
                    return (
                      <li key={it.id}>
                        <button type="button" onClick={() => setWorkspace("prepare")} className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50">
                          <span className="flex h-8 w-[53px] shrink-0 items-center justify-center rounded-md bg-[#edf1ec] text-[0.6875rem] font-extrabold text-[#536d67] tabular-nums dark:bg-muted dark:text-muted-foreground" title={plannedTime ? "Planned time" : undefined}>{plannedTime ?? String(i + 1).padStart(2, "0")}</span>
                          <KindTile item={it} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">{it.reference}</span>
                            <span className="block truncate text-xs text-muted-foreground">{kindLabel(it, songs)}{it.planned_minutes ? ` · ${it.planned_minutes} min` : ""}{skipLabel ? ` · ${skipLabel}` : ""}{next?.id === it.id ? " · next" : ""}</span>
                          </span>
                          <ChevronRightIcon className="size-4 text-muted-foreground" />
                        </button>
                      </li>
                    )
                  })}
                </ol>
              )}
              {items.length > 0 && skippedCount === items.length && <p role="status" className="px-2 pt-2 text-xs text-muted-foreground">Every item is hidden or in a skipped phase; nothing is scheduled to present.</p>}
              {items.length > 6 && <p className="px-2 pt-2 text-xs text-muted-foreground">and {items.length - 6} more in the full rundown</p>}
            </div>
          </section>

          <div className="flex flex-col gap-5">
            <section aria-labelledby="readiness" className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 id="readiness" className="text-[1.1875rem] font-bold tracking-[-0.035em]">Your attention</h2>
                <span className={cn("text-xs font-semibold", ready ? "text-confidence-high" : "text-confidence-mid")}>{ready ? "Ready to present" : "Needs attention"}</span>
              </div>
              <ul className="divide-y divide-border rounded-lg border border-border bg-card px-4 shadow-panel">
                {(attention.length ? attention : checks).map((c) => (
                  <li key={c.id} className="flex items-start gap-3 py-3">
                    <span className="mt-0.5">{ICON[c.status]}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{c.label}</p>
                      {c.detail && <p className="text-xs text-muted-foreground">{c.detail}</p>}
                    </div>
                    {c.fix && c.status !== "ok" && (
                      <Button size="sm" variant="soft" onClick={() => fix(c.fix!)}>
                        {c.fixLabel ?? "Fix"}
                      </Button>
                    )}
                    {c.dismiss && <Button size="sm" variant="ghost" onClick={() => useDismissedChecks.getState().dismiss(c.dismiss!)}>Got it</Button>}
                  </li>
                ))}
              </ul>
              {attention.length > 0 && okCount > 0 && <p className="text-xs text-muted-foreground">{okCount} other {okCount === 1 ? "check is" : "checks are"} fine.</p>}
            </section>

            <TeamChanges />
            <ChurchFolderCard />
            <section aria-labelledby="services" className="rounded-lg border border-border bg-card p-4 shadow-panel">
            <h2 id="services" className="mb-2 text-sm font-semibold">Saved services</h2>
            {!current && suggested && (
              <div className="mb-3 flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 p-2">
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block truncate font-medium">{suggested.program.title}</span>
                  <span className="block text-xs text-muted-foreground">{suggested.why === "approved today" ? "Today's service, approved" : suggested.why === "today" ? (approvalState(suggested.program) === "changed" ? "Dated today, changed since approval" : "Dated today, not approved yet") : `Next approved service · ${suggested.program.service_date}`}</span>
                </span>
                <Button size="sm" disabled={dirty} onClick={() => void useServiceStore.getState().openProgram(suggested.program.id).then((r) => { if (r !== "ok") toast.error("Could not open service", { description: useServiceStore.getState().error ?? undefined }) })}>
                  Open
                </Button>
              </div>
            )}
            {programs.length === 0 ? (
              <p className="text-xs text-muted-foreground">None yet. Create one in Prepare to keep a rundown for Sunday.</p>
            ) : (
              <ul className="divide-y divide-border">
                {programs.filter((p) => !p.archived_at && !p.is_template).slice(0, 5).map((p) => (
                  <li key={p.id} className="flex items-center gap-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {p.title}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {p.service_date ?? "undated"} · {p.item_count} item{p.item_count === 1 ? "" : "s"}{approvalState(p) === "approved" ? " · approved" : approvalState(p) === "changed" ? " · changed since approval" : ""}
                      </span>
                    </span>
                    {current?.id === p.id ? (
                      <span className="text-xs text-muted-foreground">open</span>
                    ) : (
                      <Button size="sm" variant="outline" disabled={dirty} title={dirty ? "Save or close the current service first" : undefined}
                        onClick={() => void useServiceStore.getState().openProgram(p.id).then((r) => { if (r !== "ok") toast.error("Could not open service", { description: useServiceStore.getState().error ?? undefined }) })}>
                        Open
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ icon, label, value, unit, detail }: { icon: React.ReactNode; label: string; value: string; unit: string; detail: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-panel">
      <p className="flex items-center gap-2 text-xs text-muted-foreground [&_svg]:size-4">{icon}{label}</p>
      <p className="mt-3 text-[1.625rem] leading-none font-bold tracking-[-0.035em]">{value}<span className="ml-1 text-sm font-semibold tracking-normal text-muted-foreground">{unit}</span></p>
      <p className="mt-2 truncate text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

type Item = ReturnType<typeof useQueueStore.getState>["items"][number]

function kindLabel(it: Item, songs: ReturnType<typeof useSongStore.getState>["songs"]): string {
  if (isSongItem(it)) {
    const library = songs[it.song.song_id]
    return songKindLabel(it, library ? hymnNumbersFromLibrary(library.numbers) : [], library?.song.tags)
  }
  if (it.kind === "slide") return "Slide"
  if (isImageItem(it)) return "Picture or video"
  if (it.kind === "audio") return "Audio cue"
  return "Scripture"
}

/** The item's kind as a tinted icon tile (scripture, song, slide, media). */
function KindTile({ item }: { item: Item }) {
  const [tone, icon] = isSongItem(item)
    ? ["bg-kind-song text-kind-song-foreground", <MusicIcon key="i" />]
    : item.kind === "slide"
      ? ["bg-kind-slide text-kind-slide-foreground", <PresentationIcon key="i" />]
      : isImageItem(item)
        ? ["bg-kind-media text-kind-media-foreground", <ImageIcon key="i" />]
        : ["bg-kind-scripture text-kind-scripture-foreground", <BookOpenIcon key="i" />]
  return <span aria-hidden className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4", tone)}>{icon}</span>
}
