import { create } from "zustand"
import { emitTo } from "@tauri-apps/api/event"
import { load, type Store } from "@tauri-apps/plugin-store"
import type {
  BroadcastOutput,
  BroadcastOutputStatus,
  BroadcastTheme,
  Verse,
  VerseRenderData, LowerThird } from "@/types"
import { MAIN_OUTPUT_ID, defaultNdiSettings, outputWindowLabel } from "@/types"
import { BUILTIN_THEMES, LOWER_THIRDS, CLASSIC_DARK } from "@/lib/builtin-themes"
import { normalizeTheme } from "@/lib/theme-migrations"
import type { ItemTranslations } from "@/lib/translation-policy"
import { applyBrandKit, type BrandKit } from "@/lib/brand-kit"
import { buildStagePayload } from "@/lib/stage"
import { useQueueStore } from "@/stores/queue-store"
import { monotonicNow, useTimerStore } from "@/stores/timer-store"
import { useSongStore } from "@/stores/song-store"
import { forOutputLanguage } from "@/lib/output-language"
import { activePlaylist, signageFrame, signageIndex } from "@/lib/signage"
import { useMediaStore } from "@/stores/media-store"

/** What was live before a quick screen took over, so Back can return to it. */
export interface HeldLive {
  liveVerse: VerseRenderData
  liveSourceVerse: Verse | null
  liveItem: ItemTranslations | null
  liveSlide: LiveSlide | null
  liveItemId: string | null
  wasLive: boolean
}

/** The song slide on the output: which rundown item, song and step. */
export interface LiveSlide {
  itemId: string
  songId: string
  index: number
  total: number
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
  /** Private note shown on stage outputs only. Not persisted. */
  stageMessage: string
  /** The lower third on air (outputs with lowerThirds on), or null. Session state; not saved. */
  lowerThird: LowerThird | null
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
   * Turning it off sends the current state to every output. Not persisted.
   */
  rehearsal: boolean
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
  selectedElement: SelectedElement

  // Theme management
  loadThemes: () => void
  saveTheme: (theme: BroadcastTheme) => void
  applyBrandKit: (kit: BrandKit) => void
  deleteTheme: (id: string) => void
  duplicateTheme: (id: string) => void
  createNewTheme: (layoutKind?: NewThemeLayoutKind) => void
  renameTheme: (id: string, name: string) => void
  togglePinTheme: (id: string) => void
  setActiveTheme: (id: string) => void
  setLive: (live: boolean) => void
  /** `goLive` puts the output on air in the same update as the verse, so no stale frame shows first. */
  setLiveVerse: (verse: VerseRenderData | null, source?: Verse | null, opts?: { goLive?: boolean; item?: ItemTranslations | null; slide?: LiveSlide | null; itemId?: string | null; keepHeld?: boolean }) => void
  setPresentWarning: (warning: string | null) => void
  setStageMessage: (message: string) => void
  setRehearsal: (on: boolean) => void
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
  const stamp = `${listKey}:${index}:${ids[index] ?? ""}:${theme.id}:${theme.updatedAt ?? ""}`
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
  recordFrame(output.id, { theme, verse, overlay: null })
  void emitTo(outputWindowLabel(output.id), "broadcast:verse-update", { theme, verse }).catch(() => {})
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
  /** Stage outputs: the thumbnail says "Stage display" instead of a frame. */
  stage?: boolean
}

/** Keep what an output was last sent, for the multiview. Skips the write when nothing changed. */
/** After a theme draft ends (saved, discarded, closed, switched), outputs that were shown the draft get the saved theme again. */
function resyncThemeOutputs(themeId: string | null): void {
  if (!themeId) return
  const s = useBroadcastStore.getState()
  for (const o of s.outputs) if (o.themeId === themeId) s.syncBroadcastOutputFor(o.id)
}

function recordFrame(id: string, frame: OutputFrame): void {
  const prev = useBroadcastStore.getState().outputFrames[id]
  if (prev && prev.theme === frame.theme && prev.verse === frame.verse && prev.overlay === frame.overlay && prev.stage === frame.stage) return
  useBroadcastStore.setState((s) => ({ outputFrames: { ...s.outputFrames, [id]: frame } }))
}

function emitDraftToBroadcast(state: BroadcastState): void {
  // Rehearsal freezes every real output, theme edits included.
  if (!state.draftTheme || state.rehearsal) return
  const verse = state.isLive ? state.liveVerse : null
  for (const output of state.outputs) {
    if (output.themeId !== state.editingThemeId || output.role === "stage" || output.role === "signage") continue
    const frame = { theme: state.draftTheme, verse: forOutputLanguage(verse, output.language), overlay: output.lowerThirds ? state.lowerThird : null }
    recordFrame(output.id, frame)
    void emitTo(outputWindowLabel(output.id), "broadcast:verse-update", {
      ...frame,
      // (overlay rides along: the output window replaces its whole payload, so without it the band vanishes)
    }).catch(() => {})
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
  stageMessage: "",
  lowerThird: null,
  outputFrames: {},
  rehearsal: false,
  presentWarning: null,
  // Off until the operator turns it on (PRD FR-01: speech suggestions are proposals unless an
  // automation is explicitly enabled; AI-001 "no AI output auto-live"). A saved choice is kept.
  autoLive: false,
  isDesignerOpen: false,
  editingThemeId: null,
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
  applyBrandKit: (kit) => set((s) => ({ themes: applyBrandKit(kit, s.themes) })),
  deleteTheme: (id) =>
    set((s) => ({ themes: s.themes.filter((t) => t.id !== id || t.builtin) })),
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
        t.id === id && !t.builtin ? { ...t, name, updatedAt: Date.now() } : t
      ),
      draftTheme:
        s.draftTheme?.id === id ? { ...s.draftTheme, name, updatedAt: Date.now() } : s.draftTheme,
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
    const theme = s.themes.find((t) => t.id === output.themeId) ?? s.themes[0]
    if (!theme) return

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
        theme,
        verse: null,
        role: "stage",
        stage: buildStagePayload({
          isLive: s.isLive, liveVerse: s.liveVerse, items: q.items, activeIndex: q.activeIndex, timer: useTimerStore.getState().timer, now: monotonicNow(), message: s.stageMessage,
          song: s.liveSlide ? (useSongStore.getState().songs[s.liveSlide.songId]?.song ?? null) : null,
        }),
      }).catch(() => {})
      return
    }
    const verse = s.isLive ? forOutputLanguage(s.liveVerse, output.language) : null
    const overlay = output.lowerThirds ? s.lowerThird : null
    // Only a real change of screen is timed (QA-007); resends after a window opens are not.
    const changed = get().outputFrames[outputId]?.verse !== verse
    recordFrame(outputId, { theme, verse, overlay })
    void emitTo(outputWindowLabel(outputId), "broadcast:verse-update", {
      theme,
      verse,
      overlay,
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
    if (patch.themeId || "language" in patch || "role" in patch || "signage" in patch || "lowerThirds" in patch) get().syncBroadcastOutputFor(id)
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
    set({ isLive })
    get().syncBroadcastOutput()
  },
  setLiveVerse: (liveVerse, source = null, opts = {}) => {
    set({
      liveVerse,
      liveSourceVerse: source,
      liveItem: opts.item ?? null,
      liveSlide: opts.slide ?? null,
      liveItemId: opts.itemId ?? opts.slide?.itemId ?? null,
      heldLive: opts.keepHeld ? get().heldLive : null,
      presentWarning: null,
      ...(opts.goLive ? { isLive: true } : {}),
    })
    get().syncBroadcastOutput()
  },
  setPresentWarning: (presentWarning) => set({ presentWarning }),
  setRehearsal: (rehearsal) => {
    set({ rehearsal })
    if (!rehearsal) get().syncBroadcastOutput()
  },
  setLowerThird: (lt) => {
    const clean = lt && (lt.line1.trim() || lt.line2.trim()) ? { line1: lt.line1.trim(), line2: lt.line2.trim() } : null
    set({ lowerThird: clean })
    for (const o of get().outputs) if (o.lowerThirds && (o.role ?? "congregation") === "congregation") get().syncBroadcastOutputFor(o.id)
  },
  setStageMessage: (stageMessage) => {
    set({ stageMessage })
    for (const o of get().outputs) if (o.role === "stage") get().syncBroadcastOutputFor(o.id)
  },
  holdLive: () => {
    const s = get()
    if (s.heldLive || !s.liveVerse) return
    set({ heldLive: { liveVerse: s.liveVerse, liveSourceVerse: s.liveSourceVerse, liveItem: s.liveItem, liveSlide: s.liveSlide, liveItemId: s.liveItemId, wasLive: s.isLive } })
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
      isLive: held.wasLive,
    })
    get().syncBroadcastOutput()
    return true
  },
  setAutoLive: (autoLive) => set({ autoLive }),

  // Designer
  setDesignerOpen: (isDesignerOpen) => {
    if (!isDesignerOpen) {
      const was = get().editingThemeId
      set({ isDesignerOpen, editingThemeId: null, draftTheme: null, selectedElement: null })
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
        if (output.themeId === draftTheme.id) {
          get().setOutputTheme(output.id, customTheme.id)
        }
      }
    } else {
      get().saveTheme(draftTheme)
    }
  },
  discardDraft: () => {
    const { editingThemeId } = get()
    if (editingThemeId) {
      get().startEditing(editingThemeId)
      resyncThemeOutputs(editingThemeId)
    }
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
      const autoLive = (await store.get("autoLive")) as boolean | undefined

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

      useBroadcastStore.setState(patch)

      // Auto-persist on changes (debounced)
      useBroadcastStore.subscribe((state, prevState) => {
        const changed =
          state.themes !== prevState.themes ||
          state.activeThemeId !== prevState.activeThemeId ||
          state.outputs !== prevState.outputs ||
          state.autoLive !== prevState.autoLive
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

async function persistBroadcastThemes(state: BroadcastState): Promise<void> {
  try {
    const store = await getThemeStore()
    const customThemes = state.themes.filter((t) => !t.builtin)
    await store.set("customThemes", customThemes)
    await store.set("outputs", state.outputs)
    // Legacy mirror of the main output's theme; older builds still read it.
    await store.set("activeThemeId", state.activeThemeId)
    await store.set("autoLive", state.autoLive)
    await store.save()
  } catch {
    console.warn("[broadcast] Failed to persist themes")
  }
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
