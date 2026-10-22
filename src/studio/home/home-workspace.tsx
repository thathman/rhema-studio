import { useApprovalGateStore } from "@/stores/approval-gate-store"
import { useSettingsStore } from "@/stores/settings-store"
import { approvalState } from "@/lib/approval"
import { localDate, todaysService } from "@/lib/todays-service"
import { monitorProblems } from "@/lib/monitor-health"
import { contentStatus } from "@/lib/song-files"
import { useMonitorStore } from "@/stores/monitor-store"
import { allSignageIds } from "@/lib/signage"
import { useEffect, useRef, useState } from "react"
import { ArrowRightIcon, BookOpenIcon, CalendarDaysIcon, CheckIcon, ChevronRightIcon, ImageIcon, InfoIcon, MonitorIcon, MusicIcon, PencilRulerIcon, PlayIcon, PresentationIcon, SettingsIcon, TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { openSettings } from "@/lib/settings-dialog"
import { useBibleStore, useBroadcastStore, useQueueStore, useTranscriptStore } from "@/stores"
import { useShellStore } from "@/studio/shell-store"
import { useServiceStore } from "@/stores/service-store"
import { computeReadiness, type ReadinessCheck, type ReadinessFix } from "@/studio/readiness"
import { useSongStore } from "@/stores/song-store"
import { isImageItem, isSongItem } from "@/types"
import { useMediaStore } from "@/stores/media-store"
import { fontAvailable, missingThemeFonts } from "@/lib/brand-kit"
import { themeIdsOf } from "@/lib/output-themes"
import { ChurchFolderCard } from "@/studio/home/church-folder-card"

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
  const translations = useBibleStore((s) => s.translations)
  const themes = useBroadcastStore((s) => s.themes)
  const activeThemeId = useBroadcastStore((s) => s.activeThemeId)
  const outputs = useBroadcastStore((s) => s.outputs)
  const outputStatus = useBroadcastStore((s) => s.outputStatus)
  const items = useQueueStore((s) => s.items)
  const activeIndex = useQueueStore((s) => s.activeIndex)
  const listening = useTranscriptStore((s) => s.isTranscribing)
  const programs = useServiceStore((s) => s.programs)
  const current = useServiceStore((s) => s.current)
  const dirty = useServiceStore((s) => s.dirty)
  const missingTranslations = useServiceStore((s) => s.missingTranslations)
  const overrideTranslations = useBibleStore((s) => s.overrideServiceTranslations)
  const unsupportedItems = useServiceStore((s) => s.unsupportedItems)
  const suggested = todaysService(programs, localDate())
  const monitorCount = useMonitorStore((s) => s.count)
  const monitorNames = useMonitorStore((s) => s.names)
  const [contentError, setContentError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    contentStatus().then((s) => { if (!cancelled) setContentError(s.available ? null : (s.error ?? null)) }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  const setWorkspace = useShellStore((s) => s.setWorkspace)
  const openOutputs = useShellStore((s) => s.openOutputs)

  const onAir = outputs.filter((o) => outputStatus[o.id]?.previewOpen || outputStatus[o.id]?.ndiActive).length
  const songs = useSongStore((s) => s.songs)
  const missing = useSongStore((s) => s.missing)
  const songIds = [...new Set(items.filter(isSongItem).map((i) => i.song.song_id))]
  const unknownLicenceSongs = songIds.filter((id) => songs[id]?.song.licence === "unknown").length
  const missingSongs = songIds.filter((id) => missing.includes(id)).length
  const mediaAssets = useMediaStore((s) => s.assets)
  const mediaLoaded = useMediaStore((s) => s.loaded)
  const mediaLoading = useMediaStore((s) => s.loading)
  // Asked already and presented anyway this session: the gate will not ask again.
  const gateAcknowledged = useApprovalGateStore((s) => (current ? s.acknowledged.includes(current.id) : false))
  const requireApproval = useSettingsStore((s) => s.requireApproval) && !gateAcknowledged
  // Pictures, videos and sounds, and every item's background picture (FR-08: all assets local before Ready).
  const mediaIds = [...new Set(items.flatMap((i) => [isImageItem(i) ? i.image.media_id : null, i.background?.media_id ?? null]).filter((x): x is string => x !== null))]
  const hasSignage = outputs.some((o) => o.role === "signage")
  const missingMedia = mediaIds.filter((id) => !mediaAssets.find((a) => a.id === id)?.present).length
  // Load the media list once, and again when the service names a file it does not know yet
  // (a service opened from the church folder brings new pictures): never a false "missing".
  const unknownIds = mediaLoaded ? mediaIds.filter((id) => !mediaAssets.some((a) => a.id === id)).join(",") : ""
  // Each set of unknown ids is looked up once: an id that is really gone stays "missing" without reloading forever.
  const lookedUp = useRef("")
  useEffect(() => {
    const needs = !mediaLoaded || (unknownIds !== "" && unknownIds !== lookedUp.current)
    if ((mediaIds.length > 0 || hasSignage) && needs && !mediaLoading) {
      lookedUp.current = unknownIds
      void useMediaStore.getState().list()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per set of ids
  }, [mediaIds.join(","), hasSignage, mediaLoaded, mediaLoading, unknownIds])
  // Each visit to Home checks the files again: one deleted since the list was loaded shows as missing.
  useEffect(() => {
    const m = useMediaStore.getState()
    if (m.loaded && !m.loading && (mediaIds.length > 0 || hasSignage)) void m.list()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per visit
  }, [])
  // Home is the readiness check: make sure every song in the service has been looked up.
  useEffect(() => {
    for (const id of songIds) if (!songs[id] && !missing.includes(id)) void useSongStore.getState().load(id).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ids only
  }, [songIds.join(",")])
  const { ready, checks } = computeReadiness({
    translationsLoaded: translations.length,
    activeThemeName: themes.find((t) => t.id === activeThemeId)?.name ?? null,
    outputsConfigured: outputs.length,
    outputsOnAir: onAir,
    outputs: outputs.map((o) => ({
      name: o.name,
      role: o.role ?? "congregation",
      kind: o.type,
      on: Boolean(outputStatus[o.id]?.previewOpen || outputStatus[o.id]?.ndiActive),
      error: outputStatus[o.id]?.ndiError ?? null,
      receivers: outputStatus[o.id]?.ndiReceivers ?? null,
    })),
    rundownCount: items.length,
    listening,
    unknownLicenceSongs,
    missingSongs,
    missingMedia: mediaLoaded || mediaIds.length === 0 ? missingMedia : 0,
    // Only the themes outputs actually use.
    missingFonts: missingThemeFonts(themes.filter((t) => outputs.some((o) => themeIdsOf(o).includes(t.id))), fontAvailable),
    monitors: monitorCount === null ? undefined : monitorProblems(outputs, monitorNames.length === monitorCount ? monitorNames : monitorCount),
    contentError,
    // Unsaved edits change an approved service; a service never approved stays "not approved yet".
    approval: current ? (dirty && approvalState(current) !== "none" ? "changed" : approvalState(current)) : undefined,
    requireApproval,
    // With "Use my translation" on, those verses show in the operator's translation.
    missingTranslations: overrideTranslations ? [] : missingTranslations,
    unsupportedItems: unsupportedItems.length,
    signage: outputs
      .filter((o) => o.role === "signage")
      .map((o) => {
        const ids = allSignageIds(o.signage)
        return { name: o.name, total: ids.length, missing: mediaLoaded ? ids.filter((id) => !mediaAssets.find((a) => a.id === id)?.present).length : 0 }
      }),
  })

  const fix = (f: ReadinessFix) => {
    if (f === "outputs") openOutputs()
    else if (f === "prepare") setWorkspace("prepare")
    else openSettings("diagnostics")
  }

  const next = items[activeIndex === null ? 0 : Math.min(activeIndex + 1, items.length - 1)]
  // Warnings need something done; notes ("Listening is off") are listed but not counted against readiness.
  const okCount = checks.filter((c) => c.status === "ok").length
  const warnings = checks.filter((c) => c.status === "warn")
  const attention = checks.filter((c) => c.status !== "ok")
  const counted = okCount + warnings.length
  const minutes = items.reduce((m, i) => m + (i.planned_minutes ?? 0), 0)
  const operatorName = useSettingsStore((s) => s.operatorName).trim()
  const comingUp = current?.service_date ? new Date(`${current.service_date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" }) : null

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1700px] flex-col gap-5 px-8 pt-7 pb-16 max-[1200px]:px-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[0.6875rem] font-bold tracking-[0.12em] text-muted-foreground uppercase">Your Sunday workspace</p>
            <h1 className="mt-1 text-[1.75rem] leading-tight font-bold tracking-[-0.035em]">{greeting()}{operatorName ? `, ${operatorName.split(/\s+/)[0]}` : ""}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })} · everything for this Sunday's service, right where you need it.</p>
          </div>
        </header>

        <section aria-labelledby="quick" className="grid grid-cols-[minmax(0,1fr)_17rem] gap-6 rounded-xl border border-border bg-card p-6 shadow-panel max-[1100px]:grid-cols-1">
          <div className="min-w-0">
            <p className="text-[0.6875rem] font-bold tracking-[0.12em] text-muted-foreground uppercase">{comingUp ? `Coming up · ${comingUp}` : current ? "This service" : "No service open"}</p>
            <h2 id="quick" className="mt-1.5 truncate text-[1.625rem] leading-tight font-bold tracking-[-0.03em]">{current ? current.title : "Plan Sunday's service"}</h2>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              {items.length === 0
                ? "Start the service in Prepare: passages, songs, hymns, slides and pictures, in order. Nothing goes on a screen until you show it live."
                : ready
                  ? "Ready. Turn the screens on and run it from the live console."
                  : "Taking shape. Finish what is listed under Your attention, then run it from the live console."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => setWorkspace("prepare")} className="h-10 px-4"><PencilRulerIcon /> {items.length ? "Continue preparing" : "Prepare a service"}</Button>
              <Button variant="outline" onClick={() => setWorkspace("present")} className="h-10 px-4"><PlayIcon /> Open live console</Button>
              <Button variant="ghost" onClick={openOutputs} className="h-10 px-3"><MonitorIcon /> Outputs</Button>
              <Button variant="ghost" onClick={() => openSettings()} className="h-10 px-3"><SettingsIcon /> Settings</Button>
            </div>
          </div>
          <div className="flex flex-col justify-center border-l border-border pl-6 max-[1100px]:border-t max-[1100px]:border-l-0 max-[1100px]:pt-4 max-[1100px]:pl-0">
            <p className="text-xs text-muted-foreground">Readiness</p>
            <p className="mt-1 text-xl font-bold tracking-[-0.03em]">{ready ? "Ready" : warnings.length <= 2 ? "Almost ready" : "Not ready yet"}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{ready ? "Everything checks out." : `${warnings.length} ${warnings.length === 1 ? "thing" : "things"} to check`}</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Readiness checks" aria-valuemin={0} aria-valuemax={counted} aria-valuenow={okCount}>
              <div className="h-full rounded-full bg-primary" style={{ width: `${counted ? (okCount / counted) * 100 : 0}%` }} />
            </div>
            <p className="mt-1.5 text-[0.6875rem] text-muted-foreground">{okCount} of {counted} checks complete</p>
          </div>
        </section>

        <div className="grid grid-cols-3 gap-4 max-[900px]:grid-cols-1">
          <Stat icon={<CalendarDaysIcon />} label="Sunday plan" value={String(items.length)} unit={items.length === 1 ? "item" : "items"} detail={current ? `${current.title}${minutes ? ` · ${minutes} min planned` : ""}${dirty ? " · unsaved changes" : ""}` : "No saved service open"} />
          <Stat icon={<CheckIcon />} label="Content readiness" value={String(counted ? Math.round((okCount / counted) * 100) : 0)} unit="%" detail={ready ? "Ready to present" : `${warnings.length} to check`} />
          <Stat icon={<MonitorIcon />} label="Screens" value={String(onAir)} unit={`of ${outputs.length} on`} detail={onAir ? "On air when you show something live" : "Turn them on in Outputs"} />
        </div>

        <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-5 max-[1100px]:grid-cols-1">
          <section aria-labelledby="glance" className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 id="glance" className="text-[1.1875rem] font-bold tracking-[-0.035em]">Sunday at a glance</h2>
              <Button variant="ghost" size="sm" onClick={() => setWorkspace("prepare")}>Full rundown <ArrowRightIcon /></Button>
            </div>
            <div className="rounded-xl border border-border bg-card p-3 shadow-panel">
              {items.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">Nothing in the service yet. Open Prepare to add passages, songs and slides.</p>
              ) : (
                <ol className="divide-y divide-border">
                  {items.slice(0, 6).map((it, i) => (
                    <li key={it.id}>
                      <button type="button" onClick={() => setWorkspace("prepare")} className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50">
                        <span className="flex h-8 w-11 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-bold text-muted-foreground tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                        <KindTile item={it} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{it.reference}</span>
                          <span className="block truncate text-xs text-muted-foreground">{kindLabel(it)}{it.planned_minutes ? ` · ${it.planned_minutes} min` : ""}{next?.id === it.id && activeIndex !== null ? " · next" : ""}</span>
                        </span>
                        <ChevronRightIcon className="size-4 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              {items.length > 6 && <p className="px-2 pt-2 text-xs text-muted-foreground">and {items.length - 6} more in the full rundown</p>}
            </div>
          </section>

          <div className="flex flex-col gap-5">
            <section aria-labelledby="readiness" className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 id="readiness" className="text-[1.1875rem] font-bold tracking-[-0.035em]">Your attention</h2>
                <span className={cn("text-xs font-semibold", ready ? "text-confidence-high" : "text-confidence-mid")}>{ready ? "Ready to present" : "Needs attention"}</span>
              </div>
              <ul className="divide-y divide-border rounded-xl border border-border bg-card px-4 shadow-panel">
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
                  </li>
                ))}
              </ul>
              {attention.length > 0 && okCount > 0 && <p className="text-xs text-muted-foreground">{okCount} other {okCount === 1 ? "check is" : "checks are"} fine.</p>}
            </section>

            <ChurchFolderCard />
            <section aria-labelledby="services" className="rounded-xl border border-border bg-card p-4 shadow-panel">
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
    <div className="rounded-xl border border-border bg-card p-5 shadow-panel">
      <p className="flex items-center gap-2 text-xs text-muted-foreground [&_svg]:size-4">{icon}{label}</p>
      <p className="mt-3 text-[1.75rem] leading-none font-bold tracking-[-0.04em]">{value}<span className="ml-1 text-sm font-semibold tracking-normal text-muted-foreground">{unit}</span></p>
      <p className="mt-2 truncate text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

type Item = ReturnType<typeof useQueueStore.getState>["items"][number]

function kindLabel(it: Item): string {
  if (isSongItem(it)) return "Song"
  if (it.kind === "slide") return "Slide"
  if (isImageItem(it)) return "Picture or video"
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
