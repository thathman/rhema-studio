import { create } from "zustand"
import { emitTo } from "@tauri-apps/api/event"
import { load, type Store } from "@tauri-apps/plugin-store"
import type {
  SongWithSections,
  BroadcastOutput,
  BroadcastOutputStatus,
  BroadcastTheme,
  Verse,
  VerseRenderData, LowerThird, LowerThirdStyle, StageAux, StageFinish, StageStyle, Ticker, TickerPreset, TickerStyle } from "@/types"
import { MAIN_OUTPUT_ID, defaultNdiSettings, outputWindowLabel } from "@/types"
import { BUILTIN_THEMES, LOWER_THIRDS, CLASSIC_DARK } from "@/lib/builtin-themes"
import { normalizeTheme } from "@/lib/theme-migrations"
import type { ItemTranslations } from "@/lib/translation-policy"
import { applyBrandKit, type BrandKit } from "@/lib/brand-kit"
import { buildStagePayload } from "@/lib/stage"
import { applyStageStyle, DEFAULT_STAGE_STYLE, normalizeStageStyle } from "@/lib/stage-style"
import { useQueueStore } from "@/stores/queue-store"
import { monotonicNow, useTimerStore } from "@/stores/timer-store"
import { useSongStore } from "@/stores/song-store"
import { forOutputLanguage } from "@/lib/output-language"
import { activePlaylist, signageFrame, signageIndex } from "@/lib/signage"
import { themeIdFor, themeIdsOf } from "@/lib/output-themes"
import { DEFAULT_LOWER_THIRD_STYLE, normalizeLowerThirdStyle, overlayFor } from "@/lib/lower-third-style"
import { DEFAULT_TICKER_STYLE, normalizePresets, normalizeTickerStyle } from "@/lib/ticker"
import { useMediaStore } from "@/stores/media-store"

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
  /** Auxiliary timers shown on the stage (kept by aux-timers-store.ts). */
  stageAux: StageAux[]
  setStageAux: (aux: StageAux[]) => void
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
   * only `keepRehearsed` sends what was rehearsed. Not persisted.
   */
  rehearsal: boolean
  /** The real program while rehearsal runs, put back when it ends. */
  rehearsalReturn: ProgramSnapshot | null
  /** Why the last present did not reach the output; cleared by the next successful present. */
  presentWarning: string | null
  // When on, detections auto-present to the live output. When off, the live
  // output only changes via explicit presents (manual operator control).
  autoLive: boolean

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
  setLiveVerse: (verse: VerseRenderData | null, source?: Verse | null, opts?: { goLive?: boolean; item?: ItemTranslations | null; slide?: LiveSlide | null; itemId?: string | null; keepHeld?: boolean; follow?: boolean }) => void
  setPresentWarning: (warning: string | null) => void
  setStageMessage: (message: string) => void
  /** Off puts back the program from before rehearsal, unless `keepRehearsed` (a deliberate go-live). */
  setRehearsal: (on: boolean, opts?: { keepRehearsed?: boolean }) => void
  /** Remember the current live content (if any) before a quick screen replaces it. */
  holdLive: () => void
  /** Put the held content back on air (or off air, as it was) and forget it. */
  releaseHeld: () => boolean
  setAutoLive: (auto: boolean) => void
  syncBroadcastOutput: () => void
  syncBroadcastOutputFor: (outputId: string) => void

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
  const ticker = output.ticker ? useBroadcastStore.getState().ticker : null
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
  void emitTo(outputWindowLabel(output.id), "broadcast:verse-update", { theme, verse, ticker }).catch(() => {})
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

export interface OutputFrame {
  theme: BroadcastTheme
  verse: VerseRenderData | null
  overlay: LowerThird | null
  ticker?: Ticker | null
  /** Stage outputs: the thumbnail says "Stage display" instead of a frame. */
  stage?: boolean
}

/** Keep what an output was last sent, for the multiview. Skips the write when nothing changed. */
/** Send the ticker (on, changed or off) to the outputs that show it. */
function syncTickerOutputs(): void {
  const s = useBroadcastStore.getState()
  // Never the stage; signage (the foyer) when it is turned on there.
  for (const o of s.outputs) if (o.ticker && o.role !== "stage") s.syncBroadcastOutputFor(o.id)
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
  for (const o of s.outputs) if (themeIdsOf(o).includes(themeId)) s.syncBroadcastOutputFor(o.id)
}

function recordFrame(id: string, frame: OutputFrame): void {
  const prev = useBroadcastStore.getState().outputFrames[id]
  if (prev && prev.theme === frame.theme && prev.verse === frame.verse && prev.overlay === frame.overlay && prev.ticker === frame.ticker && prev.stage === frame.stage) return
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
  cleared: false,
  stageMessage: "",
  lowerThird: null,
  lowerThirdStyles: [DEFAULT_LOWER_THIRD_STYLE],
  ticker: null,
  tickerItems: [],
  tickerStyle: DEFAULT_TICKER_STYLE,
  stageStyle: DEFAULT_STAGE_STYLE,
  stageFinish: null,
  stageAux: [],
  setStageAux: (stageAux) => {
    set({ stageAux })
    for (const o of get().outputs) if (o.role === "stage") get().syncBroadcastOutputFor(o.id)
  },
  setStageFinish: (stageFinish) => {
    set({ stageFinish })
    for (const o of get().outputs) if (o.role === "stage") get().syncBroadcastOutputFor(o.id)
  },
  saveStageStyle: (stageStyle) => {
    set({ stageStyle: normalizeStageStyle(stageStyle) })
    get().syncBroadcastOutput()
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
    const themeId = themeIdFor(output, s.isLive ? s.liveVerse?.content : null)
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
      void emitTo(outputWindowLabel(outputId), "broadcast:verse-update", {
        // The stage window draws no theme: send the built-in one (no pictures) rather than the
        // output's, whose pictures can be megabytes, with every timer tick (NFR-03).
        theme: CLASSIC_DARK,
        verse: null,
        role: "stage",
        stage: applyStageStyle({ ...buildStagePayload({
          isLive: s.isLive, liveVerse: s.liveVerse, items: q.items, activeIndex: q.activeIndex, timer: useTimerStore.getState().timer, now: monotonicNow(), message: s.stageMessage,
          song: s.liveSlide ? (useSongStore.getState().songs[s.liveSlide.songId]?.song ?? null) : null,
        }), finish: s.stageFinish, aux: s.stageAux }, s.stageStyle),
      }).catch(() => {})
      return
    }
    const verse = s.isLive ? forOutputLanguage(s.liveVerse, output.language) : null
    const overlay = output.lowerThirds ? overlayFor(s.lowerThird, verse) : null
    // Only a real change of screen is timed (QA-007); resends after a window opens are not.
    const changed = get().outputFrames[outputId]?.verse !== verse
    const ticker = output.ticker ? s.ticker : null
    recordFrame(outputId, { theme, verse, overlay, ticker })
    void emitTo(outputWindowLabel(outputId), "broadcast:verse-update", {
      theme,
      verse,
      overlay,
      ticker,
      sound: soundOutputId(get().outputs, get().outputStatus) === outputId,
      ...(changed ? { sentAt: Date.now() } : {}),
    }).catch(() => {})
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
        : [...s.outputs, output],
    })),
  updateOutput: (id, patch) => {
    set((s) => ({
      outputs: s.outputs.map((o) => (o.id === id ? { ...o, ...patch, id } : o)),
      ...(id === MAIN_OUTPUT_ID && patch.themeId
        ? { activeThemeId: patch.themeId }
        : {}),
    }))
    if ("role" in patch && patch.role !== "signage") forgetSignage(id)
    if (patch.themeId || "themeFor" in patch || "language" in patch || "role" in patch || "signage" in patch || "lowerThirds" in patch) get().syncBroadcastOutputFor(id)
  },
  removeOutput: (id) => {
    if (id === MAIN_OUTPUT_ID) return
    forgetSignage(id)
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
      if (prev && prev.previewOpen === next.previewOpen && prev.ndiActive === next.ndiActive && (prev.ndiError ?? null) === (next.ndiError ?? null) && (prev.ndiReceivers ?? null) === (next.ndiReceivers ?? null)) {
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
    get().syncBroadcastOutput()
  },
  setPresentWarning: (presentWarning) => set({ presentWarning }),
  setRehearsal: (rehearsal, opts = {}) => {
    const s = get()
    if (rehearsal === s.rehearsal) return
    if (rehearsal) {
      const { isLive, liveVerse, liveSourceVerse, liveItem, liveSlide, liveItemId, heldLive, cleared } = s
      set({ rehearsal, rehearsalReturn: { isLive, liveVerse, liveSourceVerse, liveItem, liveSlide, liveItemId, heldLive, cleared, activeIndex: useQueueStore.getState().activeIndex } })
      return
    }
    const back = opts.keepRehearsed ? null : s.rehearsalReturn
    if (back) {
      const { activeIndex, ...program } = back
      useQueueStore.setState({ activeIndex })
      set({ ...program, rehearsal, rehearsalReturn: null })
    } else {
      set({ rehearsal, rehearsalReturn: null })
    }
    get().syncBroadcastOutput()
  },
  setLowerThird: (lt) => {
    // A strip that follows what is live has no words of its own.
    const clean = lt && (lt.follow || lt.line1.trim() || lt.line2.trim()) ? { ...lt, line1: lt.line1.trim(), line2: lt.line2.trim(), shownAt: Date.now() } : null
    set({ lowerThird: clean })
    for (const o of get().outputs) if (o.lowerThirds && (o.role ?? "congregation") === "congregation") get().syncBroadcastOutputFor(o.id)
  },
  saveLowerThirdStyle: (style, backing) => {
    const styles = get().lowerThirdStyles
    const at = styles.findIndex((x) => x.id === style.id)
    set({ lowerThirdStyles: at < 0 ? [...styles, style] : styles.map((x, i) => (i === at ? style : x)) })
    // The band on air in this style redraws as designed (without coming on again).
    const lt = get().lowerThird
    if (lt?.style?.id === style.id) {
      set({ lowerThird: { ...lt, style, ...(backing !== undefined ? { backing } : {}) } })
      for (const o of get().outputs) if (o.lowerThirds && (o.role ?? "congregation") === "congregation") get().syncBroadcastOutputFor(o.id)
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
    set({ ticker: live })
    syncTickerOutputs()
  },
  pauseTicker: (paused) => {
    const t = get().ticker
    if (!t || !!t.pausedAt === paused) return
    const now = Date.now()
    // Resuming moves the start on by the pause, so the words carry on from where they stopped.
    set({ ticker: paused ? { ...t, pausedAt: now } : { ...t, startedAt: t.startedAt + (now - (t.pausedAt ?? now)), pausedAt: undefined } })
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
    set({ stageMessage })
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
    get().syncBroadcastOutput()
    return true
  },
  setAutoLive: (autoLive) => set({ autoLive }),

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
      const ltStyles = (await store.get("lowerThirdStyles")) as LowerThirdStyle[] | undefined
      if (Array.isArray(ltStyles) && ltStyles.length > 0) patch.lowerThirdStyles = ltStyles.map(normalizeLowerThirdStyle)
      patch.tickerStyle = normalizeTickerStyle((await store.get("tickerStyle")) as Partial<TickerStyle> | undefined)
      patch.stageStyle = normalizeStageStyle((await store.get("stageStyle")) as Partial<StageStyle> | undefined)
      const items = await store.get("tickerItems")
      if (Array.isArray(items)) patch.tickerItems = items.filter((i): i is string => typeof i === "string")
      patch.tickerPresets = normalizePresets(await store.get("tickerPresets"))

      useBroadcastStore.setState(patch)

      // Auto-persist on changes (debounced)
      useBroadcastStore.subscribe((state, prevState) => {
        const changed =
          state.themes !== prevState.themes ||
          state.activeThemeId !== prevState.activeThemeId ||
          state.outputs !== prevState.outputs ||
          state.autoLive !== prevState.autoLive ||
          state.lowerThirdStyles !== prevState.lowerThirdStyles ||
          state.tickerStyle !== prevState.tickerStyle ||
          state.stageStyle !== prevState.stageStyle ||
          state.tickerItems !== prevState.tickerItems ||
          state.tickerPresets !== prevState.tickerPresets
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
    await store.set("outputs", state.outputs)
    // Legacy mirror of the main output's theme; older builds still read it.
    await store.set("activeThemeId", state.activeThemeId)
    await store.set("autoLiveOptIn", state.autoLive)
    await store.set("lowerThirdStyles", state.lowerThirdStyles)
    await store.set("tickerStyle", state.tickerStyle)
    await store.set("stageStyle", state.stageStyle)
    await store.set("tickerItems", state.tickerItems)
    await store.set("tickerPresets", state.tickerPresets)
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
  const congregation = outputs.filter((o) => (o.role ?? "congregation") === "congregation")
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

// Stage outputs also follow the rundown (what is next) and the timer.
function syncStageOutputs(): void {
  const s = useBroadcastStore.getState()
  for (const o of s.outputs) if (o.role === "stage") s.syncBroadcastOutputFor(o.id)
}
useQueueStore.subscribe((state, prev) => {
  if (state.items !== prev.items || state.activeIndex !== prev.activeIndex) syncStageOutputs()
})
useTimerStore.subscribe(syncStageOutputs)
