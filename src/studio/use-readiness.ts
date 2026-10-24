import { outputOnAir } from "@/lib/output-on-air"
import { useEffect, useRef, useState } from "react"
import { useApprovalGateStore } from "@/stores/approval-gate-store"
import { useSettingsStore } from "@/stores/settings-store"
import { approvalState } from "@/lib/approval"
import { localDate, todaysService } from "@/lib/todays-service"
import { monitorProblems } from "@/lib/monitor-health"
import { contentStatus } from "@/lib/song-files"
import { useMonitorStore } from "@/stores/monitor-store"
import { allSignageIds } from "@/lib/signage"
import { tickerOnly } from "@/lib/feed-presets"
import { useBibleStore, useBroadcastStore, useQueueStore, useTranscriptStore } from "@/stores"
import { useShellStore } from "@/studio/shell-store"
import { useServiceStore } from "@/stores/service-store"
import { computeReadiness, planCheck } from "@/studio/readiness"
import { useSongStore } from "@/stores/song-store"
import { isImageItem, isSongItem } from "@/types"
import { useMediaStore } from "@/stores/media-store"
import { fontAvailable, missingThemeFonts } from "@/lib/brand-kit"
import { themeIdsOf } from "@/lib/output-themes"
import { useRouterHealth } from "@/lib/cameras"
import { cameraHealth, cameraWords, useFeedHealthStore } from "@/lib/show-health"

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
  const suggested = todaysService(programs, localDate())
  const monitorCount = useMonitorStore((s) => s.count)
  const monitorNames = useMonitorStore((s) => s.names)
  const [contentError, setContentError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    contentStatus().then((s) => { if (!cancelled) setContentError(s.available ? null : (s.error ?? null)) }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  // Cameras and browser feeds as the signal watch last saw them (#213; Home, Present, Production).
  const cameras = useSettingsStore((s) => s.cameras)
  const router = useRouterHealth()
  const feeds = useFeedHealthStore()
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
    timing: planCheck(items, headers),
    camerasWithoutAddress: scenes.filter((sc) => sc.layers.some((l) => l.kind === "camera" && !l.cameraUrl)).map((sc) => sc.name),
    camerasNotSending: cameraHealth(cameras, scenes, outputs, outputStatus, router.checked ? router.status : undefined)
      .filter((c) => c.assigned.length > 0 && (c.state === "not-sending" || c.state === "router-off"))
      .map((c) => ({ camera: cameraWords(c.label), outputs: c.assigned, onAir: c.onAir.length > 0, routerOff: c.state === "router-off" })),
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

