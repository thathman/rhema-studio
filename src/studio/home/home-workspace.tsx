import { approvalState } from "@/lib/approval"
import { localDate, todaysService } from "@/lib/todays-service"
import { allSignageIds } from "@/lib/signage"
import { useEffect } from "react"
import { CheckIcon, TriangleAlertIcon, InfoIcon, PlayIcon, PencilRulerIcon, MonitorIcon, SettingsIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { openSettings } from "@/lib/settings-dialog"
import { useBibleStore, useBroadcastStore, useQueueStore, useTranscriptStore } from "@/stores"
import { useShellStore } from "@/studio/shell-store"
import { useServiceStore } from "@/stores/service-store"
import { WorkspaceHeader } from "@/studio/ui/status-chip"
import { computeReadiness, type ReadinessCheck, type ReadinessFix } from "@/studio/readiness"
import { useSongStore } from "@/stores/song-store"
import { isImageItem, isSongItem } from "@/types"
import { useMediaStore } from "@/stores/media-store"
import { fontAvailable, missingThemeFonts } from "@/lib/brand-kit"

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
  const suggested = todaysService(programs, localDate())
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
  const mediaIds = [...new Set(items.filter(isImageItem).map((i) => i.image.media_id))]
  const hasSignage = outputs.some((o) => o.role === "signage")
  const missingMedia = mediaIds.filter((id) => !mediaAssets.find((a) => a.id === id)?.present).length
  useEffect(() => {
    if ((mediaIds.length > 0 || hasSignage) && !mediaLoaded && !mediaLoading) void useMediaStore.getState().list()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per set of ids
  }, [mediaIds.join(","), hasSignage, mediaLoaded, mediaLoading])
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
    })),
    rundownCount: items.length,
    listening,
    unknownLicenceSongs,
    missingSongs,
    missingMedia: mediaLoaded || mediaIds.length === 0 ? missingMedia : 0,
    // Only the themes outputs actually use.
    missingFonts: missingThemeFonts(themes.filter((t) => outputs.some((o) => o.themeId === t.id)), fontAvailable),
    approval: current ? (dirty ? "changed" : approvalState(current)) : undefined,
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

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader
        title={greeting()}
        subtitle={new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="readiness" className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 id="readiness" className="text-sm font-semibold">Service readiness</h2>
            <span className={cn("text-xs font-medium", ready ? "text-confidence-high" : "text-confidence-mid")}>
              {ready ? "Ready to present" : "Needs attention"}
            </span>
          </div>
          <ul className="divide-y divide-border">
            {checks.map((c) => (
              <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5">{ICON[c.status]}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{c.label}</p>
                  {c.detail && <p className="text-xs text-muted-foreground">{c.detail}</p>}
                </div>
                {c.fix && c.status !== "ok" && (
                  <Button size="sm" variant="outline" onClick={() => fix(c.fix!)}>
                    {c.fixLabel ?? "Fix"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <div className="flex flex-col gap-4">
          <section aria-labelledby="quick" className="rounded-lg border border-border bg-card p-4">
            <h2 id="quick" className="mb-3 text-sm font-semibold">Quick actions</h2>
            <div className="grid grid-cols-2 gap-2">
              <Button className="h-12 justify-start" onClick={() => setWorkspace("present")}>
                <PlayIcon /> Open Present
              </Button>
              <Button variant="outline" className="h-12 justify-start" onClick={() => setWorkspace("prepare")}>
                <PencilRulerIcon /> Prepare service
              </Button>
              <Button variant="outline" className="h-12 justify-start" onClick={openOutputs}>
                <MonitorIcon /> Outputs
              </Button>
              <Button variant="outline" className="h-12 justify-start" onClick={() => openSettings()}>
                <SettingsIcon /> Settings
              </Button>
            </div>
          </section>

          <section aria-labelledby="service" className="rounded-lg border border-border bg-card p-4">
            <h2 id="service" className="mb-1 text-sm font-semibold">
              {current ? current.title : "This service"}
              {current?.service_date && <span className="ml-2 text-xs font-normal text-muted-foreground">{current.service_date}</span>}
              {dirty && <span className="ml-2 text-xs font-normal text-confidence-mid">unsaved changes</span>}
            </h2>
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nothing in the service yet. Open Prepare to add passages.
              </p>
            ) : (
              <>
                <p className="mb-2 text-xs text-muted-foreground">
                  {items.length} item{items.length === 1 ? "" : "s"}
                  {next ? ` · next: ${next.reference}` : ""}
                </p>
                <ol className="space-y-1 text-sm">
                  {items.slice(0, 6).map((it, i) => (
                    <li key={it.id} className="flex gap-2 truncate">
                      <span className="w-5 text-right text-muted-foreground">{i + 1}</span>
                      <span className="truncate">{it.reference}</span>
                    </li>
                  ))}
                  {items.length > 6 && (
                    <li className="text-xs text-muted-foreground">and {items.length - 6} more</li>
                  )}
                </ol>
              </>
            )}
          </section>

          <section aria-labelledby="services" className="rounded-lg border border-border bg-card p-4">
            <h2 id="services" className="mb-2 text-sm font-semibold">Saved services</h2>
            {!current && suggested && (
              <div className="mb-3 flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 p-2">
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block truncate font-medium">{suggested.program.title}</span>
                  <span className="block text-xs text-muted-foreground">{suggested.why === "approved today" ? "Today's service, approved" : suggested.why === "today" ? "Dated today, not approved yet" : `Next approved service · ${suggested.program.service_date}`}</span>
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
                {programs.slice(0, 5).map((p) => (
                  <li key={p.id} className="flex items-center gap-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {p.title}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {p.service_date ?? "undated"} · {p.item_count} item{p.item_count === 1 ? "" : "s"}{approvalState(p) === "approved" ? " · approved" : ""}
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
  )
}
