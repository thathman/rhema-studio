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
import { unsavedOpenWords, useServiceStore } from "@/stores/service-store"
import { type ReadinessCheck, type ReadinessFix } from "@/studio/readiness"
import { isImageItem, isSongItem } from "@/types"
import { isSkipped, nextVisibleItem, orderCounts, plannedTimes, projectRunOfShowEvents, savedServiceCount } from "@/lib/run-of-show"
import { formatMinutes } from "@/lib/service-timing"
import { useReadiness } from "@/studio/use-readiness"
import { ChurchFolderCard } from "@/studio/home/church-folder-card"
import { SetupCard } from "@/studio/setup/setup-card"
import { TeamChanges } from "@/studio/home/team-changes"
import { recentServices } from "@/studio/home/recent-services"

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
  const events = projectRunOfShowEvents(items, headers)
  const eventTitleByMomentId = new Map(events.flatMap((event) => event.moments.map((moment) => [moment.id, event.title] as const)))
  const hasPlan = Boolean(current) || items.length > 0 || events.length > 0

  const fix = (f: ReadinessFix) => {
    if (f === "outputs") openOutputs()
    else if (f === "prepare") setWorkspace("prepare")
    else if (f === "obs") openConnectionsHub("obs")
    else if (f === "cameras") openConnectionsHub()
    else openSettings("diagnostics")
  }

  const next = nextVisibleItem(items, headers, activeIndex)
  // Event-first, as in Prepare and Live (#404).
  const order = orderCounts(items, headers)
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
            <p className="eyebrow max-w-full truncate" title={churchName || "Set up your church"}>{churchName || "Set up your church"}</p>
            <h1 className="mt-1 text-2xl leading-tight font-semibold tracking-tight">{greeting()}{operatorName ? `, ${operatorName.split(/\s+/)[0]}` : ""}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setWorkspace("archive")}><CalendarDaysIcon /> View services</Button>
            <Button onClick={() => { useShellStore.getState().setNewServiceOpen(true); setWorkspace("prepare") }}><PlusIcon /> New service</Button>
          </div>
        </header>

        {/* The church's setup (#298), only while an essential is missing; this service's readiness stays in "Your attention". */}
        <SetupCard />

        {/* This service, plainly (UX audit decision 9): no slogan, no second readiness card; the stats below carry the counts. */}
        <section aria-labelledby="quick" className="rounded-lg border border-border bg-card p-5 shadow-panel">
          <p className="eyebrow">{comingUp ? `Coming up · ${comingUp}` : current ? "This service" : "No service open"}</p>
          <h2 id="quick" className="mt-1 truncate text-lg font-semibold">{current?.title ?? "No service open"}</h2>
            <p className="mt-1 max-w-[640px] text-sm text-muted-foreground">
              {!hasPlan
                ? "Start a service in Prepare: add events, then place passages, songs, hymns, slides and pictures in order. The plan stays separate from Live."
                : items.length === 0
                  ? events.length > 0
                    ? `${events.length} ${events.length === 1 ? "event is" : "events are"} in the running order, with no moments yet. Continue in Prepare to add content. Plan changes do not change Live on their own.`
                    : "This service is open, but its running order is empty. Add an event in Prepare. Plan changes do not change Live on their own."
                : ready
                  ? "Your service is ready. Turn the screens on and open Live."
                  : "Your service is taking shape. Finish the details below, then open Live."}
            </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => setWorkspace("prepare")}>{hasPlan ? "Continue preparing" : "Prepare a service"} <ArrowRightIcon /></Button>
            <Button variant="outline" onClick={() => setWorkspace("present")}>Open Live <PlayIcon /></Button>
          </div>
        </section>

        <div className="grid grid-cols-3 gap-4 max-[900px]:grid-cols-1">
          <Stat icon={<CalendarDaysIcon />} label="Sunday plan" value={String(order.events || order.items)} unit={order.events ? (order.events === 1 ? "event" : "events") : (order.items === 1 ? "item" : "items")} detail={current ? `${current.title}${order.events && order.loose ? ` · ${order.loose} ${order.loose === 1 ? "item" : "items"} outside events` : ""}${skippedCount ? ` · ${skippedCount} ${skippedCount === 1 ? "item" : "items"} skipped` : ""}${minutes ? ` · ${formatMinutes(minutes * 60_000)} scheduled` : ""}${dirty ? " · unsaved changes" : ""}` : "No saved service open"} />
          {/* Checks counted, not a percentage (#298: no arbitrary percentages). */}
          <Stat icon={<CheckIcon />} label="Service readiness" value={String(okCount)} unit={`of ${counted} check${counted === 1 ? "" : "s"}`} detail={ready ? "Ready to present" : `${warnings.length} to check`} />
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
                events.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">Nothing in the running order yet. Open Prepare to add an event and its moments.</p>
                ) : (
                  <>
                    <p className="px-2 py-2 text-xs text-muted-foreground">{events.length} {events.length === 1 ? "event" : "events"} in the running order · no moments yet</p>
                    <ol className="divide-y divide-border">
                      {events.slice(0, 6).map((event, index) => (
                        <li key={event.id} className="flex items-center gap-3 rounded-lg px-2 py-2.5">
                          <span className="flex h-8 w-[53px] shrink-0 items-center justify-center rounded-md bg-[#edf1ec] text-[0.6875rem] font-extrabold text-[#536d67] tabular-nums dark:bg-muted dark:text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">{event.title || "Untitled event"}</span>
                            <span className="block truncate text-xs text-muted-foreground">Event · no moments yet</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                    {events.length > 6 && <p className="px-2 pt-2 text-xs text-muted-foreground">and {events.length - 6} more in the full rundown</p>}
                  </>
                )
              ) : (
                <ol className="divide-y divide-border">
                  {items.slice(0, 6).map((it, i) => {
                    const skipped = isSkipped(items, headers, i)
                    const skipLabel = it.hidden ? "Hidden for this service" : skipped ? "Phase skipped for this service" : null
                    const plannedTime = skipped ? null : plannedAt.get(i)
                    const eventTitle = eventTitleByMomentId.get(it.id)
                    return (
                      <li key={it.id}>
                        <button type="button" onClick={() => setWorkspace("prepare")} className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50">
                          <span className="flex h-8 w-[53px] shrink-0 items-center justify-center rounded-md bg-[#edf1ec] text-[0.6875rem] font-extrabold text-[#536d67] tabular-nums dark:bg-muted dark:text-muted-foreground" title={plannedTime ? "Planned time" : undefined}>{plannedTime ?? String(i + 1).padStart(2, "0")}</span>
                          <KindTile item={it} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">{it.reference}</span>
                            <span className="block truncate text-xs text-muted-foreground">{eventTitle ? `${eventTitle} · ` : ""}{kindLabel(it, songs)}{it.planned_minutes ? ` · ${it.planned_minutes} min` : ""}{skipLabel ? ` · ${skipLabel}` : ""}{next?.item.id === it.id && activeIndex !== null ? next.kind === "moment" ? " · next moment" : " · next" : ""}</span>
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
            {/* #804 R5: a short recent list; History has the one full list of saved services. */}
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 id="services" className="text-sm font-semibold">Recent services</h2>
              <Button size="xs" variant="ghost" onClick={() => setWorkspace("archive")}>All saved services <ChevronRightIcon /></Button>
            </div>
            {!current && suggested && (
              <div className="mb-3 flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 p-2">
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block truncate font-medium">{suggested.program.title}</span>
                  <span className="block text-xs text-muted-foreground">{suggested.why === "approved today" ? "Today's service, approved" : suggested.why === "today" ? (approvalState(suggested.program) === "changed" ? "Dated today, changed since approval" : "Dated today, not approved yet") : `Next approved service · ${suggested.program.service_date}`}</span>
                </span>
                <Button size="sm" disabled={dirty} onClick={() => void useServiceStore.getState().openProgram(suggested.program.id).then((r) => { if (r === "unsaved") toast.warning(unsavedOpenWords().title, { description: unsavedOpenWords().description }); else if (r !== "ok") toast.error("Could not open service", { description: useServiceStore.getState().error ?? undefined }) })}>
                  Open
                </Button>
              </div>
            )}
            {programs.length === 0 ? (
              <p className="text-xs text-muted-foreground">None yet. Create one in Prepare to keep a rundown for Sunday.</p>
            ) : (
              <ul className="divide-y divide-border">
                {recentServices(programs).map((p) => (
                  <li key={p.id} className="flex items-center gap-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {p.title}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {p.service_date ?? "undated"} · {savedServiceCount(p)}{approvalState(p) === "approved" ? " · approved" : approvalState(p) === "changed" ? " · changed since approval" : ""}
                      </span>
                    </span>
                    {current?.id === p.id ? (
                      <span className="text-xs text-muted-foreground">open</span>
                    ) : (
                      <Button size="sm" variant="outline" disabled={dirty} title={dirty ? "Save or close the current service first" : undefined}
                        onClick={() => void useServiceStore.getState().openProgram(p.id).then((r) => { if (r === "unsaved") toast.warning(unsavedOpenWords().title, { description: unsavedOpenWords().description }); else if (r !== "ok") toast.error("Could not open service", { description: useServiceStore.getState().error ?? undefined }) })}>
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
