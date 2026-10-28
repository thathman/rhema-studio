import { create } from "zustand"
import { emitTo } from "@tauri-apps/api/event"
import { invoke } from "@tauri-apps/api/core"
import { load, type Store } from "@tauri-apps/plugin-store"
import type {
  SongWithSections,
  BroadcastOutput,
  BroadcastOutputStatus,
  BroadcastTheme,
  Verse,
  VerseRenderData, LowerThird, LowerThirdStyle, StageAux, StageClock, StageFinish, StageStyle, Ticker, TickerPreset, TickerStyle, CountdownLook, HostLostRule, ReceiverTv } from "@/types"
import { MAIN_OUTPUT_ID, defaultNdiSettings, outputWindowLabel } from "@/types"
import { BUILTIN_THEMES, LOWER_THIRDS, CLASSIC_DARK } from "@/lib/builtin-themes"
import { normalizeTheme } from "@/lib/theme-migrations"
import type { ItemTranslations } from "@/lib/translation-policy"
import { applyBrandKit, type BrandKit } from "@/lib/brand-kit"
import { buildStagePayload } from "@/lib/stage"
import { applyStageStyle, DEFAULT_STAGE_STYLE, normalizeStageStyle } from "@/lib/stage-style"
import { useQueueStore } from "@/stores/queue-store"
import { monotonicNow, useTimerStore } from "@/stores/timer-store"
import type { TimerState } from "@/lib/timer"
import { useSongStore } from "@/stores/song-store"
import { markSkipped } from "@/lib/run-of-show"
import { forOutputLanguage } from "@/lib/output-language"
import { activePlaylist, signageFrame, signageIndex } from "@/lib/signage"
import { themeIdFor, themeIdsOf } from "@/lib/output-themes"
import { DEFAULT_LOWER_THIRD_STYLE, normalizeLowerThirdStyle, overlayFor } from "@/lib/lower-third-style"
import { DEFAULT_TICKER_STYLE, normalizePresets, normalizeTickerStyle } from "@/lib/ticker"
import { useMediaStore } from "@/stores/media-store"
import { feedLost, overscanPct } from "@/lib/feed-receivers"
import { cameraSourceId, feedFrame, followsLowerThird, followsOnlyOverlays, followsTicker, isStateSource, sourceOf, type AnySourceId, type LiveSources, type StateSource, type StateSourceId, type StateSources } from "@/lib/live-sources"
import { captureSceneAppearance, normalizeScene, presetFromScene, sceneClock, sceneForOutput, sceneFrame, sceneOwns } from "@/lib/scenes"
import { useSettingsStore } from "@/stores/settings-store"
import { cameraDownState, cameraLabelOf, useRouterHealth } from "@/lib/cameras"
import type { Scene, SceneAppearanceSnapshot, SceneFrame, SceneLayerKind } from "@/types"
import type { CountdownTargets } from "@/lib/countdown"
import { zoneCity } from "@/lib/stage-clock"
import { countdownFrame, countsToTarget, DEFAULT_COUNTDOWN_LOOK, lookCounting, NO_COUNTDOWN_SOURCES, normalizeCountdownLook, type CountdownSources } from "@/lib/countdown-display"
import { normalizeDesignDraft, normalizeDesignDrafts, type DesignDraft } from "@/lib/design-drafts"

/** Heard verses (Settings → Display mode, the Live panel's Auto): wait, go live, or the Bible feeds only. */
export type AutoMode = "manual" | "auto" | "bible"
export const autoModeOf = (s: { autoLive: boolean; autoBibleFeeds: boolean }): AutoMode => (s.autoLive ? "auto" : s.autoBibleFeeds ? "bible" : "manual")

/** The program (what is on air and what Restore and Back return to), with the rundown's place in it. */
export interface ProgramSnapshot {
  isLive: boolean
  liveVerse: VerseRenderData | null
  liveSourceVerse: Verse | null
  liveItem: ItemTranslations | null
  liveSlide: LiveSlide | null
  liveItemId: string | null
  heldLive: HeldLive | null
  cleared: boolean
  activeIndex: number | null
}

/** Rehearsal's sandbox (ADR 0001): the program plus what always comes back as it was. */
export interface RehearsalReturn extends ProgramSnapshot {
  lowerThird: LowerThird | null
  ticker: Ticker | null
  stageMessage: string
  timer: TimerState
  /** Each output's scene (by output id; an output not listed showed its own feed). */
  outputScenes: Record<string, string>
  /** The exact scene revision each public output had when rehearsal began. */
  outputSceneSnapshots: Record<string, Scene>
  outputSceneAppearances: Record<string, SceneAppearanceSnapshot>
  /** The scene each output's Restore offered. */
  sceneReturn: Record<string, string>
}

/** The outputs as the real screens have them: in rehearsal, each with the scene it had before (what is saved). */
export function outputsForScreens(s: { rehearsal: boolean; rehearsalReturn: RehearsalReturn | null; outputs: BroadcastOutput[] }): BroadcastOutput[] {
  return s.rehearsal && s.rehearsalReturn ? withScenes(s.outputs, s.rehearsalReturn.outputScenes, s.rehearsalReturn.outputSceneSnapshots, s.rehearsalReturn.outputSceneAppearances) : s.outputs
}

/** The outputs with these scenes on them (by output id); the rest back on their own feed. */
function withScenes(outputs: BroadcastOutput[], scenes: Record<string, string>, snapshots?: Record<string, Scene>, appearances?: Record<string, SceneAppearanceSnapshot>): BroadcastOutput[] {
  return outputs.map((o) => {
    const sceneId = scenes[o.id]
    const next: BroadcastOutput = { ...o }
    if (sceneId) next.sceneId = sceneId
    else delete next.sceneId
    const snapshot = snapshots?.[o.id] ?? (o.sceneSnapshot?.id === sceneId ? o.sceneSnapshot : undefined)
    if (snapshot) next.sceneSnapshot = snapshot
    else delete next.sceneSnapshot
    const appearance = appearances?.[o.id]
    if (appearance && sceneId) next.sceneAppearanceSnapshot = appearance
    else delete next.sceneAppearanceSnapshot
    return next
  })
}

/** The ticker the real screens show: in rehearsal, the one running before it. */
export function tickerForScreens(s: { rehearsal: boolean; rehearsalReturn: RehearsalReturn | null; ticker: Ticker | null }): Ticker | null {
  return s.rehearsal ? (s.rehearsalReturn?.ticker ?? null) : s.ticker
}

/** The service timer as the real screens have it: in rehearsal, the one from before it (still counting). */
export function timerForScreens(s: { rehearsal: boolean; rehearsalReturn: RehearsalReturn | null }, timer: TimerState = useTimerStore.getState().timer): TimerState {
  return s.rehearsal ? (s.rehearsalReturn?.timer ?? timer) : timer
}

/** What was live before a quick screen took over, so Back can return to it. */
export interface HeldLive {
  liveVerse: VerseRenderData
  liveSourceVerse: Verse | null
  liveItem: ItemTranslations | null
  liveSlide: LiveSlide | null
  liveItemId: string | null
  wasLive: boolean
  /** It had been cleared (off air, kept for Restore) when the quick screen went up. */
  wasCleared?: boolean
}

/** The song slide on the output: which rundown item, song and step. */
export interface LiveSlide {
  itemId: string
  songId: string
  index: number
  total: number
  /** The arrangement and languages the song went live with: stepping within it keeps them (RG-03). */
  arrangementId?: string | null
  languages?: string[]
  /** The song as it went live: words saved in the editor meanwhile apply the next time it is entered. */
  song?: SongWithSections
}

type SelectedElement = "verse" | "reference" | null

export type NewThemeLayoutKind = "fullscreen" | "lower-thirds"

interface BroadcastState {
  themes: BroadcastTheme[]
  /** Mirror of the main output's themeId, kept for existing consumers. */
  activeThemeId: string
  /** Every configured broadcast output; the "main" output is always present. */
  outputs: BroadcastOutput[]
  /** Runtime on-air state per output id. Not persisted. */
  outputStatus: Record<string, BroadcastOutputStatus>
  isLive: boolean
  liveVerse: VerseRenderData | null
  // The Verse the live output was presented from, kept so it can be
  // re-presented (e.g. after a translation change). Preview selection never
  // writes this — only an explicit present does.
  liveSourceVerse: Verse | null
  /** The rundown item's saved translations the live verse was presented under, if any. */
  liveItem: ItemTranslations | null
  /** Which song slide is live (or last was, for Restore); null when a verse is. */
  liveSlide: LiveSlide | null
  /** The rundown item the live content came from, if any. */
  liveItemId: string | null
  /** Set while a quick screen is up; what Back returns to. */
  heldLive: HeldLive | null
  /** Each kind of content's active value (ADR 0001). Session state, never changed in rehearsal. */
  sources: LiveSources
  /**
   * The ticker, the service timer and each camera as live sources (ADR 0001): who last changed each
   * and when; a ticker taken off keeps its words for Restore; a camera off is hidden from scenes.
   * Session state, never changed in rehearsal.
   */
  stateSources: StateSources
  /**
   * Take one source off (kept for Restore); the program goes off air too if it was showing it. The
   * ticker stops (its words kept), the timer pauses, a camera is hidden from scenes.
   */
  clearSource: (id: AnySourceId) => void
  /** Put a cleared source back on: the ticker runs again, the timer resumes, a camera is back in scenes. */
  restoreSource: (id: AnySourceId) => void
  /**
   * A camera's recovery controls (#213), on every screen whose scene has it: Retry (each screen
   * starts its reader again), Switch to backup (its backup camera, chosen in Production → Cameras,
   * plays in its place) and back, Freeze (hold the last frame) and Unfreeze. Recorded with who and
   * when like any source; never in rehearsal.
   */
  cameraControl: (name: string, change: CameraChange) => void
  /** Activate a source without changing the program (a heard verse while a song is up, C11). `by`: who (default: see currentActor). */
  activateSource: (value: VerseRenderData, itemId?: string | null, by?: string) => void
  /** Congregation scenes (ARCH-002). Saved. */
  scenes: Scene[]
  /** Add or replace a scene (by id); outputs showing it redraw. */
  saveScene: (scene: Scene) => void
  /** Remove a scene; outputs showing it go back to their own feed. */
  deleteScene: (id: string) => void
  /**
   * Take: put a scene on an output (its program). In rehearsal it stays in the app and is undone when
   * rehearsal ends. `by`: who took it (default: see currentActor).
   */
  takeScene: (outputId: string, sceneId: string, by?: string) => void
  /** Restore the exact scene/look and theme selection previously taken to this output. */
  restoreSceneSnapshot: (outputId: string, scene: Scene, appearance: SceneAppearanceSnapshot, themeSelection: Pick<BroadcastOutput, "themeId" | "themeFor">, by?: string) => void
  /** Take an immutable scene/look revision stored with an approved service revision. */
  takeSceneRevision: (outputId: string, scene: Scene, appearance: SceneAppearanceSnapshot, programId: string, revision: number, by?: string, appearanceComplete?: boolean, approval?: { approvedAt?: string | null; approvedBy?: string | null }) => void
  /** Back to the output's own feed, full frame; Restore takes the scene again. */
  releaseScene: (outputId: string, by?: string) => void
  /** The scene an output last showed, for Restore. Session state. */
  sceneReturn: Record<string, string>
  /** Each output's last scene Take or release outside rehearsal (#243 EX.1): which scene, who, when, its revision. Session state. */
  sceneTakes: Record<string, SceneTakeRecord>
  /** The church's own scene presets (arrangements saved from scenes), beside the built-in ones. Saved. */
  scenePresets: Scene[]
  /** Save a scene's arrangement as a preset (replacing one of the same name). */
  saveScenePreset: (scene: Scene, name: string) => void
  renameScenePreset: (id: string, name: string) => void
  deleteScenePreset: (id: string) => void
  /**
   * Clear took content off air. Until something goes live again, browsing (a verse
   * clicked, Verse +/−) changes only the preview, so Restore brings back what was cleared.
   */
  cleared: boolean
  /** Private note shown on stage outputs only. Not persisted. */
  stageMessage: string
  /** The lower third on air (outputs with lowerThirds on), or null. Session state; not saved. */
  lowerThird: LowerThird | null
  /** Designed looks for the lower third (the first is the default). Saved with the themes. */
  lowerThirdStyles: LowerThirdStyle[]
  /** Unpublished visual edits. Output renderers never read these drafts. */
  designDrafts: DesignDraft[]
  saveDesignDraft: (draft: DesignDraft) => void
  deleteDesignDraft: (id: string) => void
  /** Add or replace a style (by id); `backing` (resolved) replaces the on-air band's when it uses this style. */
  saveLowerThirdStyle: (style: LowerThirdStyle, backing?: LowerThird["backing"]) => void
  /** Remove a style; the last one cannot go. */
  deleteLowerThirdStyle: (id: string) => void
  /** The news ticker on air (outputs with ticker on), or null. Session state. */
  ticker: Ticker | null
  /** What the ticker says, one item per line as typed. Saved. */
  tickerItems: string[]
  /** How the ticker looks. Saved. */
  tickerStyle: TickerStyle
  /** The stage display's design (Design → Stage). */
  stageStyle: StageStyle
  saveStageStyle: (style: StageStyle) => void
  /** When the service is expected to end (kept by stage-finish.ts from the timing engine). */
  stageFinish: StageFinish | null
  setStageFinish: (finish: StageFinish | null) => void
  /** The time of day on the stage, when its design shows one (kept by stage-finish.ts, once a minute). */
  stageClock: StageClock | null
  setStageClock: (clock: StageClock | null) => void
  /** Auxiliary timers shown on the stage (kept by aux-timers-store.ts). */
  stageAux: StageAux[]
  setStageAux: (aux: StageAux[]) => void
  /** What "time until" clocks count down to: the next item, the service end, each "end by" (kept by stage-finish.ts; #196 R2). */
  countdowns: CountdownTargets | null
  setCountdowns: (countdowns: CountdownTargets | null) => void
  /** The stage's countdown line, when its design shows one (kept by stage-finish.ts). */
  stageCountdown: StageAux | null
  setStageCountdown: (line: StageAux | null) => void
  /** The countdown display's design (Design → Countdown), for stage outputs with the countdown layout. Saved. */
  countdownLook: CountdownLook
  saveCountdownLook: (look: CountdownLook) => void
  /** What countdown displays can count besides the service timer (kept by countdown-sources.ts). */
  countdownSources: CountdownSources
  setCountdownSources: (sources: CountdownSources) => void
  /** Saved sets of announcements. Saved. */
  tickerPresets: TickerPreset[]
  /** Save the words now in the ticker as a set (replacing one of the same name). */
  saveTickerPreset: (name: string) => void
  deleteTickerPreset: (id: string) => void
  setTickerItems: (items: string[]) => void
  /** Start the ticker with the saved items and style (`backing` resolved from the style's media), or stop it (null). */
  setTicker: (on: { backing: Ticker["backing"] } | null) => void
  /** Change the look; a running ticker takes it at once (keeping its place in the crawl). */
  saveTickerStyle: (style: TickerStyle, backing?: Ticker["backing"]) => void
  /** Hold the ticker's words still, or let them move on from where they stopped. */
  pauseTicker: (paused: boolean) => void
  /**
   * What each output was last sent (multiview thumbnails show exactly this).
   * Session state; written whenever an output is synced.
   */
  outputFrames: Record<string, OutputFrame>
  /** Forget what an output was last sent (its window was closed or is being reopened), so the next sync sends everything again. */
  resetOutputRuntime: (id: string) => void
  setLowerThird: (lt: LowerThird | null) => void
  /**
   * Rehearsal: everything works in the app (Preview, Live panel, rundown)
   * but no output window, NDI sender or stage screen receives anything.
   * Turning it off puts back the program as it was when rehearsal began (ADR 0001):
   * only `keepRehearsed` sends what was rehearsed. Scenes taken in rehearsal always go back,
   * like the lower third and ticker: a scene reaches a screen only by a Take outside rehearsal. Not persisted.
   */
  rehearsal: boolean
  /** The real program while rehearsal runs, put back when it ends. */
  rehearsalReturn: RehearsalReturn | null
  /** Why the last present did not reach the output; cleared by the next successful present. */
  presentWarning: string | null
  // When on, detections auto-present to the live output. When off, the live
  // output only changes via explicit presents (manual operator control).
  autoLive: boolean
  /** Auto for the Bible feeds only: a heard verse activates the Bible source and never the main screens. Never on with autoLive. */
  autoBibleFeeds: boolean

  // Designer state
  isDesignerOpen: boolean
  editingThemeId: string | null
  renamingThemeId: string | null
  draftTheme: BroadcastTheme | null
  /**
   * Live edit: the Designer's unsaved draft shows on the outputs that use the theme. Off by
   * default and turned off when editing ends, so a draft never reaches a screen unasked (ADR 0001).
   */
  liveDesign: boolean
  setLiveDesign: (on: boolean) => void
  selectedElement: SelectedElement

  // Theme management
  loadThemes: () => void
  saveTheme: (theme: BroadcastTheme) => void
  applyBrandKit: (kit: BrandKit) => void
  /** Removes the theme unless an output uses it; returns those outputs' names. */
  deleteTheme: (id: string) => { inUse: string[] }
  duplicateTheme: (id: string) => void
  createNewTheme: (layoutKind?: NewThemeLayoutKind) => void
  renameTheme: (id: string, name: string) => void
  togglePinTheme: (id: string) => void
  setActiveTheme: (id: string) => void
  setLive: (live: boolean) => void
  /** `goLive` puts the output on air in the same update as the verse, so no stale frame shows first. */
  setLiveVerse: (verse: VerseRenderData | null, source?: Verse | null, opts?: { goLive?: boolean; item?: ItemTranslations | null; slide?: LiveSlide | null; itemId?: string | null; keepHeld?: boolean; follow?: boolean; by?: string }) => void
  setPresentWarning: (warning: string | null) => void
  /**
   * Pause or resume the video item on air (MD-002, #36): every output holds its frame (and NDI and
   * the feeds that show it with it) and carries on from there. Nothing when no video item is live.
   */
  setVideoPaused: (paused: boolean) => void
  setStageMessage: (message: string) => void
  /** Off puts back the program from before rehearsal, unless `keepRehearsed` (a deliberate go-live). */
  setRehearsal: (on: boolean, opts?: { keepRehearsed?: boolean }) => void
  /** Remember the current live content (if any) before a quick screen replaces it. */
  holdLive: () => void
  /** Put the held content back on air (or off air, as it was) and forget it. */
  releaseHeld: () => boolean
  setAutoLive: (auto: boolean) => void
  /** Heard verses: wait for the operator, go live by themselves, or reach the Bible feeds only. */
  setAutoMode: (mode: AutoMode) => void
  syncBroadcastOutput: () => void
  syncBroadcastOutputFor: (outputId: string) => void
  /**
   * Screen test (#298): outputs showing a test pattern, with when it started. While one is, its
   * program frames are kept but not sent; ending the test sends the newest of them, so the output
   * goes back to exactly what it would be showing.
   */
  outputTests: Record<string, number>
  startOutputTest: (id: string, frame: Record<string, unknown>) => void
  endOutputTest: (id: string) => void

  // Output management
  addOutput: (output: BroadcastOutput) => void
  updateOutput: (id: string, patch: Partial<Omit<BroadcastOutput, "id">>) => void
  removeOutput: (id: string) => void
  duplicateOutput: (id: string) => void
  renameOutput: (id: string, name: string) => void
  setOutputTheme: (id: string, themeId: string) => void
  setOutputStatus: (id: string, status: BroadcastOutputStatus) => void
  setNdiError: (id: string, ndiError: string | null) => void

  // Designer actions
  setDesignerOpen: (open: boolean) => void
  startEditing: (themeId: string) => void
  stopEditing: () => void
  updateDraft: (updates: Partial<BroadcastTheme>) => void
  updateDraftNested: (path: string, value: unknown) => void
  saveDraft: () => void
  discardDraft: () => void
  setSelectedElement: (el: SelectedElement) => void
  setRenamingTheme: (id: string | null) => void
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const keys = path.split(".")
  const isIndex = (key: string) => /^\d+$/.test(key)
  const result: Record<string, unknown> = Array.isArray(obj) ? [...obj] as unknown as Record<string, unknown> : { ...obj }

  let current: Record<string, unknown> | unknown[] = result
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    const nextKey = keys[i + 1]
    const currentIndex = isIndex(key) ? Number(key) : key
    const existing = (current as Record<string, unknown> | unknown[])[currentIndex as keyof typeof current]
    const nextContainer = Array.isArray(existing)
      ? [...existing]
      : existing && typeof existing === "object"
        ? { ...(existing as Record<string, unknown>) }
        : isIndex(nextKey)
          ? []
          : {}

    ;(current as Record<string, unknown> | unknown[])[currentIndex as keyof typeof current] = nextContainer as never
    current = nextContainer as Record<string, unknown> | unknown[]
  }

  const lastKey = keys[keys.length - 1]
  const lastIndex = isIndex(lastKey) ? Number(lastKey) : lastKey
  ;(current as Record<string, unknown> | unknown[])[lastIndex as keyof typeof current] = value as never

  return result
}

function seedSecondaryVerseStyle(
  theme: BroadcastTheme,
  path: string
): BroadcastTheme {
  if (!path.startsWith("secondaryVerseText.") || theme.secondaryVerseText) {
    return theme
  }
  return {
    ...theme,
    secondaryVerseText: { ...theme.verseText },
  }
}

// ── signage loop ─────────────────────────────────────────────────────────
// One ticker for all signage outputs; each emits only when its picture changes.
const signageStarted = new Map<string, number>()
const signageLast = new Map<string, number>()
/** Per output: a ticket for the latest sync (older in-flight syncs give up) and what was last emitted. */
const signageSeq = new Map<string, number>()
const signageEmitted = new Map<string, string>()
/** Which playlist (by position; -1 = legacy loop) the latest sync chose, written synchronously so the ticker never re-fires while a picture loads. */
const signageLastList = new Map<string, number>()
let signageTicker: ReturnType<typeof setInterval> | null = null

function forgetSignage(id: string): void {
  signageStarted.delete(id)
  signageLast.delete(id)
  signageSeq.delete(id)
  signageEmitted.delete(id)
  signageLastList.delete(id)
}

async function syncSignage(output: BroadcastOutput, theme: BroadcastTheme): Promise<void> {
  const playlist = activePlaylist(output.signage, new Date())
  const listKey = playlist ? (output.signage?.playlists?.indexOf(playlist) ?? -1) : -2
  const ids = playlist?.mediaIds ?? []
  const seconds = playlist?.seconds ?? 10
  const ticket = (signageSeq.get(output.id) ?? 0) + 1
  signageSeq.set(output.id, ticket)
  if (!signageStarted.has(output.id)) signageStarted.set(output.id, monotonicNow())
  const index = playlist ? signageIndex(ids.length, signageStarted.get(output.id) ?? 0, monotonicNow(), seconds) : -1
  signageLast.set(output.id, index)
  signageLastList.set(output.id, listKey)
  // Same picture and theme as last time: nothing to send (a present or Clear syncs every output).
  const ticker = followsTicker(output) ? tickerForScreens(useBroadcastStore.getState()) : null
  const stamp = `${listKey}:${index}:${ids[index] ?? ""}:${theme.id}:${theme.updatedAt ?? ""}:${tickerKey(ticker)}`
  if (signageEmitted.get(output.id) === stamp) {
    ensureSignageTicker()
    return
  }
  let verse: VerseRenderData | null = null
  if (index >= 0) {
    try {
      const url = await useMediaStore.getState().dataUrl(ids[index])
      if (url) verse = signageFrame(url)
    } catch {
      // A missing picture shows the theme background instead of breaking the loop.
    }
  }
  // A newer sync, or a role change while the picture was loading: this result is stale.
  if (signageSeq.get(output.id) !== ticket) return
  if (useBroadcastStore.getState().outputs.find((o) => o.id === output.id)?.role !== "signage") return
  signageEmitted.set(output.id, stamp)
  recordFrame(output.id, { theme, verse, overlay: null, ticker })
  deliver(output.id, { theme, verse, ticker })
  // Warm the next picture so the swap is instant (the data URL is cached by the media store).
  if (ids.length > 1) void useMediaStore.getState().dataUrl(ids[(index + 1) % ids.length]).catch(() => {})
  ensureSignageTicker()
}

function ensureSignageTicker(): void {
  if (signageTicker) return
  signageTicker = setInterval(() => {
    const s = useBroadcastStore.getState()
    const signage = s.outputs.filter((o) => o.role === "signage")
    if (signage.length === 0) {
      if (signageTicker) clearInterval(signageTicker)
      signageTicker = null
      signageStarted.clear()
      signageLast.clear()
      signageSeq.clear()
      signageEmitted.clear()
      return
    }
    for (const o of signage) {
      const playlist = activePlaylist(o.signage, new Date())
      const listKey = playlist ? (o.signage?.playlists?.indexOf(playlist) ?? -1) : -2
      const ids = playlist?.mediaIds ?? []
      const next = playlist ? signageIndex(ids.length, signageStarted.get(o.id) ?? monotonicNow(), monotonicNow(), playlist.seconds) : -1
      // A different playlist at the same index still needs a sync; both keys are recorded before any await.
      if (next !== signageLast.get(o.id) || listKey !== signageLastList.get(o.id)) s.syncBroadcastOutputFor(o.id)
    }
  }, 1000)
}

/** A scene taken to an output, or released from it (sceneId null): who did it, when, and its revision. */
export interface SceneTakeRecord {
  sceneId: string | null
  /** From the same count as source activations: higher is newer. */
  revision: number
  at: number
  by?: string
}

export interface OutputFrame {
  theme: BroadcastTheme
  verse: VerseRenderData | null
  overlay: LowerThird | null
  ticker?: Ticker | null
  /** Stage outputs: the thumbnail says "Stage display" instead of a frame. */
  stage?: boolean
  /** The scene it shows, when it shows one. */
  scene?: SceneFrame
}

/** Keep what an output was last sent, for the multiview. Skips the write when nothing changed. */
/** Send the lower third (up, changed or down) to the congregation outputs that show it, over the frame or in a scene's box. */
function syncLowerThirdOutputs(): void {
  const s = useBroadcastStore.getState()
  for (const o of s.outputs) if ((followsLowerThird(o) || showsSceneWith(o, "lowerThird")) && (o.role ?? "congregation") === "congregation") s.syncBroadcastOutputFor(o.id)
}

/** A scene Take or release as a record (who, when, its revision), to go with the change in one update; none in rehearsal. */
function sceneTake(outputId: string, sceneId: string | null, by: string | undefined): Pick<BroadcastState, "sceneTakes"> | Record<string, never> {
  const s = useBroadcastStore.getState()
  if (s.rehearsal) return {}
  return { sceneTakes: { ...s.sceneTakes, [outputId]: { sceneId, revision: ++activations, at: Date.now(), ...(by ? { by } : {}) } } }
}

function withSceneSnapshot(output: BroadcastOutput, scenes: readonly Scene[]): BroadcastOutput {
  const stored = output.sceneSnapshot?.id === output.sceneId ? normalizeScene(output.sceneSnapshot) : null
  const snapshot = stored ?? sceneForOutput({ ...output, sceneSnapshot: undefined }, scenes)
  const next = { ...output }
  if (snapshot) next.sceneSnapshot = snapshot
  else delete next.sceneSnapshot
  return next
}

/** Send the ticker (on, changed or off) to the outputs that show it. */
function syncTickerOutputs(): void {
  const s = useBroadcastStore.getState()
  // Rehearsal's ticker stays in the app (signage would otherwise show it).
  if (s.rehearsal) return
  // Never the stage; signage (the foyer) when it is turned on there.
  for (const o of s.outputs) if ((followsTicker(o) || showsSceneWith(o, "ticker")) && o.role !== "stage") s.syncBroadcastOutputFor(o.id)
}

/** The output shows a scene with a layer of this kind (a ticker, lower third or logo in its own box). */
function showsSceneWith(o: BroadcastOutput, kind: SceneLayerKind): boolean {
  const scene = sceneForOutput(o, useBroadcastStore.getState().scenes)
  return !!scene?.layers.some((l) => l.kind === kind)
}

// Which ticker a signage output last showed, by identity (a ticker can carry a picture as a large data URL).
const tickerIds = new WeakMap<Ticker, number>()
let nextTickerId = 1
function tickerKey(t: Ticker | null): number {
  if (!t) return 0
  let id = tickerIds.get(t)
  if (!id) {
    id = nextTickerId++
    tickerIds.set(t, id)
  }
  return id
}

/** After a theme draft ends (saved, discarded, closed, switched), outputs that were shown the draft get the saved theme again. */
function resyncThemeOutputs(themeId: string | null): void {
  if (!themeId) return
  const s = useBroadcastStore.getState()
  for (const o of s.outputs) {
    const scene = sceneForOutput(o, s.scenes)
    if (themeIdsOf(o).includes(themeId) || scene?.layers.some((layer) => layer.themeId === themeId)) s.syncBroadcastOutputFor(o.id)
  }
}

let activations = 0

/** Who the remote command being carried out came from (a joined desk, a phone); see actingAs. */
let remoteActor: string | undefined

/**
 * Carry out `fn` for whoever sent a remote command: the sources it activates are recorded as theirs
 * ("by Femi's laptop"), not as the operator's at this desk. Presents read it as they start.
 */
export function actingAs<T>(by: string | undefined, fn: () => T): T {
  const was = remoteActor
  remoteActor = by?.trim().slice(0, 60) || was
  try {
    return fn()
  } finally {
    remoteActor = was
  }
}

/** Who is activating now: a remote command's sender, else the operator at this desk (Settings → Operator name). */
export function currentActor(): string | undefined {
  return remoteActor ?? (useSettingsStore.getState().operatorName.trim() || undefined)
}

/**
 * The adapter from the program to the sources (ADR 0001): what goes on air activates its source,
 * Clear turns that source off and Restore back on. Other sources are left as they are. Nothing
 * here runs in rehearsal, so the real sources never see what was rehearsed.
 */
function noteSources(by = currentActor()): void {
  const s = useBroadcastStore.getState()
  if (s.rehearsal || !s.liveVerse) return
  const id = sourceOf(s.liveVerse)
  const cur = s.sources[id]
  let sources = s.sources
  if (s.isLive) {
    if (!cur || cur.value !== s.liveVerse) sources = { ...sources, [id]: { value: s.liveVerse, itemId: s.liveItemId, revision: ++activations, activatedAt: Date.now(), ...(by ? { by } : {}), on: true } }
    else if (!cur.on) sources = { ...sources, [id]: { ...cur, on: true } }
  } else if (cur?.on && cur.value === s.liveVerse) {
    sources = { ...sources, [id]: { ...cur, on: false } }
  }
  // A quick screen lasts until something else is shown.
  if (id !== "quick" && sources.quick?.on) sources = { ...sources, quick: { ...sources.quick, on: false } }
  if (sources !== s.sources) useBroadcastStore.setState({ sources })
}

/**
 * Record a change to the ticker, the timer, the lower third, the stage message or a camera (ADR 0001):
 * who made it and when, the next revision. Never in rehearsal, so the real sources never see what
 * was rehearsed.
 */
function markSource(id: StateSourceId, on: boolean, extra: SourceExtra = {}): void {
  useBroadcastStore.setState(sourceMark(id, on, extra))
}

type SourceExtra = Pick<StateSource, "ticker" | "lowerThird" | "message" | "backup" | "hold" | "retry">

export type CameraChange = "retry" | "backup" | "unbackup" | "freeze" | "unfreeze"

/** A camera's controls kept across a hide and restore (and across one another). */
function cameraExtras(cur: StateSource | undefined): SourceExtra {
  return { ...(cur?.backup ? { backup: true } : {}), ...(cur?.hold ? { hold: true } : {}), ...(cur?.retry ? { retry: cur.retry } : {}) }
}

/** The controls after one change. */
export function cameraControlled(cur: StateSource | undefined, change: CameraChange): SourceExtra {
  const next = cameraExtras(cur)
  if (change === "retry") next.retry = (cur?.retry ?? 0) + 1
  if (change === "backup") next.backup = true
  if (change === "unbackup") delete next.backup
  if (change === "freeze") next.hold = true
  if (change === "unfreeze") delete next.hold
  return next
}

/**
 * Which operator control changed a camera source between two states (Retry, backup, Freeze), or null
 * for a hide or a restore. The service log names the control, not "back in scenes" (#213).
 */
export function cameraChangeBetween(a: StateSource | undefined, b: StateSource): CameraChange | null {
  if ((b.retry ?? 0) > (a?.retry ?? 0)) return "retry"
  if (!!b.backup !== !!a?.backup) return b.backup ? "backup" : "unbackup"
  if (!!b.hold !== !!a?.hold) return b.hold ? "freeze" : "unfreeze"
  return null
}

/** The same as a patch, to go with the change it records in one update (none in rehearsal). */
function sourceMark(id: StateSourceId, on: boolean, extra: SourceExtra = {}): Pick<BroadcastState, "stateSources"> | Record<string, never> {
  const s = useBroadcastStore.getState()
  if (s.rehearsal) return {}
  const by = currentActor()
  return { stateSources: { ...s.stateSources, [id]: { revision: ++activations, activatedAt: Date.now(), ...(by ? { by } : {}), on, ...extra } } }
}

/**
 * Send an output its frame: to its window (display, NDI), or for a browser feed to the LAN feed page
 * (ARCH-002), only while that feed is on.
 */
function deliver(outputId: string, payload: Record<string, unknown>): void {
  lastProgram.set(outputId, payload)
  // A screen test holds the output; the newest program frame goes out when it ends.
  if (useBroadcastStore.getState().outputTests[outputId]) return
  send(outputId, payload)
}

/** The program frame each output was last given (sent, or held back by a screen test). */
const lastProgram = new Map<string, Record<string, unknown>>()

function send(outputId: string, payload: Record<string, unknown>): void {
  const s = useBroadcastStore.getState()
  const output = s.outputs.find((o) => o.id === outputId)
  if (output?.type === "browser") {
    // hostNow: clocks on the page count by this computer's time, not the TV's (which may be off).
    // With the output's rule for a lost host and its overscan (#198), so a TV keeps them.
    if (s.outputStatus[outputId]?.feedActive) {
      const lost = feedLost(output.hostLost, s.countdownSources.start ?? null, lostPicture(outputId, output.hostLost))
      const overscan = overscanPct(output.overscan)
      void invoke("feed_publish", { id: outputId, json: JSON.stringify({ ...payload, hostNow: Date.now(), ...(lost ? { lost } : {}), ...(overscan ? { overscan } : {}) }) }).catch(() => {})
    }
    return
  }
  void emitTo(outputWindowLabel(outputId), "broadcast:verse-update", payload).catch(() => {})
}

/** Send an output its last program frame again (after something it carries changed). */
function resendLast(outputId: string): void {
  const last = lastProgram.get(outputId)
  if (last && !useBroadcastStore.getState().outputTests[outputId]) send(outputId, last)
}

/** Pictures for feeds' host-lost rule, as data (null when it cannot be read), by media id. */
const lostPictures = new Map<string, string | null>()

/**
 * The picture a feed shows when it loses this computer, if it is ready; otherwise it is read and
 * the feed's last frame sent again with it (the picture travels inside the frame, like a theme's).
 */
function lostPicture(outputId: string, rule: HostLostRule | undefined): string | null {
  const id = rule?.mode === "picture" ? rule.mediaId : undefined
  if (!id) return null
  if (lostPictures.has(id)) return lostPictures.get(id) ?? null
  lostPictures.set(id, null)
  void useMediaStore.getState().dataUrl(id).catch(() => null).then((url) => {
    if (!url) return void lostPictures.delete(id)
    lostPictures.set(id, url)
    resendLast(outputId)
  })
  return null
}

function recordFrame(id: string, frame: OutputFrame): void {
  const prev = useBroadcastStore.getState().outputFrames[id]
  if (prev && prev.theme === frame.theme && prev.verse === frame.verse && prev.overlay === frame.overlay && prev.ticker === frame.ticker && prev.stage === frame.stage && !prev.scene && !frame.scene) return
  useBroadcastStore.setState((s) => ({ outputFrames: { ...s.outputFrames, [id]: frame } }))
}

function emitDraftToBroadcast(state: BroadcastState): void {
  // Rehearsal freezes every real output, theme edits included (syncBroadcastOutputFor returns early).
  // Without Live edit the draft stays in the Designer.
  if (!state.draftTheme || !state.liveDesign) return
  // The same send as a present (with the sound flag), so the outputs on this theme show the draft.
  for (const output of state.outputs) {
    if (output.themeId === state.editingThemeId && (output.role ?? "congregation") === "congregation") useBroadcastStore.getState().syncBroadcastOutputFor(output.id)
  }
}

function defaultMainOutput(): BroadcastOutput {
  return {
    id: MAIN_OUTPUT_ID,
    name: "Main Display",
    type: "display",
    themeId: BUILTIN_THEMES[0].id,
    monitorIndex: 0,
    // Keeps the pre-multi-output source name so upgrading users' NDI
    // receivers stay bound after the migration.
    ndi: defaultNdiSettings("Rhema Output"),
  }
}

/**
 * Build the outputs list from the pre-multi-output persisted keys. The alt
 * slot always persisted its default theme id, so a value equal to the builtin
 * default means the alt output was never actually used — skip it then.
 */
export function migrateLegacyOutputs(
  activeThemeId?: string,
  altActiveThemeId?: string
): BroadcastOutput[] {
  const main = defaultMainOutput()
  if (activeThemeId) main.themeId = activeThemeId
  const outputs = [main]
  if (altActiveThemeId && altActiveThemeId !== BUILTIN_THEMES[0].id) {
    outputs.push({
      id: "alt",
      name: "Alternate Output",
      type: "ndi",
      themeId: altActiveThemeId,
      monitorIndex: 0,
      ndi: defaultNdiSettings("Rhema Alt"),
    })
  }
  return outputs
}

export const useBroadcastStore = create<BroadcastState>((set, get) => ({
  themes: [...BUILTIN_THEMES],
  activeThemeId: BUILTIN_THEMES[0].id,
  outputs: [defaultMainOutput()],
  outputStatus: {},
  isLive: false,
  liveVerse: null,
  liveSourceVerse: null,
  liveItem: null,
  liveSlide: null,
  liveItemId: null,
  heldLive: null,
  sources: {},
  stateSources: {},
  scenes: [],
  sceneReturn: {},
  sceneTakes: {},
  scenePresets: [],
  cleared: false,
  stageMessage: "",
  lowerThird: null,
  lowerThirdStyles: [DEFAULT_LOWER_THIRD_STYLE],
  designDrafts: [],
  saveDesignDraft: (draft) => {
    const normalized = normalizeDesignDraft(draft)
    if (!normalized) return
    const drafts = get().designDrafts.filter((existing) => existing.id !== normalized.id)
    set({ designDrafts: [...drafts, normalized] })
  },
  deleteDesignDraft: (id) => set({ designDrafts: get().designDrafts.filter((draft) => draft.id !== id) }),
  ticker: null,
  tickerItems: [],
  tickerStyle: DEFAULT_TICKER_STYLE,
  stageStyle: DEFAULT_STAGE_STYLE,
  stageFinish: null,
  stageClock: null,
  setStageClock: (stageClock) => {
    set({ stageClock })
    for (const o of get().outputs) if (o.role === "stage") get().syncBroadcastOutputFor(o.id)
  },
  stageAux: [],
  setStageAux: (stageAux) => {
    set({ stageAux })
    for (const o of get().outputs) if (o.role === "stage") get().syncBroadcastOutputFor(o.id)
  },
  setStageFinish: (stageFinish) => {
    set({ stageFinish })
    for (const o of get().outputs) if (o.role === "stage") get().syncBroadcastOutputFor(o.id)
  },
  countdowns: null,
  setCountdowns: (countdowns) => {
    set({ countdowns })
    // Clock layers count down by themselves: a scene is sent again only when what it counts to moves.
    for (const o of get().outputs) {
      const scene = sceneForOutput(o, get().scenes)
      if (scene?.layers.some((l) => l.kind === "clock" && l.visible && l.clockShows === "countdown")) get().syncBroadcastOutputFor(o.id)
    }
    // A countdown display counting to an item's start or a group's end follows it as it moves.
    if (countsToTarget(get().countdownLook)) syncCountdownOutputs()
  },
  stageCountdown: null,
  setStageCountdown: (stageCountdown) => {
    set({ stageCountdown })
    for (const o of get().outputs) if (o.role === "stage") get().syncBroadcastOutputFor(o.id)
  },
  saveStageStyle: (stageStyle) => {
    set({ stageStyle: normalizeStageStyle(stageStyle) })
    get().syncBroadcastOutput()
  },
  countdownLook: DEFAULT_COUNTDOWN_LOOK,
  saveCountdownLook: (look) => {
    set({ countdownLook: normalizeCountdownLook(look) })
    syncCountdownOutputs()
  },
  countdownSources: NO_COUNTDOWN_SOURCES,
  setCountdownSources: (countdownSources) => {
    const startMoved = countdownSources.start !== get().countdownSources.start
    set({ countdownSources })
    syncCountdownOutputs()
    // Feeds that count down to the service start when they lose this computer (#198) get the new start.
    if (startMoved) for (const o of get().outputs) if (o.type === "browser" && o.hostLost?.mode === "countdown") resendLast(o.id)
  },
  tickerPresets: [],
  saveTickerPreset: (name) => {
    const n = name.trim().slice(0, 60)
    const items = get().tickerItems.filter((i) => i.trim())
    if (!n || items.length === 0) return
    const others = get().tickerPresets.filter((p) => p.name.toLowerCase() !== n.toLowerCase())
    set({ tickerPresets: [...others, { id: crypto.randomUUID(), name: n, items }] })
  },
  deleteTickerPreset: (id) => set({ tickerPresets: get().tickerPresets.filter((p) => p.id !== id) }),
  outputFrames: {},
  rehearsal: false,
  rehearsalReturn: null,
  presentWarning: null,
  // Off until the operator turns it on (PRD FR-01: speech suggestions are proposals unless an
  // automation is explicitly enabled; AI-001 "no AI output auto-live"). A saved choice is kept.
  autoLive: false,
  autoBibleFeeds: false,
  isDesignerOpen: false,
  editingThemeId: null,
  liveDesign: false,
  renamingThemeId: null,
  draftTheme: null,
  selectedElement: null,

  loadThemes: () => {
    set({ themes: [...BUILTIN_THEMES] })
  },
  saveTheme: (theme) =>
    set((s) => ({
      themes: s.themes.some((t) => t.id === theme.id)
        ? s.themes.map((t) => (t.id === theme.id ? theme : t))
        : [...s.themes, theme],
    })),
  /** Generate or refresh the Brand Kit's themes; hand-edited ones are left alone. */
  applyBrandKit: (kit) => set((s) => ({ themes: applyBrandKit(kit, s.themes, new Set(s.outputs.flatMap(themeIdsOf))) })),
  // An output using the theme would silently fall back to Classic Dark (an opaque frame over a
  // stream's camera, FR-06): refuse and say which outputs use it.
  deleteTheme: (id) => {
    const users = get().outputs.filter((o) => themeIdsOf(o).includes(id))
    if (users.length > 0) return { inUse: users.map((o) => o.name) }
    set((s) => ({ themes: s.themes.filter((t) => t.id !== id || t.builtin) }))
    return { inUse: [] }
  },
  duplicateTheme: (id) => {
    const s = get()
    const source = s.themes.find((t) => t.id === id)
    if (!source) return
    const newTheme: BroadcastTheme = {
      ...source,
      id: crypto.randomUUID(),
      name: `${source.name} Copy`,
      builtin: false,
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    set((s) => ({ themes: [...s.themes, newTheme] }))
  },
  createNewTheme: (layoutKind = "fullscreen") => {
    // Lower thirds start from the Lower Thirds builtin (transparent background for
    // NDI keying, text box band at the bottom); fullscreen from Classic Dark.
    const source = layoutKind === "lower-thirds" ? LOWER_THIRDS : CLASSIC_DARK
    const newTheme: BroadcastTheme = {
      ...source,
      id: crypto.randomUUID(),
      name: "Untitled Theme",
      builtin: false,
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(layoutKind === "fullscreen"
        ? {
            background: {
              type: "solid" as const,
              color: "#000000",
              gradient: null,
              image: null,
            },
          }
        : {}),
    }
    set((s) => ({ themes: [...s.themes, newTheme] }))
    get().startEditing(newTheme.id)
  },
  renameTheme: (id, name) =>
    set((s) => ({
      themes: s.themes.map((t) =>
        // A renamed Brand Kit theme is the church's own now: the next Apply leaves its name alone.
        t.id === id && !t.builtin ? { ...t, name, updatedAt: Date.now(), ...(t.brandManaged ? { brandManaged: false } : {}) } : t
      ),
      draftTheme:
        s.draftTheme?.id === id ? { ...s.draftTheme, name, updatedAt: Date.now(), ...(s.draftTheme.brandManaged ? { brandManaged: false } : {}) } : s.draftTheme,
    })),
  togglePinTheme: (id) =>
    set((s) => ({
      themes: s.themes.map((t) =>
        t.id === id ? { ...t, pinned: !t.pinned, updatedAt: Date.now() } : t
      ),
    })),
  syncBroadcastOutputFor: (outputId: string) => {
    const s = get()
    const output = s.outputs.find((o) => o.id === outputId)
    if (!output) return
    // The look for what is on air: this output's theme for that kind of content, else its main theme.
    const shown = feedFrame(s, output.shows)
    const scene = sceneForOutput(output, s.scenes)
    const themeId = themeIdFor(output, scene ? null : shown?.content)
    const saved = s.themes.find((t) => t.id === themeId) ?? s.themes.find((t) => t.id === output.themeId) ?? s.themes[0]
    if (!saved) return
    // A theme open in the Designer shows on its congregation outputs as edited, for presents too
    // (otherwise each present flipped the screen back to the saved theme).
    const theme = s.liveDesign && s.draftTheme && s.editingThemeId === saved.id && (output.role ?? "congregation") === "congregation" ? s.draftTheme : saved

    // Signage runs its own loop; neither the live output nor rehearsal touches it.
    if (output.role === "signage") {
      void syncSignage(output, theme)
      return
    }
    // Rehearsal freezes every real output at whatever it last showed.
    if (s.rehearsal) return

    if (output.role === "stage") {
      recordFrame(outputId, { theme, verse: null, overlay: null, stage: true })
      const q = useQueueStore.getState()
      // What comes next leaves out hidden items and a skipped phase (#193).
      const items = markSkipped(q.items, q.headers)
      const countdown = output.stageLayout === "countdown" ? stageCountdownFrame(s, items, q.activeIndex) : null
      deliver(outputId, {
        // The stage window draws no theme: send the built-in one (no pictures) rather than the
        // output's, whose pictures can be megabytes, with every timer tick (NFR-03).
        theme: CLASSIC_DARK,
        verse: null,
        role: "stage",
        // A stage that follows chosen sources shows their words; otherwise the program (ADR 0001).
        stage: applyStageStyle({ ...buildStagePayload({
          isLive: shown !== null, liveVerse: shown, items, activeIndex: q.activeIndex, timer: useTimerStore.getState().timer, now: monotonicNow(), message: s.stageMessage,
          song: s.liveSlide ? (useSongStore.getState().songs[s.liveSlide.songId]?.song ?? null) : null,
        }), finish: s.stageFinish, aux: s.stageCountdown ? [s.stageCountdown, ...s.stageAux] : s.stageAux, ...(countdown ? { countdown } : {}), ...(s.stageClock ? { clock: s.stageClock } : {}),
          // This output's own layout, orientation and low-light colours (#196 R6); absent from older outputs.
          ...(output.stageLayout && output.stageLayout !== "countdown" ? { layout: output.stageLayout } : {}),
          ...(output.stageOrientation ? { portrait: output.stageOrientation } : {}),
          ...(output.stageNight ? { night: true } : {}) }, s.stageStyle),
      })
      return
    }
    // A scene is the output's program, unless Black or Logo covers every screen.
    if (scene && !(s.isLive && s.liveVerse?.screen)) {
      // A scene with a ticker or lower-third layer owns it: drawn in its box, never also over the whole frame.
      const owns = sceneOwns(scene)
      const liveOverlay = overlayFor(s.lowerThird, shown ? forOutputLanguage(shown, output.language) : null)
      const liveTicker = tickerForScreens(s)
      const draft = s.liveDesign && s.draftTheme && scene.layers.some((layer) =>
        layer.themeId === s.draftTheme!.id ||
        (!layer.themeId && ["feed", "clock", "camera", "ticker", "lowerThird"].includes(layer.kind) && themeIdsOf(output).includes(s.draftTheme!.id)),
      ) ? s.draftTheme : null
      const sceneOutput = draft
        ? { ...output, sceneAppearanceSnapshot: { themes: { ...(output.sceneAppearanceSnapshot?.themes ?? {}), [draft.id]: draft }, logoUrl: output.sceneAppearanceSnapshot ? output.sceneAppearanceSnapshot.logoUrl : useSettingsStore.getState().brandKit.logoUrl } }
        : output
      const frame = sceneFrame({ ...s, clock: sceneClock(useTimerStore.getState().timer, monotonicNow(), Date.now()), ticker: liveTicker, overlay: liveOverlay, logoUrl: useSettingsStore.getState().brandKit.logoUrl, cameraLabel: (url) => cameraLabelOf(url, useSettingsStore.getState().cameras), cameraBackup, cameraDown }, sceneOutput, scene)
      const overlay = followsLowerThird(output) && !owns.lowerThird ? liveOverlay : null
      const ticker = followsTicker(output) && !owns.ticker ? liveTicker : null
      recordFrame(outputId, { theme, verse: null, overlay, ticker, scene: frame })
      deliver(outputId, { theme, verse: null, overlay, ticker, scene: frame, sound: false })
      return
    }
    const verse = shown ? forOutputLanguage(shown, output.language) : null
    // A lower-third-only feed has no content of its own: a strip that follows what is live follows the program.
    const program = !verse && followsOnlyOverlays(output) && s.isLive && s.liveVerse ? forOutputLanguage(s.liveVerse, output.language) : null
    const overlay = followsLowerThird(output) ? overlayFor(s.lowerThird, verse ?? program) : null
    // Only a real change of screen is timed (QA-007); resends after a window opens are not.
    const changed = get().outputFrames[outputId]?.verse !== verse
    const ticker = followsTicker(output) ? tickerForScreens(s) : null
    recordFrame(outputId, { theme, verse, overlay, ticker })
    deliver(outputId, {
      theme,
      verse,
      overlay,
      ticker,
      sound: soundOutputId(get().outputs, get().outputStatus) === outputId,
      ...(changed ? { sentAt: Date.now() } : {}),
    })
  },
  outputTests: {},
  startOutputTest: (id, frame) => {
    if (!get().outputs.some((o) => o.id === id)) return
    set((s) => ({ outputTests: { ...s.outputTests, [id]: s.outputTests[id] ?? Date.now() } }))
    send(id, frame)
  },
  endOutputTest: (id) => {
    if (!get().outputTests[id]) return
    set((s) => {
      const outputTests = { ...s.outputTests }
      delete outputTests[id]
      return { outputTests }
    })
    const output = get().outputs.find((o) => o.id === id)
    if (!output) return
    if (!lastProgram.has(id)) get().syncBroadcastOutputFor(id)
    const last = lastProgram.get(id)
    // Not a change of screen for the latency log: without the old send time.
    if (last) {
      const frame = { ...last }
      delete frame.sentAt
      send(id, frame)
    } else {
      // Nothing was ever sent here (rehearsal froze it before its first frame): its plain look.
      send(id, { theme: get().themes.find((t) => t.id === output.themeId) ?? CLASSIC_DARK, verse: null, overlay: null, ticker: null })
    }
  },
  syncBroadcastOutput: () => {
    for (const output of get().outputs) {
      get().syncBroadcastOutputFor(output.id)
    }
  },
  setActiveTheme: (activeThemeId) => {
    get().setOutputTheme(MAIN_OUTPUT_ID, activeThemeId)
  },

  // Output management
  addOutput: (output) =>
    set((s) => ({
      outputs: s.outputs.some((o) => o.id === output.id)
        ? s.outputs
        : [...s.outputs, withSceneSnapshot(output, s.scenes)],
    })),
  updateOutput: (id, patch) => {
    set((s) => ({
      outputs: s.outputs.map((o) => {
        if (o.id !== id) return o
        const next = { ...o, ...patch, id }
        if ("sceneSnapshot" in patch) {
          if (patch.sceneSnapshot) next.sceneSnapshot = patch.sceneSnapshot
          else delete next.sceneSnapshot
        } else if ("sceneId" in patch && patch.sceneId !== o.sceneId && !s.rehearsal) {
          return withSceneSnapshot(next, s.scenes)
        }
        return next
      }),
      ...(id === MAIN_OUTPUT_ID && patch.themeId
        ? { activeThemeId: patch.themeId }
        : {}),
    }))
    if ("role" in patch && patch.role !== "signage") forgetSignage(id)
    if (patch.themeId || "themeFor" in patch || "language" in patch || "role" in patch || "signage" in patch || "lowerThirds" in patch || "shows" in patch || "sceneId" in patch || "stageLayout" in patch || "stageOrientation" in patch || "stageNight" in patch) get().syncBroadcastOutputFor(id)
    // A feed's rule for a lost host or its overscan (#198): its screens get the last frame again with it.
    else if ("hostLost" in patch || "overscan" in patch) resendLast(id)
  },
  removeOutput: (id) => {
    if (id === MAIN_OUTPUT_ID) return
    forgetSignage(id)
    lastProgram.delete(id)
    if (get().outputTests[id]) {
      set((s) => {
        const outputTests = { ...s.outputTests }
        delete outputTests[id]
        return { outputTests }
      })
    }
    set((s) => {
      const outputFrames = { ...s.outputFrames }
      delete outputFrames[id]
      return { outputFrames }
    })
    set((s) => {
      const outputStatus = Object.fromEntries(
        Object.entries(s.outputStatus).filter(([statusId]) => statusId !== id)
      )
      return {
        outputs: s.outputs.filter((o) => o.id !== id),
        outputStatus,
      }
    })
  },
  duplicateOutput: (id) => {
    const s = get()
    const source = s.outputs.find((o) => o.id === id)
    if (!source) return
    const takenNames = new Set(s.outputs.map((o) => o.name))
    const takenSources = new Set(s.outputs.map((o) => o.ndi.sourceName))
    let name = `${source.name} Copy`
    let sourceName = `${source.ndi.sourceName} Copy`
    for (let n = 2; takenNames.has(name); n++) name = `${source.name} Copy ${n}`
    // Two NDI senders with the same source name collide on the network.
    for (let n = 2; takenSources.has(sourceName); n++)
      sourceName = `${source.ndi.sourceName} Copy ${n}`
    get().addOutput({
      ...source,
      id: crypto.randomUUID(),
      name,
      ndi: { ...source.ndi, sourceName },
    })
  },
  renameOutput: (id, name) =>
    set((s) => ({
      outputs: s.outputs.map((o) => (o.id === id ? { ...o, name } : o)),
    })),
  setOutputTheme: (id, themeId) => {
    set((s) => ({
      outputs: s.outputs.map((o) => (o.id === id ? { ...o, themeId } : o)),
      ...(id === MAIN_OUTPUT_ID ? { activeThemeId: themeId } : {}),
    }))
    get().syncBroadcastOutputFor(id)
  },
  setOutputStatus: (id, status) =>
    set((s) => {
      const prev = s.outputStatus[id]
      // A status without an opinion on the error keeps it while the sender is on (the
      // Outputs dialog refreshes status every second); off always clears it.
      const ndiError = status.ndiError !== undefined ? status.ndiError : status.ndiActive ? (prev?.ndiError ?? null) : null
      const next = { ...status, ndiError, ndiReceivers: status.ndiReceivers !== undefined ? status.ndiReceivers : status.ndiActive ? (prev?.ndiReceivers ?? null) : null }
      if (prev && prev.previewOpen === next.previewOpen && prev.ndiActive === next.ndiActive && !!prev.feedActive === !!next.feedActive && (prev.ndiError ?? null) === (next.ndiError ?? null) && (prev.ndiReceivers ?? null) === (next.ndiReceivers ?? null)) {
        return s
      }
      return { outputStatus: { ...s.outputStatus, [id]: next } }
    }),
  setNdiError: (id, ndiError) =>
    set((s) => {
      const prev = s.outputStatus[id] ?? { previewOpen: false, ndiActive: false }
      if ((prev.ndiError ?? null) === ndiError) return s
      return { outputStatus: { ...s.outputStatus, [id]: { ...prev, ndiError } } }
    }),
  setLive: (isLive) => {
    const s = get()
    set({ isLive, cleared: isLive ? false : s.cleared || (s.isLive && s.liveVerse !== null) })
    noteSources()
    get().syncBroadcastOutput()
  },
  setLiveVerse: (liveVerse, source = null, opts = {}) => {
    // Cleared: only a go-live (or a translation follow of the cleared verse) replaces it.
    if (get().cleared && !opts.goLive && !opts.follow) {
      set({ presentWarning: null })
      return
    }
    set({
      liveVerse,
      liveSourceVerse: source,
      liveItem: opts.item ?? null,
      liveSlide: opts.slide ?? null,
      liveItemId: opts.itemId ?? opts.slide?.itemId ?? null,
      heldLive: opts.keepHeld ? get().heldLive : null,
      presentWarning: null,
      ...(opts.goLive ? { isLive: true, cleared: false } : {}),
    })
    noteSources(opts.by)
    get().syncBroadcastOutput()
  },
  setPresentWarning: (presentWarning) => set({ presentWarning }),
  setVideoPaused: (paused) => {
    const s = get()
    const v = s.liveVerse
    if (!v?.video || v.content !== "picture" || !!v.video.paused === paused) return
    const liveVerse = { ...v, video: { ...v.video, paused } }
    // The same item, paused: its live source keeps its revision and who showed it (not a new activation).
    const id = sourceOf(v)
    const cur = s.sources[id]
    set({ liveVerse, ...(cur && cur.value === v ? { sources: { ...s.sources, [id]: { ...cur, value: liveVerse } } } : {}) })
    get().syncBroadcastOutput()
  },
  setRehearsal: (rehearsal, opts = {}) => {
    const s = get()
    if (rehearsal === s.rehearsal) return
    if (rehearsal) {
      const { isLive, liveVerse, liveSourceVerse, liveItem, liveSlide, liveItemId, heldLive, cleared, lowerThird, ticker, stageMessage, sceneReturn } = s
      const outputScenes = Object.fromEntries(s.outputs.flatMap((o) => (o.sceneId ? [[o.id, o.sceneId]] : [])))
      const outputSceneSnapshots = Object.fromEntries(s.outputs.flatMap((o) => {
        const scene = sceneForOutput(o, s.scenes)
        return scene ? [[o.id, scene]] : []
      }))
      const outputSceneAppearances = Object.fromEntries(s.outputs.flatMap((o) => o.sceneAppearanceSnapshot ? [[o.id, o.sceneAppearanceSnapshot]] : []))
      set({ rehearsal, rehearsalReturn: { isLive, liveVerse, liveSourceVerse, liveItem, liveSlide, liveItemId, heldLive, cleared, activeIndex: useQueueStore.getState().activeIndex, lowerThird, ticker, stageMessage, timer: useTimerStore.getState().timer, outputScenes, outputSceneSnapshots, outputSceneAppearances, sceneReturn } })
      return
    }
    const back = s.rehearsalReturn
    if (back) {
      const { activeIndex, lowerThird, ticker, stageMessage, timer, outputScenes, outputSceneSnapshots, outputSceneAppearances, sceneReturn, ...program } = back
      // The lower third, ticker, stage message, timer and each screen's scene always come back
      // (a scene deleted meanwhile leaves its screen on its own feed); the program too unless the
      // operator chose Show this live.
      useTimerStore.setState({ timer })
      if (!opts.keepRehearsed) useQueueStore.setState({ activeIndex })
      const kept = Object.fromEntries(Object.entries(outputScenes).filter(([, id]) => s.scenes.some((x) => x.id === id)))
      set({ ...(opts.keepRehearsed ? {} : program), lowerThird, ticker, stageMessage, outputs: withScenes(s.outputs, kept, outputSceneSnapshots, outputSceneAppearances), sceneReturn, rehearsal, rehearsalReturn: null })
    } else {
      set({ rehearsal, rehearsalReturn: null })
    }
    noteSources()
    get().syncBroadcastOutput()
  },
  setLowerThird: (lt) => {
    // A strip that follows what is live has no words of its own.
    const clean = lt && (lt.follow || lt.line1.trim() || lt.line2.trim()) ? { ...lt, line1: lt.line1.trim(), line2: lt.line2.trim(), shownAt: Date.now() } : null
    // The lower third as a live source: up, or taken down with the one it was kept for Restore.
    const was = get().lowerThird
    set({ lowerThird: clean, ...(clean ? sourceMark("lowerThird", true, { lowerThird: clean }) : was ? sourceMark("lowerThird", false, { lowerThird: was }) : {}) })
    syncLowerThirdOutputs()
  },
  saveLowerThirdStyle: (style, backing) => {
    const styles = get().lowerThirdStyles
    const at = styles.findIndex((x) => x.id === style.id)
    set({ lowerThirdStyles: at < 0 ? [...styles, style] : styles.map((x, i) => (i === at ? style : x)) })
    // The band on air in this style redraws as designed (without coming on again).
    const lt = get().lowerThird
    if (lt?.style?.id === style.id) {
      set({ lowerThird: { ...lt, style, ...(backing !== undefined ? { backing } : {}) } })
      syncLowerThirdOutputs()
    }
  },
  setTickerItems: (tickerItems) => {
    set({ tickerItems })
    const t = get().ticker
    if (t) {
      set({ ticker: { ...t, items: tickerItems } })
      syncTickerOutputs()
    }
  },
  setTicker: (on) => {
    const s = get()
    const live = on && s.tickerItems.some((i) => i.trim()) ? { items: s.tickerItems, style: s.tickerStyle, startedAt: Date.now(), backing: on.backing } : null
    // The ticker source: on, or off with the words it ran kept for Restore.
    set({ ticker: live, ...(live ? sourceMark("ticker", true) : s.ticker ? sourceMark("ticker", false, { ticker: s.ticker }) : {}) })
    syncTickerOutputs()
  },
  pauseTicker: (paused) => {
    const t = get().ticker
    if (!t || !!t.pausedAt === paused) return
    const now = Date.now()
    // Resuming moves the start on by the pause, so the words carry on from where they stopped.
    set({ ticker: paused ? { ...t, pausedAt: now } : { ...t, startedAt: t.startedAt + (now - (t.pausedAt ?? now)), pausedAt: undefined }, ...sourceMark("ticker", true) })
    syncTickerOutputs()
  },
  saveTickerStyle: (tickerStyle, backing) => {
    set({ tickerStyle })
    const t = get().ticker
    if (t) {
      set({ ticker: { ...t, style: tickerStyle, ...(backing !== undefined ? { backing } : {}) } })
      syncTickerOutputs()
    }
  },
  deleteLowerThirdStyle: (id) => {
    const styles = get().lowerThirdStyles
    if (styles.length > 1) set({ lowerThirdStyles: styles.filter((x) => x.id !== id) })
  },
  setStageMessage: (stageMessage) => {
    // The stage message as a live source: up, or cleared with the one it was kept for Restore.
    const was = get().stageMessage
    set({ stageMessage, ...(stageMessage === was ? {} : stageMessage ? sourceMark("stage", true, { message: stageMessage }) : sourceMark("stage", false, { message: was })) })
    for (const o of get().outputs) if (o.role === "stage") get().syncBroadcastOutputFor(o.id)
  },
  holdLive: () => {
    const s = get()
    if (s.heldLive || !s.liveVerse) return
    set({ heldLive: { liveVerse: s.liveVerse, liveSourceVerse: s.liveSourceVerse, liveItem: s.liveItem, liveSlide: s.liveSlide, liveItemId: s.liveItemId, wasLive: s.isLive, wasCleared: s.cleared } })
  },
  releaseHeld: () => {
    const held = get().heldLive
    if (!held) return false
    set({
      liveVerse: held.liveVerse,
      liveSourceVerse: held.liveSourceVerse,
      liveItem: held.liveItem,
      liveSlide: held.liveSlide,
      liveItemId: held.liveItemId,
      heldLive: null,
      // Cleared while the quick screen was up: the content comes back, still off air.
      isLive: held.wasLive && get().isLive,
      // Back to off air with content that was cleared (before or during the quick screen): keep it for Restore.
      cleared: !!held.wasCleared || (held.wasLive && !get().isLive),
    })
    noteSources()
    if (!get().isLive) {
      // Back to off air: the quick screen is over for the feeds too.
      const q = get().sources.quick
      if (q?.on) set({ sources: { ...get().sources, quick: { ...q, on: false } } })
    }
    get().syncBroadcastOutput()
    return true
  },
  setAutoLive: (autoLive) => set({ autoLive, autoBibleFeeds: false }),
  setAutoMode: (mode) => set({ autoLive: mode === "auto", autoBibleFeeds: mode === "bible" }),
  clearSource: (id) => {
    const s = get()
    if (isStateSource(id)) {
      // The ticker, timer and cameras are left alone in rehearsal (their real state is not the app's then).
      if (s.rehearsal) return
      if (id === "ticker") {
        if (s.ticker) get().setTicker(null)
      } else if (id === "lowerThird") {
        if (s.lowerThird) get().setLowerThird(null)
      } else if (id === "stage") {
        if (s.stageMessage) get().setStageMessage("")
      } else if (id === "timer") {
        if (useTimerStore.getState().timer.startedAt !== null) useTimerStore.getState().pause()
      } else if (s.stateSources[id]?.on !== false) {
        // A camera hidden from scenes: every scene with it shows its fallback there, the scenes unchanged.
        markSource(id, false, cameraExtras(s.stateSources[id]))
        get().syncBroadcastOutput()
      }
      return
    }
    const cur = s.sources[id]
    if (!cur?.on) return
    if (s.isLive && s.liveVerse === cur.value) return get().setLive(false)
    set({ sources: { ...s.sources, [id]: { ...cur, on: false } } })
    get().syncBroadcastOutput()
  },
  restoreSource: (id) => {
    const s = get()
    if (isStateSource(id)) {
      if (s.rehearsal) return
      const cur = s.stateSources[id]
      if (cur?.on !== false) return
      if (id === "ticker") {
        // The ticker that was taken off, words, look and backing, its crawl starting again.
        if (s.ticker || !cur.ticker) return
        const was: Ticker = { ...cur.ticker, startedAt: Date.now() }
        delete was.pausedAt
        set({ ticker: was, ...sourceMark("ticker", true) })
        syncTickerOutputs()
      } else if (id === "lowerThird") {
        // The lower third that was taken down, coming on again.
        if (!s.lowerThird && cur.lowerThird) get().setLowerThird(cur.lowerThird)
      } else if (id === "stage") {
        if (!s.stageMessage && cur.message) get().setStageMessage(cur.message)
      } else if (id === "timer") {
        if (useTimerStore.getState().timer.startedAt === null) useTimerStore.getState().start()
      } else {
        markSource(id, true, cameraExtras(cur))
        get().syncBroadcastOutput()
      }
      return
    }
    const cur = s.sources[id]
    if (!cur || cur.on || s.rehearsal) return
    if (!s.isLive && s.cleared && s.liveVerse === cur.value) return get().setLive(true)
    set({ sources: { ...s.sources, [id]: { ...cur, on: true } } })
    get().syncBroadcastOutput()
  },
  cameraControl: (name, change) => {
    const s = get()
    if (s.rehearsal) return
    const id = cameraSourceId(name)
    const cur = s.stateSources[id]
    // A control keeps the camera as it was (in scenes or hidden): the log names the control from the change.
    markSource(id, cur?.on ?? true, cameraControlled(cur, change))
    get().syncBroadcastOutput()
  },
  saveScene: (scene) => {
    const s = get()
    const at = s.scenes.findIndex((x) => x.id === scene.id)
    const next = { ...scene, updatedAt: Math.max(Date.now(), (s.scenes[at]?.updatedAt ?? 0) + 1), updatedBy: currentActor() ?? null }
    set({ scenes: at < 0 ? [...s.scenes, next] : s.scenes.map((x, i) => (i === at ? next : x)) })
  },
  deleteScene: (id) => {
    set({ scenes: get().scenes.filter((x) => x.id !== id) })
    for (const o of get().outputs) if (o.sceneId === id) get().updateOutput(o.id, { sceneId: undefined })
  },
  takeScene: (outputId, sceneId, by = currentActor()) => {
    const s = get()
    const scene = s.scenes.find((x) => x.id === sceneId)
    const output = s.outputs.find((x) => x.id === outputId)
    if (!scene || !output || (output.role ?? "congregation") !== "congregation") return
    const appearance = captureSceneAppearance(scene, output, s.themes, useSettingsStore.getState().brandKit.logoUrl)
    set({ sceneReturn: { ...s.sceneReturn, [outputId]: sceneId }, ...sceneTake(outputId, sceneId, by) })
    get().updateOutput(outputId, { sceneId, sceneSnapshot: structuredClone(normalizeScene(scene) ?? scene), sceneAppearanceSnapshot: appearance })
  },
  restoreSceneSnapshot: (outputId, scene, appearance, themeSelection, by = currentActor()) => {
    const s = get()
    const output = s.outputs.find((o) => o.id === outputId)
    const snapshot = normalizeScene(scene)
    if (!snapshot || !output || (output.role ?? "congregation") !== "congregation") return
    set({ sceneReturn: { ...s.sceneReturn, [outputId]: snapshot.id }, ...sceneTake(outputId, snapshot.id, by) })
    get().updateOutput(outputId, {
      themeId: themeSelection.themeId,
      themeFor: themeSelection.themeFor,
      sceneId: snapshot.id,
      sceneSnapshot: structuredClone(snapshot),
      sceneAppearanceSnapshot: structuredClone(appearance),
    })
  },
  takeSceneRevision: (outputId, scene, appearance, programId, revision, by = currentActor(), appearanceComplete = true, approval = {}) => {
    const output = get().outputs.find((o) => o.id === outputId)
    if (!programId.trim() || !Number.isSafeInteger(revision) || revision < 0 || !output || (output.role ?? "congregation") !== "congregation") return
    const snapshot = normalizeScene(scene)
    if (!snapshot) return
    const appearanceSnapshot = structuredClone({ ...appearance, approved: { programId, revision, appearanceComplete, ...approval } })
    set({ sceneReturn: { ...get().sceneReturn, [outputId]: scene.id }, ...sceneTake(outputId, scene.id, by) })
    get().updateOutput(outputId, { sceneId: scene.id, sceneSnapshot: structuredClone(snapshot), sceneAppearanceSnapshot: appearanceSnapshot })
  },
  releaseScene: (outputId, by = currentActor()) => {
    if (!get().outputs.find((o) => o.id === outputId)?.sceneId) return
    set(sceneTake(outputId, null, by))
    get().updateOutput(outputId, { sceneId: undefined })
  },
  saveScenePreset: (scene, name) => {
    const n = name.trim().slice(0, 80)
    if (!n) return
    const same = get().scenePresets.find((p) => p.name.toLowerCase() === n.toLowerCase())
    const preset = { ...presetFromScene(scene, n), ...(same ? { id: same.id, createdAt: same.createdAt } : {}) }
    set({ scenePresets: same ? get().scenePresets.map((p) => (p.id === same.id ? preset : p)) : [...get().scenePresets, preset] })
  },
  renameScenePreset: (id, name) => {
    const n = name.trim().slice(0, 80)
    if (n) set({ scenePresets: get().scenePresets.map((p) => (p.id === id ? { ...p, name: n, updatedAt: Date.now() } : p)) })
  },
  deleteScenePreset: (id) => set({ scenePresets: get().scenePresets.filter((p) => p.id !== id) }),
  activateSource: (value, itemId = null, by = currentActor()) => {
    const s = get()
    if (s.rehearsal) return
    const id = sourceOf(value)
    set({ sources: { ...s.sources, [id]: { value, itemId, revision: ++activations, activatedAt: Date.now(), ...(by ? { by } : {}), on: true } } })
    get().syncBroadcastOutput()
  },

  // Designer
  setDesignerOpen: (isDesignerOpen) => {
    if (!isDesignerOpen) {
      const was = get().editingThemeId
      set({ isDesignerOpen, editingThemeId: null, draftTheme: null, liveDesign: false, selectedElement: null })
      resyncThemeOutputs(was)
    } else {
      set({ isDesignerOpen })
    }
  },
  resetOutputRuntime: (id) => {
    forgetSignage(id)
    set((s) => {
      if (!s.outputFrames[id]) return s
      const outputFrames = { ...s.outputFrames }
      delete outputFrames[id]
      return { outputFrames }
    })
  },
  startEditing: (themeId) => {
    const theme = get().themes.find((t) => t.id === themeId)
    if (!theme) return
    const was = get().editingThemeId
    set({
      editingThemeId: themeId,
      draftTheme: { ...theme, updatedAt: Date.now() },
      ...(was !== themeId ? { liveDesign: false } : {}),
      selectedElement: null,
    })
    // Switching to another theme ends the previous draft: its outputs get their saved theme back.
    if (was && was !== themeId) resyncThemeOutputs(was)
  },
  stopEditing: () => {
    const was = get().editingThemeId
    set({
      editingThemeId: null,
      draftTheme: null,
      liveDesign: false,
      selectedElement: null,
    })
    // Outputs may have been showing the draft; put the saved theme back.
    resyncThemeOutputs(was)
  },
  updateDraft: (updates) => {
    set((s) => ({
      draftTheme: s.draftTheme ? { ...s.draftTheme, ...updates, updatedAt: Date.now() } : null,
    }))
    emitDraftToBroadcast(get())
  },
  updateDraftNested: (path, value) => {
    set((s) => ({
      draftTheme: s.draftTheme
        ? (setNestedValue(
            seedSecondaryVerseStyle(s.draftTheme, path) as unknown as Record<string, unknown>,
            path,
            value
          ) as unknown as BroadcastTheme)
        : null,
    }))
    emitDraftToBroadcast(get())
  },
  saveDraft: () => {
    const { draftTheme: edited } = get()
    if (!edited) return
    // A hand edit detaches a Brand Kit theme, so Apply never overwrites it again.
    const draftTheme = edited.brandManaged ? { ...edited, brandManaged: false } : edited
    // If editing a builtin, save as a new custom theme
    if (draftTheme.builtin) {
      const customTheme = {
        ...draftTheme,
        id: crypto.randomUUID(),
        name: `${draftTheme.name} (Custom)`,
        builtin: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      set((s) => ({
        themes: [...s.themes, customTheme],
        editingThemeId: customTheme.id,
        draftTheme: customTheme,
      }))
      // Point every output that was on the builtin at the saved copy, so the
      // outputs and the in-app preview never disagree about what is showing.
      for (const output of get().outputs) {
        if (themeIdsOf(output).includes(draftTheme.id)) {
          get().setOutputTheme(output.id, customTheme.id)
        }
      }
    } else {
      get().saveTheme(draftTheme)
      // The draft is now what was saved (a Brand Kit theme is detached in both).
      set({ draftTheme })
    }
  },
  discardDraft: () => {
    const { editingThemeId } = get()
    if (editingThemeId) {
      get().startEditing(editingThemeId)
      resyncThemeOutputs(editingThemeId)
    }
  },
  setLiveDesign: (liveDesign) => {
    if (liveDesign === get().liveDesign) return
    set({ liveDesign })
    // On: the outputs on this theme show the draft; off: their saved theme again.
    resyncThemeOutputs(get().editingThemeId)
  },
  setSelectedElement: (selectedElement) => set({ selectedElement }),
  setRenamingTheme: (id) => set({ renamingThemeId: id }),
}))

// ── Theme persistence via tauri-plugin-store ──

let tauriStore: Store | null = null
let hydrationPromise: Promise<void> | null = null

async function getThemeStore(): Promise<Store> {
  if (!tauriStore) {
    tauriStore = await load("broadcast-themes.json", { autoSave: false, defaults: {} })
  }
  return tauriStore
}

export function hydrateBroadcastThemes(): Promise<void> {
  if (hydrationPromise) return hydrationPromise
  hydrationPromise = (async () => {
    try {
      const store = await getThemeStore()
      const customThemes = (await store.get("customThemes")) as BroadcastTheme[] | undefined
      const outputs = (await store.get("outputs")) as BroadcastOutput[] | undefined
      const activeId = (await store.get("activeThemeId")) as string | undefined
      const altActiveId = (await store.get("altActiveThemeId")) as string | undefined
      // A new key: builds before this one saved "autoLive" (default on) whenever a theme or
      // output changed, so that value is not a choice. Only a choice made here counts.
      const autoLive = (await store.get("autoLiveOptIn")) as boolean | undefined

      const patch: Partial<BroadcastState> = {}
      if (customThemes && Array.isArray(customThemes) && customThemes.length > 0) {
        patch.themes = [...BUILTIN_THEMES, ...customThemes.map(normalizeTheme)]
      }
      patch.outputs =
        outputs && Array.isArray(outputs) && outputs.length > 0
          ? outputs
          : migrateLegacyOutputs(activeId, altActiveId)
      const main = patch.outputs.find((o) => o.id === MAIN_OUTPUT_ID)
      if (main) patch.activeThemeId = main.themeId
      if (typeof autoLive === "boolean") patch.autoLive = autoLive
      // Its own key, so a build without "Bible feeds only" reads that choice as Auto off (the safe side).
      if ((await store.get("autoBibleFeeds")) === true && !patch.autoLive) patch.autoBibleFeeds = true
      const ltStyles = (await store.get("lowerThirdStyles")) as LowerThirdStyle[] | undefined
      if (Array.isArray(ltStyles) && ltStyles.length > 0) patch.lowerThirdStyles = ltStyles.map(normalizeLowerThirdStyle)
      patch.designDrafts = normalizeDesignDrafts(await store.get("designDrafts"))
      patch.tickerStyle = normalizeTickerStyle((await store.get("tickerStyle")) as Partial<TickerStyle> | undefined)
      patch.stageStyle = normalizeStageStyle((await store.get("stageStyle")) as Partial<StageStyle> | undefined)
      patch.countdownLook = normalizeCountdownLook((await store.get("countdownLook")) as Partial<CountdownLook> | undefined)
      const scenes = await store.get("scenes")
      if (Array.isArray(scenes)) patch.scenes = scenes.map(normalizeScene).filter((x): x is Scene => x !== null)
      const scenePresets = await store.get("scenePresets")
      if (Array.isArray(scenePresets)) patch.scenePresets = scenePresets.map(normalizeScene).filter((x): x is Scene => x !== null)
      const items = await store.get("tickerItems")
      if (Array.isArray(items)) patch.tickerItems = items.filter((i): i is string => typeof i === "string")
      patch.tickerPresets = normalizePresets(await store.get("tickerPresets"))
      patch.outputs = patch.outputs?.map((output) => withSceneSnapshot(output, patch.scenes ?? useBroadcastStore.getState().scenes))

      useBroadcastStore.setState(patch)

      // Auto-persist on changes (debounced)
      useBroadcastStore.subscribe((state, prevState) => {
        const changed =
          state.themes !== prevState.themes ||
          state.activeThemeId !== prevState.activeThemeId ||
          state.outputs !== prevState.outputs ||
          state.autoLive !== prevState.autoLive ||
          state.autoBibleFeeds !== prevState.autoBibleFeeds ||
          state.lowerThirdStyles !== prevState.lowerThirdStyles ||
          state.designDrafts !== prevState.designDrafts ||
          state.tickerStyle !== prevState.tickerStyle ||
          state.stageStyle !== prevState.stageStyle ||
          state.countdownLook !== prevState.countdownLook ||
          state.tickerItems !== prevState.tickerItems ||
          state.tickerPresets !== prevState.tickerPresets ||
          state.scenes !== prevState.scenes ||
          state.scenePresets !== prevState.scenePresets
        if (!changed) return
        if (saveTimer) clearTimeout(saveTimer)
        saveTimer = setTimeout(() => {
          saveTimer = null
          pendingSave = pendingSave.then(() =>
            persistBroadcastThemes(useBroadcastStore.getState())
          )
        }, SAVE_DEBOUNCE_MS)
      })
    } catch {
      console.warn("[broadcast] Failed to load persisted themes, using defaults")
    }
  })()
  return hydrationPromise
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingSave: Promise<void> = Promise.resolve()
const SAVE_DEBOUNCE_MS = 500

/** Write a waiting (debounced) themes/outputs save now; closing the app awaits it. */
export function flushThemeSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    pendingSave = pendingSave.then(() => persistBroadcastThemes(useBroadcastStore.getState()))
  }
  return pendingSave
}

/**
 * The looks and screens as a backup file carries them (#298 E6): the church's own themes, the
 * outputs (without their browser-feed link secrets), lower thirds, the ticker and stage looks,
 * scenes and the Auto choices. The same values the themes file keeps, never a rehearsal scene.
 */
export interface LooksBackup {
  customThemes: BroadcastTheme[]
  outputs: BroadcastOutput[]
  lowerThirdStyles: LowerThirdStyle[]
  /** Drafts are optional in older backup files and never applied while restoring. */
  designDrafts?: DesignDraft[]
  tickerStyle: TickerStyle
  stageStyle: StageStyle
  /** Absent from backups made before the countdown display. */
  countdownLook?: CountdownLook
  tickerItems: string[]
  tickerPresets: BroadcastState["tickerPresets"]
  scenes: Scene[]
  scenePresets: Scene[]
  autoLive: boolean
  autoBibleFeeds: boolean
}

/** A paired TV as a backup keeps it: without its own key (#198). */
function withoutTvKey(tv: ReceiverTv): ReceiverTv {
  const copy = { ...tv }
  delete copy.token
  return copy
}

export function looksForBackup(state: BroadcastState = useBroadcastStore.getState()): LooksBackup {
  return {
    customThemes: state.themes.filter((t) => !t.builtin),
    outputs: outputsForScreens(state).map((o) => {
      const copy = { ...o }
      delete copy.feedToken
      // Each TV's own key stays on this computer, like the feed's (#198).
      if (copy.tvs) copy.tvs = copy.tvs.map(withoutTvKey)
      return copy
    }),
    lowerThirdStyles: state.lowerThirdStyles,
    designDrafts: state.designDrafts,
    tickerStyle: state.tickerStyle,
    stageStyle: state.stageStyle,
    countdownLook: state.countdownLook,
    tickerItems: state.tickerItems,
    tickerPresets: state.tickerPresets,
    scenes: state.scenes,
    scenePresets: state.scenePresets,
    autoLive: state.autoLive,
    autoBibleFeeds: state.autoBibleFeeds,
  }
}

const isOutput = (o: unknown): o is BroadcastOutput => {
  const x = o as BroadcastOutput
  return typeof o === "object" && o !== null && typeof x.id === "string" && typeof x.name === "string" && typeof x.type === "string" && typeof x.themeId === "string" && typeof x.ndi === "object" && x.ndi !== null
}
const isTheme = (t: unknown): t is BroadcastTheme => typeof t === "object" && t !== null && typeof (t as BroadcastTheme).id === "string" && typeof (t as BroadcastTheme).name === "string"

/**
 * Put a backup's looks and screens in place, read as the themes file is read: a part that is
 * missing or of the wrong shape leaves this computer's as it is. A browser feed on this computer
 * keeps its link (a new feed gets a new one). Only when nothing is on air (the caller checks).
 */
export function restoreLooksFromBackup(raw: unknown): void {
  if (typeof raw !== "object" || raw === null) return
  const looks = raw as Partial<Record<keyof LooksBackup, unknown>>
  const here = useBroadcastStore.getState()
  const patch: Partial<BroadcastState> = {}
  if (Array.isArray(looks.customThemes)) patch.themes = [...BUILTIN_THEMES, ...looks.customThemes.filter(isTheme).filter((t) => !t.builtin).map(normalizeTheme)]
  if (Array.isArray(looks.outputs) && looks.outputs.some(isOutput)) {
    const outputs = looks.outputs.filter(isOutput).map((o) => {
      const mine = here.outputs.find((h) => h.id === o.id)
      const token = mine?.feedToken
      const copy = { ...o }
      delete copy.feedToken
      // The TVs paired here (with their own keys) stay; a backup's list has no keys.
      if (o.type === "browser" && mine?.tvs) copy.tvs = mine.tvs
      else if (copy.tvs) copy.tvs = copy.tvs.map(withoutTvKey)
      return o.type === "browser" && token ? { ...copy, feedToken: token } : copy
    })
    patch.outputs = outputs.some((o) => o.id === MAIN_OUTPUT_ID) ? outputs : [...here.outputs.filter((o) => o.id === MAIN_OUTPUT_ID), ...outputs]
    const main = patch.outputs.find((o) => o.id === MAIN_OUTPUT_ID)
    if (main) patch.activeThemeId = main.themeId
  }
  if (Array.isArray(looks.lowerThirdStyles) && looks.lowerThirdStyles.length > 0) patch.lowerThirdStyles = looks.lowerThirdStyles.filter((x) => typeof x === "object" && x !== null).map((x) => normalizeLowerThirdStyle(x as LowerThirdStyle))
  if (Array.isArray(looks.designDrafts)) patch.designDrafts = normalizeDesignDrafts(looks.designDrafts)
  if (typeof looks.tickerStyle === "object" && looks.tickerStyle !== null) patch.tickerStyle = normalizeTickerStyle(looks.tickerStyle as Partial<TickerStyle>)
  if (typeof looks.stageStyle === "object" && looks.stageStyle !== null) patch.stageStyle = normalizeStageStyle(looks.stageStyle as Partial<StageStyle>)
  if (typeof looks.countdownLook === "object" && looks.countdownLook !== null) patch.countdownLook = normalizeCountdownLook(looks.countdownLook as Partial<CountdownLook>)
  if (Array.isArray(looks.scenes)) patch.scenes = looks.scenes.map(normalizeScene).filter((x): x is Scene => x !== null)
  if (Array.isArray(looks.scenePresets)) patch.scenePresets = looks.scenePresets.map(normalizeScene).filter((x): x is Scene => x !== null)
  if (Array.isArray(looks.tickerItems)) patch.tickerItems = looks.tickerItems.filter((i): i is string => typeof i === "string")
  if (looks.tickerPresets !== undefined) patch.tickerPresets = normalizePresets(looks.tickerPresets)
  if (typeof looks.autoLive === "boolean") patch.autoLive = looks.autoLive
  if (typeof looks.autoBibleFeeds === "boolean") patch.autoBibleFeeds = looks.autoBibleFeeds && !(patch.autoLive ?? here.autoLive)
  if (patch.outputs) patch.outputs = patch.outputs.map((output) => withSceneSnapshot(output, patch.scenes ?? here.scenes))
  useBroadcastStore.setState(patch)
}

/** The theme open in the Designer has changes that are not saved. */
export function themeDraftChanged(): boolean {
  const { draftTheme, themes, editingThemeId } = useBroadcastStore.getState()
  if (!draftTheme) return false
  const saved = themes.find((t) => t.id === editingThemeId)
  if (!saved) return false // the theme was deleted: nothing left to save it over
  return JSON.stringify({ ...draftTheme, updatedAt: 0 }) !== JSON.stringify({ ...saved, updatedAt: 0 })
}

async function persistBroadcastThemes(state: BroadcastState): Promise<void> {
  try {
    const store = await getThemeStore()
    const customThemes = state.themes.filter((t) => !t.builtin)
    await store.set("customThemes", customThemes)
    // Never a scene taken in rehearsal: a restart would put it on the screens.
    await store.set("outputs", outputsForScreens(state))
    // Legacy mirror of the main output's theme; older builds still read it.
    await store.set("activeThemeId", state.activeThemeId)
    await store.set("autoLiveOptIn", state.autoLive)
    await store.set("autoBibleFeeds", state.autoBibleFeeds)
    await store.set("lowerThirdStyles", state.lowerThirdStyles)
    await store.set("designDrafts", state.designDrafts)
    await store.set("tickerStyle", state.tickerStyle)
    await store.set("stageStyle", state.stageStyle)
    await store.set("countdownLook", state.countdownLook)
    await store.set("tickerItems", state.tickerItems)
    await store.set("tickerPresets", state.tickerPresets)
    await store.set("scenes", state.scenes)
    await store.set("scenePresets", state.scenePresets)
    await store.save()
  } catch {
    console.warn("[broadcast] Failed to persist themes")
  }
}

/**
 * The one output that plays a video's sound: the main output when it shows the congregation,
 * else the first congregation output whose window is open, else the first congregation output.
 * (It used to be the output with id "main" whatever its role, so a stage or signage main
 * output left every video silent.)
 */
export function soundOutputId(outputs: BroadcastOutput[], status: Record<string, { previewOpen?: boolean } | undefined>): string | null {
  // A ticker-only or lower-third-only feed never shows a video, so it never plays one's sound.
  const congregation = outputs.filter((o) => (o.role ?? "congregation") === "congregation" && !followsOnlyOverlays(o))
  const main = congregation.find((o) => o.id === MAIN_OUTPUT_ID)
  if (main) return main.id
  return (congregation.find((o) => status[o.id]?.previewOpen) ?? congregation[0])?.id ?? null
}

// When the output that plays video sound changes (a role changed, a window opened or closed), every
// output is told, so the old one stops and only one plays: no echo.
let lastSoundOutput: string | null | undefined
useBroadcastStore.subscribe((s, prev) => {
  if (s.outputs === prev.outputs && s.outputStatus === prev.outputStatus) return
  const now = soundOutputId(s.outputs, s.outputStatus)
  if (lastSoundOutput !== undefined && now !== lastSoundOutput) s.syncBroadcastOutput()
  lastSoundOutput = now
})

/** A camera's backup camera, by the router's names (#213). */
function cameraBackup(name: string): string | undefined {
  const cams = useSettingsStore.getState().cameras
  const b = cams.find((c) => c.name === name)?.backup
  return b && b !== name && cams.some((c) => c.name === b) ? b : undefined
}

/** What the router last said of a camera that cannot be shown (#213). */
function cameraDown(name: string) {
  return cameraDownState(useRouterHealth.getState(), name, useSettingsStore.getState().cameras)
}

/** The church's time zone when a build sets one (Setup), else "" (this computer's clock). */
function churchZone(): string {
  const z = (useSettingsStore.getState().setup as { timeZone?: unknown }).timeZone
  if (typeof z !== "string" || !z) return ""
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z })
    return z
  } catch {
    return ""
  }
}

/** A countdown display's frame: what its look counts now, the item on now and the next one. */
function stageCountdownFrame(s: BroadcastState, items: QueueItemLike[], activeIndex: number | null) {
  const zone = churchZone()
  const counting = lookCounting(s.countdownLook, s.countdownSources, useTimerStore.getState().timer, monotonicNow(), Date.now(), zone, s.countdowns)
  const item = activeIndex === null ? null : items[activeIndex]?.reference ?? null
  const next = items.find((it, k) => k > (activeIndex ?? -1) && !it.hidden)?.reference ?? null
  // A browser feed's screen may be set to another zone: the time of day is the church's (or this computer's).
  const frame = countdownFrame(s.countdownLook, counting, { item, next, zone: zone || Intl.DateTimeFormat().resolvedOptions().timeZone || "" })
  // The stage design's clock choices (#196 R2.6) reach the countdown display's time of day too.
  const st = s.stageStyle
  return { ...frame, ...(st.clockHours ? { hours: st.clockHours } : st.showClock ? { hours: 24 as const } : {}), ...(st.showClock && st.secondZone ? { zone2: { label: st.secondZoneLabel?.trim() || zoneCity(st.secondZone), zone: st.secondZone } } : {}) }
}
type QueueItemLike = { reference: string; hidden?: boolean | null }

/** Stage outputs that show the countdown display. */
function syncCountdownOutputs(): void {
  const s = useBroadcastStore.getState()
  for (const o of s.outputs) if (o.role === "stage" && o.stageLayout === "countdown") s.syncBroadcastOutputFor(o.id)
}

// Stage outputs also follow the rundown (what is next) and the timer.
function syncStageOutputs(): void {
  const s = useBroadcastStore.getState()
  for (const o of s.outputs) if (o.role === "stage") s.syncBroadcastOutputFor(o.id)
}
useQueueStore.subscribe((state, prev) => {
  if (state.items !== prev.items || state.activeIndex !== prev.activeIndex) syncStageOutputs()
})
useTimerStore.subscribe(syncStageOutputs)
// Clock layers work out the time themselves: resend only when the timer starts, stops or changes.
useTimerStore.subscribe((s, prev) => {
  if (s.timer === prev.timer) return
  const b = useBroadcastStore.getState()
  for (const o of b.outputs) {
    const scene = sceneForOutput(o, b.scenes)
    if (scene?.layers.some((l) => l.kind === "clock" && l.visible)) b.syncBroadcastOutputFor(o.id)
  }
})
// The service timer as a live source (ADR 0001): who started, paused or resumed it and when, from
// wherever that was done (Present, a cue, a joined desk). Back to idle (reset) it is no source.
useTimerStore.subscribe((t, prev) => {
  if (t.timer === prev.timer) return
  const s = useBroadcastStore.getState()
  if (s.rehearsal) return
  const running = t.timer.startedAt !== null
  if (!running && t.timer.accumulatedMs === 0) {
    if (!s.stateSources.timer) return
    const stateSources = { ...s.stateSources }
    delete stateSources.timer
    useBroadcastStore.setState({ stateSources })
    return
  }
  if (running !== (prev.timer.startedAt !== null) || !s.stateSources.timer) markSource("timer", running)
})
// A camera's backup (Production → Cameras) and what the router says of each camera (#213): the
// scenes on air follow, so a frozen camera shows its fallback and an output's other camera steps in.
let lastCameraKey = ""
function syncCameraScenes(): void {
  const b = useBroadcastStore.getState()
  const cams = useSettingsStore.getState().cameras
  const key = cams.map((c) => `${c.name}>${c.backup ?? ""}:${cameraDown(c.name) ?? "ok"}`).join(",")
  if (key === lastCameraKey) return
  lastCameraKey = key
  for (const o of b.outputs) if (showsSceneWith(o, "camera")) b.syncBroadcastOutputFor(o.id)
}
useRouterHealth.subscribe(syncCameraScenes)
useSettingsStore.subscribe((s, prev) => { if (s.cameras !== prev.cameras) syncCameraScenes() })
// A logo layer shows the Brand Kit logo: a new logo reaches the scenes on air.
useSettingsStore.subscribe((s, prev) => {
  if (s.brandKit.logoUrl === prev.brandKit.logoUrl) return
  const b = useBroadcastStore.getState()
  for (const o of b.outputs) if (showsSceneWith(o, "logo")) b.syncBroadcastOutputFor(o.id)
})
