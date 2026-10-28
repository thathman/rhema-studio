import { outputOnAir } from "@/lib/output-on-air"
import { validTimeZone } from "@/lib/church-time"
import { useEffect, useRef, useState } from "react"
import { useApprovalGateStore } from "@/stores/approval-gate-store"
import { useSettingsStore } from "@/stores/settings-store"
import { approvalState } from "@/lib/approval"
import { localDate, todaysService } from "@/lib/todays-service"
import { monitorProblems, resolveMonitorIndex } from "@/lib/monitor-health"
import { useObsStore } from "@/stores/obs-store"
import { useJoin } from "@/stores/join-store"
import { lanAddressNow, watchLanAddressAtService } from "@/lib/lan-address"
import { fontsMissingYoruba } from "@/lib/yoruba-fonts"
import { contentStatus } from "@/lib/song-files"
import { useMonitorStore } from "@/stores/monitor-store"
import { allSignageIds } from "@/lib/signage"
import { tickerOnly } from "@/lib/feed-presets"
import { useBibleStore, useBroadcastStore, useQueueStore, useTranscriptStore } from "@/stores"
import { useShellStore } from "@/studio/shell-store"
import { useServiceStore } from "@/stores/service-store"
import { computeReadiness, overscanReminder, planCheck, serviceStartsSoon } from "@/studio/readiness"
import { useEventClock } from "@/stores/event-clock-store"
import { useSongStore } from "@/stores/song-store"
import { isAudioItem, isImageItem, isSongItem } from "@/types"
import { useMediaStore } from "@/stores/media-store"
import { fontAvailable, missingThemeFonts } from "@/lib/brand-kit"
import { themeIdsOf } from "@/lib/output-themes"
import { useRouterHealth } from "@/lib/cameras"
import { cameraHealth, cameraWords, useFeedHealthStore } from "@/lib/show-health"
import { invoke } from "@tauri-apps/api/core"
import { lookCounting } from "@/lib/countdown-display"
import { presenceRows, readHostStatus, type HostStatus } from "@/lib/host-presence"
import { roleLabel } from "@/lib/remote-roles"
import { useAuxTimers } from "@/stores/aux-timers-store"
import { monotonicNow, useTimerStore } from "@/stores/timer-store"
import { useDismissedChecks } from "@/studio/dismissed-checks"

watchLanAddressAtService()

/**
 * Is the service ready? The readiness checks (FR-08) for any view: Home's "Your attention" and
 * Production's Show health use the same answer. Looks up songs and media files as needed.
 */
export function useReadiness() {
  const translations = useBibleStore((s) => s.translations)
  const themes = useBroadcastStore((s) => s.themes)
  const activeThemeId = useBroadcastStore((s) => s.activeThemeId)
  const outputs = useBroadcastStore((s) => s.outputs)
  const scenes = useBroadcastStore((s) => s.scenes)
  const outputStatus = useBroadcastStore((s) => s.outputStatus)
  const items = useQueueStore((s) => s.items)
  const headers = useQueueStore((s) => s.headers)
  const activeIndex = useQueueStore((s) => s.activeIndex)
  const listening = useTranscriptStore((s) => s.isTranscribing)
  const programs = useServiceStore((s) => s.programs)
  const current = useServiceStore((s) => s.current)
  const dirty = useServiceStore((s) => s.dirty)
  const missingTranslations = useServiceStore((s) => s.missingTranslations)
  const overrideTranslations = useBibleStore((s) => s.overrideServiceTranslations)
  const unsupportedItems = useServiceStore((s) => s.unsupportedItems)
  const corruptItems = useServiceStore((s) => s.corruptItems)
  const suggested = todaysService(programs, localDate())
  const monitorCount = useMonitorStore((s) => s.count)
  const monitorNames = useMonitorStore((s) => s.names)
  const monitorSizes = useMonitorStore((s) => s.sizes)
  const primaryMonitor = useMonitorStore((s) => s.primary)
  // OBS (#197): optional; its own state as OBS reported it.
  const obsSettings = useSettingsStore((s) => s.obs)
  const obsProfiles = useSettingsStore((s) => s.obsProfiles)
  const obsStatus = useObsStore((s) => s.status)
  const obsError = useObsStore((s) => s.error)
  const obsStream = useObsStore((s) => s.stream)
  const obsRecord = useObsStore((s) => s.recordOutput)
  const rehearsal = useBroadcastStore((s) => s.rehearsal)
  const cloudSpeech = useSettingsStore((s) => s.sttProvider === "deepgram")
  const lanAtService = useSettingsStore((s) => s.lanAddressAtService)
  const joinStatus = useJoin((s) => s.status)
  const clockSkewMs = useJoin((s) => s.clockSkewMs)
  const [contentError, setContentError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    contentStatus().then((s) => { if (!cancelled) setContentError(s.available ? null : (s.error ?? null)) }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  // Cameras and browser feeds as the signal watch last saw them (#213; Home, Present, Production).
  const cameras = useSettingsStore((s) => s.cameras)
  const zone = validTimeZone(useSettingsStore((s) => s.setup.timeZone))
  const router = useRouterHealth()
  const feeds = useFeedHealthStore()
  const isLive = useBroadcastStore((s) => s.isLive)
  const eventId = useEventClock((s) => s.currentId)
  // The time, once a minute: enough to notice the service coming within two hours.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  // This computer's network address, looked at once a minute with the time.
  const [lan, setLan] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void lanAddressNow().then((ip) => { if (live) setLan(ip) })
    return () => { live = false }
  }, [now])
  // Timers and the countdown display (#213): what a countdown shows, and which extra timers' desks are here.
  const countdownLook = useBroadcastStore((s) => s.countdownLook)
  const countdownSources = useBroadcastStore((s) => s.countdownSources)
  const countdownTargets = useBroadcastStore((s) => s.countdowns)
  const serviceTimer = useTimerStore((s) => s.timer)
  const auxTimers = useAuxTimers((s) => s.timers)
  const pairedDevices = useSettingsStore((s) => s.remoteDevices)
  const ownedTimers = auxTimers.filter((t) => t.owner)
  const watchDesks = ownedTimers.length > 0 && pairedDevices.length > 0 && joinStatus === "off"
  const [host, setHost] = useState<HostStatus | null>(null)
  useEffect(() => {
    if (!watchDesks) return
    let live = true
    void invoke<unknown>("host_status").then((v) => { if (live) setHost(readHostStatus(v)) }).catch(() => {})
    return () => { live = false }
  }, [watchDesks, now])
  const dismissed = useDismissedChecks((s) => s.keys)
  const setWorkspace = useShellStore((s) => s.setWorkspace)
  const openOutputs = useShellStore((s) => s.openOutputs)

  const onAir = outputs.filter((o) => outputOnAir(o, outputStatus[o.id])).length
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
  const mediaIds = [...new Set(items.flatMap((i) => [isImageItem(i) ? i.image.media_id : isAudioItem(i) ? i.audio.media_id : null, i.background?.media_id ?? null]).filter((x): x is string => x !== null))]
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
  // The fonts the outputs' looks draw with, measured for Yorùbá letters (#213); each set once.
  const lookFonts = [...new Set(themes.filter((t) => outputs.some((o) => themeIdsOf(o).includes(t.id))).flatMap((t) => [t.verseText.fontFamily, t.reference.fontFamily]).filter((f): f is string => !!f && fontAvailable(f)))].sort()
  const [yoruba, setYoruba] = useState<{ key: string; missing: string[] } | null>(null)
  const fontKey = lookFonts.join("\u0000")
  useEffect(() => {
    let live = true
    if (!fontKey) return
    void fontsMissingYoruba(fontKey.split("\u0000")).then((missing) => { if (live && missing) setYoruba({ key: fontKey, missing }) }).catch(() => {})
    return () => { live = false }
  }, [fontKey])
  // Each display output on its monitor (#213): the size the system reports, and whether it is the main screen.
  const displays = outputs.filter((o) => o.type === "display")
  const screens = monitorSizes.length === 0 ? undefined : displays.flatMap((o) => {
    const at = resolveMonitorIndex(o, monitorNames, displays)
    const size = at === null ? undefined : monitorSizes[at]
    return at === null || !size ? [] : [{ name: o.name, role: o.role ?? "congregation", monitor: monitorNames[at] ?? null, width: size.width, height: size.height, onMain: primaryMonitor === at && monitorSizes.length > 1 }]
  })
  const obsLabel = obsProfiles.find((p) => p.host.trim().toLowerCase() === obsSettings.host.trim().toLowerCase() && p.port === obsSettings.port)?.label ?? null
  const { ready, checks } = computeReadiness({
    translationsLoaded: translations.length,
    activeThemeName: themes.find((t) => t.id === activeThemeId)?.name ?? null,
    outputsConfigured: outputs.length,
    outputsOnAir: onAir,
    outputs: outputs.map((o) => ({
      name: o.name,
      role: o.role ?? "congregation",
      kind: o.type,
      on: outputOnAir(o, outputStatus[o.id]),
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
    corruptItems: corruptItems.length,
    timing: planCheck(items, headers, zone),
    camerasWithoutAddress: scenes.filter((sc) => sc.layers.some((l) => l.kind === "camera" && !l.cameraUrl)).map((sc) => sc.name),
    camerasNotSending: cameraHealth(cameras, scenes, outputs, outputStatus, router.checked ? router.status : undefined)
      .filter((c) => c.assigned.length > 0 && (c.state === "not-sending" || c.state === "router-off"))
      .map((c) => ({ camera: cameraWords(c.label), outputs: c.assigned, onAir: c.onAir.length > 0, routerOff: c.state === "router-off" })),
    // The service's date and the main service's start time (#298 H6): planning days ahead is not "not ready".
    serviceSoon: serviceStartsSoon({
      serviceDate: current?.service_date,
      startsAt: (headers.find((h) => h.type === "phase" && h.role === "main") ?? headers.find((h) => h.type === "phase" && h.rule === "manual"))?.starts_at,
      running: isLive || eventId !== null,
      now,
    }),
    obs: { enabled: obsSettings.enabled, status: obsStatus, error: obsError, label: obsLabel, stream: obsStream, record: obsRecord, rehearsal },
    internet: { cloudSpeech },
    lan: lan ? { now: lan, atLastService: lanAtService } : undefined,
    screens,
    yorubaFonts: yoruba && yoruba.key === fontKey ? { checked: lookFonts, missing: yoruba.missing } : null,
    clock: { year: new Date(now).getFullYear(), skewMs: joinStatus === "connected" ? clockSkewMs : null, reference: joinStatus === "connected" ? "the host's" : null },
    countdownIdle: (() => {
      const shows = outputs.filter((o) => o.role === "stage" && o.stageLayout === "countdown" && outputOnAir(o, outputStatus[o.id]))
      if (shows.length === 0) return []
      const c = lookCounting(countdownLook, countdownSources, serviceTimer, monotonicNow(), now, zone, countdownTargets)
      return c.idle ? shows.map((o) => ({ output: o.name, why: c.idle! })) : []
    })(),
    timersOwnerAway: (() => {
      if (!watchDesks || !host?.running) return []
      const here = new Set<string>(presenceRows(pairedDevices, host.desks).filter((r) => r.device && r.seen?.connected).map((r) => r.device!.role ?? "configure"))
      return ownedTimers.filter((t) => !here.has(t.owner)).map((t) => ({ timer: t.label, role: roleLabel(t.owner) }))
    })(),
    // TVs zoom the picture (#213 overscan): a reminder for on-air browser feeds with no Overscan set, once per service.
    overscan: overscanReminder(outputs.filter((o) => outputOnAir(o, outputStatus[o.id])), `overscan:${current?.id ?? localDate()}`, dismissed),
    feedsUnwatched: outputs.filter((o) => o.type === "browser" && outputOnAir(o, outputStatus[o.id]) && feeds[o.id]?.watching === 0).map((o) => o.name),
    signage: outputs
      // A ticker feed (Rhema Ticker | Alpha) has no pictures on purpose.
      .filter((o) => o.role === "signage" && !tickerOnly(o, allSignageIds(o.signage).length, themes.find((t) => t.id === o.themeId)))
      .map((o) => {
        const ids = allSignageIds(o.signage)
        return { name: o.name, total: ids.length, missing: mediaLoaded ? ids.filter((id) => !mediaAssets.find((a) => a.id === id)?.present).length : 0 }
      }),
  })
  return { ready, checks, onAir, items, headers, activeIndex, current, dirty, programs, suggested, outputs, setWorkspace, openOutputs }
}

