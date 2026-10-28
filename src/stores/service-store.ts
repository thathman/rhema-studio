import { approvedDesignBlockers, captureApprovedDesigns } from "@/lib/approved-designs"
import { useMediaStore } from "@/stores/media-store"
import { useSettingsStore } from "@/stores/settings-store"
import { create } from "zustand"
import { invoke } from "@tauri-apps/api/core"
import { useQueueStore } from "@/stores/queue-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useBibleStore } from "@/stores/bible-store"
import type {
  ItemInput,
  ApprovedDesignSnapshot,
  Program,
  ProgramItem,
  ProgramWithItems,
  QueueItem,
  MediaAsset,
  AudioItemPayload,
  RevisionSummary,
  ImageItemPayload,
  SlideItemPayload,
  SongItemPayload,
  Translation,
  Verse,
} from "@/types"
import { GO_LIVE_CUES, isAudioItem, isCueItem, isImageItem, isSlideItem, isVerseItem, type ItemCue, type OnLive } from "@/types"
import { cleanCues } from "@/lib/item-cues"
import { safeLink } from "@/lib/qr-bulletin"
import { cleanComments, parseComments } from "@/lib/comments"
import { cleanAssignees, parseAssignees, preparedByText } from "@/lib/assignees"
import { intentPayload, parseItemIntent } from "@/lib/item-intent"
import { itemTimingPayload, parseItemTiming } from "@/lib/item-timing"
import { interleave, parseRunOfShowEvent, type OutlineHeader, type PhaseRole, type PhaseRule } from "@/lib/run-of-show"
import { isContentCommandError, SUPPORTED_ITEM_KINDS } from "@/types/content"

export const CURRENT_SERVICE_KEY = "rhema-studio.service"

export type OpenResult = "ok" | "unsaved" | "missing" | "error"
export type SaveResult = "saved" | "conflict" | "unsupported" | "failed" | "nothing"
export type CreateResult = "created" | "created_unsaved" | "unsaved" | "failed"
export type CloseResult = "closed" | "unsaved"
export type DeleteResult = "deleted" | "unsaved" | "conflict" | "failed"

interface Discard {
  /** Explicitly throw away unsaved changes. Never the default. */
  discard?: boolean
}

interface CreateFromRundownOptions extends Discard {
  /** Set only after replacing the rundown with rows validated by `toQueueItems`. */
  sourceValidated?: boolean
}

interface ServiceState {
  programs: Program[]
  /** The service whose items are loaded into the rundown, if any. */
  current: Program | null
  /** Rundown differs from what was last loaded from or saved to the database. */
  dirty: boolean
  loading: boolean
  saving: boolean
  /** Last error from the content database, for the UI to show. */
  error: string | null
  /** Set when a save was refused because the database has a newer revision. */
  conflict: { expected: number; actual: number } | null
  /** Item kinds written by a newer build that this build does not recognize. */
  unsupportedItems: ProgramItem[]
  /** Known item kinds whose saved payload is malformed. Saving and copying stay blocked to protect them. */
  corruptItems: ProgramItem[]
  /** Translation codes the open service names that are not installed here. */
  missingTranslations: string[]
  /** Immutable scene/look assets for the approved revision, if this build captured them. */
  approvedDesigns: ApprovedDesignSnapshot | null
  approvedDesignRevision: number | null
  /** Explains a legacy approval or why its manifest could not be loaded. */
  approvedDesignsError: string | null

  loadPrograms: () => Promise<boolean>
  /** Create an empty service and open it. Refuses while another service has unsaved changes. */
  createProgram: (title: string, serviceDate: string | null, opts?: Discard) => Promise<Program | null>
  /** Create a service from the rundown on screen and save it. */
  createFromRundown: (title: string, serviceDate: string | null, opts?: CreateFromRundownOptions) => Promise<CreateResult>
  /**
   * Copy the open service (its saved items, with fresh item ids) into a new
   * one and open that. The original is untouched. Refuses while unsaved.
   */
  duplicateCurrent: (title: string, serviceDate: string | null) => Promise<CreateResult>
  /** Load a service into the rundown. Refuses while there are unsaved changes unless `discard`. */
  openProgram: (id: string, opts?: Discard) => Promise<OpenResult>
  /** Save the rundown as the current service's items. */
  saveCurrent: (options?: { carryCommentHistory?: boolean }) => Promise<SaveResult>
  deleteProgram: (id: string, opts?: Discard) => Promise<DeleteResult>
  /** Detach the rundown from the saved service (keeps the rundown on screen). */
  closeProgram: (opts?: Discard) => CloseResult
  /** Saved snapshots of the open service, newest first. */
  listRevisions: () => Promise<RevisionSummary[]>
  /** Make a snapshot the current items (a normal save, so it is itself undoable). Refuses while unsaved. */
  restoreRevision: (revisionId: string) => Promise<OpenResult | "conflict">
  /** Rename or re-date the open service (its items are untouched; unsaved edits stay unsaved). */
  updateDetails: (title: string, serviceDate: string | null) => Promise<"ok" | "conflict" | "failed">
  /** Archive (hide from the picker, keep) or bring back a service. */
  setArchived: (id: string, archived: boolean) => Promise<boolean>
  /** Mark a service as a template for new services, or not. */
  setTemplate: (id: string, template: boolean) => Promise<boolean>
  /** A new service with a copy of a template's items (fresh ids; the template is untouched). */
  newFromTemplate: (templateId: string, title: string, serviceDate: string | null) => Promise<CreateResult>
  /** Approve the saved service as it is now ("this is Sunday's"). */
  approve: () => Promise<"ok" | "unsaved" | "conflict" | "error">
}

/** Translation abbreviations the operator is presenting with right now. */
export interface ActiveTranslations {
  primary: string | null
  secondary: string | null
}

/**
 * Pure: rundown items → what the database stores. Ids keep item identity.
 * Items loaded from a service keep their stored translation, secondary and
 * notes verbatim; only items that were never saved take the translation they
 * were added with, so changing the active translation later never rewrites a
 * saved service.
 */
/**
 * A slide's label: its title or first line (the database keeps at most 200
 * characters; the slide keeps all its words), plus its page mark ("(2/4)")
 * when it is one page of a longer text, so the order survives saving.
 */
export function slideLabel(slide: { title: string; body: string; link?: string }, reference = ""): string {
  const page = reference.match(/ \(\d+\/\d+\)$/)?.[0] ?? ""
  // A QR slide with only an address is named by where it goes ("church.example/give").
  const address = slide.link?.replace(/^https?:\/\//, "").replace(/\/$/, "")
  const name = slide.title.trim() || slide.body.split("\n")[0]?.trim() || address || "Slide"
  return name.endsWith(page) ? [...name].slice(0, 200).join("") : [...name].slice(0, 200 - page.length).join("") + page
}

export function toItemInputs(
  items: QueueItem[],
  translationOf: (id: number) => string | null = () => null,
  active: ActiveTranslations = { primary: null, secondary: null },
  headers: OutlineHeader[] = [],
): ItemInput[] {
  const inputs = itemInputs(items, translationOf, active)
  if (headers.length === 0) return inputs
  // Phases and groups go between the items, where they sit.
  return interleave(inputs, headers).map((r) => ("header" in r ? headerInput(r.header) : r.item))
}

/** A phase or group as its saved row: the name is the reference; how a phase runs is in the payload. */
function headerInput(h: OutlineHeader): ItemInput {
  const payload = {
    ...(h.payload_extra ?? {}),
    ...(h.type === "phase" ? { ...(h.rule ? { rule: h.rule } : {}), ...(h.role ? { role: h.role } : {}), ...(h.starts_at && isClockTime(h.starts_at) ? { starts_at: h.starts_at } : {}), ...(isAdvanceSeconds(h.advance_seconds) ? { advance_seconds: h.advance_seconds } : {}), ...(h.disabled ? { disabled: true } : {}) } : {}),
    ...(h.event ? { run_of_show_event: {
      ...(h.event.payload_extra ?? {}),
      schema_version: 1,
      ...(h.event.role ? { role: h.event.role } : {}),
      ...(h.event.duration_minutes !== undefined ? { duration_minutes: h.event.duration_minutes } : {}),
      ...(h.event.ownership ? { ownership: h.event.ownership } : {}),
      ...(h.event.cues !== undefined ? { cues: h.event.cues } : {}),
    } } : {}),
  }
  return {
    id: h.id,
    kind: h.type,
    reference: h.name.trim() || (h.type === "phase" ? "Phase" : h.event ? "Event" : "Group"),
    book_number: null,
    chapter: null,
    verse: null,
    translation: null,
    secondary_translation: null,
    notes: h.notes ?? null,
    ...(Object.keys(payload).length ? { payload: JSON.stringify(payload) } : {}),
  }
}

function itemInputs(
  items: QueueItem[],
  translationOf: (id: number) => string | null,
  active: ActiveTranslations,
): ItemInput[] {
  const bg = (i: QueueItem) => ({
    // Fields from a newer version or a service file that this build does not edit: kept as they were.
    ...(i.payload_extra ?? {}),
    ...(i.background ? { background_media_id: i.background.media_id } : {}),
    ...(typeof i.planned_minutes === "number" && i.planned_minutes > 0 ? { planned_minutes: i.planned_minutes } : {}),
    ...(i.end_by && isClockTime(i.end_by) ? { end_by: i.end_by } : {}),
    ...(i.starts_at && isClockTime(i.starts_at) ? { starts_at: i.starts_at } : {}),
    ...(isGapMinutes(i.gap_minutes) ? { gap_minutes: i.gap_minutes } : {}),
    // A milestone, a soft end, its own warning (#196 R1.2).
    ...itemTimingPayload(i.timing),
    // Its people (#299 6.10), and the same names as one "prepared by" line for older builds.
    ...(cleanAssignees(i.assignees).length ? { assignees: cleanAssignees(i.assignees), prepared_by: preparedByText(cleanAssignees(i.assignees)) } : cleanName(i.prepared_by) ? { prepared_by: cleanName(i.prepared_by) } : {}),
    ...(cleanComments(i.comments).length ? { comments: cleanComments(i.comments) } : {}),
    ...(cleanOnLive(i.on_live) ? { on_live: cleanOnLive(i.on_live) } : {}),
    // Its cue list (#193) and whether Present skips it.
    ...(cleanCues(i.cues).length ? { cues: cleanCues(i.cues) } : {}),
    ...(i.hidden ? { hidden: true } : {}),
    ...(i.auto_advance ? { auto_advance: true } : {}),
    // Its scene, look and camera, and the steps armed for its Take (#243 RS.3, RS.4).
    ...intentPayload(i),
    // Words an AI assistant wrote, until a person accepts them (#252).
    ...(cleanName(i.ai_suggestion) ? { ai_suggestion: cleanName(i.ai_suggestion) } : {}),
  })
  return items.map((i): ItemInput =>
    isAudioItem(i)
      ? {
          id: i.id,
          kind: "audio",
          reference: i.audio.name,
          book_number: null,
          chapter: null,
          verse: null,
          translation: null,
          secondary_translation: null,
          notes: i.notes ?? null,
          payload: JSON.stringify({
            media_id: i.audio.media_id,
            ...(i.audio.output_device_id ? { output_device_id: i.audio.output_device_id } : {}),
            ...(typeof i.audio.volume === "number" && i.audio.volume !== 1 ? { volume: i.audio.volume } : {}),
            ...(i.audio.loop ? { loop: true } : {}),
            ...(i.audio.fade_in_ms ? { fade_in_ms: i.audio.fade_in_ms } : {}),
            ...(i.audio.fade_out_ms ? { fade_out_ms: i.audio.fade_out_ms } : {}),
            ...bg(i),
          } satisfies AudioItemPayload & { background_media_id?: string }),
        }
      : isImageItem(i)
      ? {
          id: i.id,
          kind: "image",
          reference: i.image.name,
          book_number: null,
          chapter: null,
          verse: null,
          translation: null,
          secondary_translation: null,
          notes: i.notes ?? null,
          payload: JSON.stringify({ media_id: i.image.media_id, fit: i.image.fit, ...(i.image.loop ? { loop: true } : {}), ...(i.image.sound === false ? { sound: false } : {}), ...bg(i) } satisfies ImageItemPayload & { background_media_id?: string }),
        }
      : isSlideItem(i)
      ? {
          id: i.id,
          kind: "slide",
          reference: slideLabel(i.slide, i.reference),
          book_number: null,
          chapter: null,
          verse: null,
          translation: null,
          secondary_translation: null,
          notes: i.notes ?? null,
          payload: JSON.stringify({ title: i.slide.title, body: i.slide.body, ...(i.slide.link ? { link: i.slide.link } : {}), ...(i.slide.source_asset_id ? { source_asset_id: i.slide.source_asset_id } : {}), ...(i.slide.source_revision ? { source_revision: i.slide.source_revision } : {}), ...bg(i) } satisfies SlideItemPayload & { background_media_id?: string }),
        }
      : isVerseItem(i)
      ? {
          id: i.id,
          kind: "verse",
          reference: i.reference,
          book_number: i.verse.book_number,
          chapter: i.verse.chapter,
          verse: i.verse.verse,
          translation: i.translation === undefined ? translationOf(i.verse.translation_id) : i.translation,
          secondary_translation: i.secondary_translation === undefined ? active.secondary : i.secondary_translation,
          notes: i.notes ?? null,
          ...(Object.keys(bg(i)).length ? { payload: JSON.stringify(bg(i)) } : {}),
        }
      : isCueItem(i)
      ? {
          id: i.id,
          kind: "cue",
          reference: [...(i.reference.trim() || "Cue")].slice(0, 200).join(""),
          book_number: null,
          chapter: null,
          verse: null,
          translation: null,
          secondary_translation: null,
          notes: i.notes ?? null,
          ...(Object.keys(bg(i)).length ? { payload: JSON.stringify(bg(i)) } : {}),
        }
      : {
          id: i.id,
          kind: "song",
          reference: i.song.title,
          book_number: null,
          chapter: null,
          verse: null,
          translation: null,
          secondary_translation: null,
          notes: i.notes ?? null,
          payload: JSON.stringify({
            song_id: i.song.song_id,
            arrangement_id: i.song.arrangement_id,
            languages: i.song.languages,
            ...(i.song.title_slide ? { title_slide: true } : {}),
            ...bg(i),
          } satisfies SongItemPayload & { background_media_id?: string }),
        }
  )
}

/** 24-hour "HH:MM". */
export const isClockTime = (t: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)
const isAdvanceSeconds = (s: unknown): s is number => typeof s === "number" && Number.isInteger(s) && s >= 3 && s <= 3600

/**
 * A short name as the crate accepts it: control characters (a pasted tab)
 * become spaces, runs of space collapse, and it is cut at 60 whole
 * characters (never half an emoji).
 */
export function cleanName(raw: string | null | undefined): string {
  if (!raw) return ""
  // eslint-disable-next-line no-control-regex
  return Array.from(raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim()).slice(0, 60).join("").trim()
}

/** The payload keys this build reads and writes, per item kind; anything else is kept untouched (FR-03). */
const COMMON_PAYLOAD_KEYS = ["background_media_id", "planned_minutes", "end_by", "starts_at", "gap_minutes", "prepared_by", "assignees", "comments", "on_live", "cues", "hidden", "auto_advance", "scene_id", "look_id", "camera", "on_take", "timing", "ai_suggestion"]
const KNOWN_PAYLOAD_KEYS: Record<string, Set<string>> = {
  verse: new Set(COMMON_PAYLOAD_KEYS),
  image: new Set([...COMMON_PAYLOAD_KEYS, "media_id", "fit", "loop", "sound"]),
  audio: new Set([...COMMON_PAYLOAD_KEYS, "media_id", "fit", "sound", "output_device_id", "volume", "loop", "fade_in_ms", "fade_out_ms"]),
  slide: new Set([...COMMON_PAYLOAD_KEYS, "title", "body", "link", "source_asset_id", "source_revision"]),
  song: new Set([...COMMON_PAYLOAD_KEYS, "song_id", "hymn", "hymn_numbers", "arrangement_id", "languages", "title_slide"]),
  cue: new Set(COMMON_PAYLOAD_KEYS),
}

/** Payload keys this build does not know for that kind (from a newer version or a service file), to write back unchanged. */
export function parsePayloadExtra(raw: string | null | undefined, kind: string): Record<string, unknown> | undefined {
  const known = KNOWN_PAYLOAD_KEYS[kind] ?? new Set(COMMON_PAYLOAD_KEYS)
  if (!raw) return undefined
  try {
    const p = JSON.parse(raw) as unknown
    if (typeof p !== "object" || p === null || Array.isArray(p)) return undefined
    const extra = Object.fromEntries(Object.entries(p).filter(([k]) => !known.has(k)))
    return Object.keys(extra).length ? extra : undefined
  } catch {
    return undefined
  }
}

/** Read local media kinds so legacy image rows that reference audio can be decoded safely. */
export async function loadMediaKinds(data?: ProgramWithItems): Promise<ReadonlyMap<string, MediaAsset["kind"]>> {
  if (data && !data.items.some((item) => item.kind === "image")) return new Map()
  let media = useMediaStore.getState()
  if (!media.loaded || media.error) {
    await media.list()
    media = useMediaStore.getState()
  }
  if (media.error) throw new Error(`Could not check the local media library needed to open this service: ${media.error}`)
  return new Map(media.assets.map((asset) => [asset.id, asset.kind]))
}

/** A go-live message and cue worth saving: one clean line, a known cue; null when neither. */
export function cleanOnLive(on: OnLive | null | undefined): OnLive | null {
  if (!on) return null
  // eslint-disable-next-line no-control-regex
  const message = Array.from((on.stage_message ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim()).slice(0, 120).join("").trim()
  const cue = on.cue && (GO_LIVE_CUES as readonly string[]).includes(on.cue) ? on.cue : undefined
  return message || cue ? { ...(message ? { stage_message: message } : {}), ...(cue ? { cue } : {}) } : null
}

/** `auto_advance` from any item's payload: true or nothing. */
export function parseAutoAdvance(raw: string | null | undefined): true | null {
  if (!raw) return null
  try {
    return (JSON.parse(raw) as { auto_advance?: unknown }).auto_advance === true ? true : null
  } catch {
    return null
  }
}

/** `on_live` from any item's payload. */
export function parseOnLive(raw: string | null | undefined): OnLive | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as { on_live?: unknown }
    return p.on_live && typeof p.on_live === "object" ? cleanOnLive(p.on_live as OnLive) : null
  } catch {
    return null
  }
}

/** An item's cue list and whether Present skips it (#193), from any item's payload; only those set. */
export function parseCuesAndHidden(raw: string | null | undefined): { cues?: ItemCue[]; hidden?: true } {
  if (!raw) return {}
  try {
    const p = JSON.parse(raw) as { cues?: unknown; hidden?: unknown }
    const cues = Array.isArray(p.cues) ? cleanCues(p.cues as ItemCue[]) : []
    return { ...(cues.length ? { cues } : {}), ...(p.hidden === true ? { hidden: true } : {}) }
  } catch {
    return {}
  }
}

/** `ai_suggestion` from any item's payload (#252): the assistant whose words are not accepted yet. */
export function parseAiSuggestion(raw: string | null | undefined): { ai_suggestion?: string } {
  if (!raw) return {}
  try {
    const p = JSON.parse(raw) as { ai_suggestion?: unknown }
    const by = typeof p.ai_suggestion === "string" ? cleanName(p.ai_suggestion) : ""
    return by ? { ai_suggestion: by } : {}
  } catch {
    return {}
  }
}

/** `prepared_by` from any item's payload (CL-007). */
export function parsePreparedBy(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as { prepared_by?: unknown }
    return typeof p.prepared_by === "string" ? cleanName(p.prepared_by) || null : null
  } catch {
    return null
  }
}

/** An item's "prepared by" line and its people (#299 6.10), when the list still matches the line. */
export function parsePeople(raw: string | null | undefined): { prepared_by: string | null; assignees?: string[] } {
  const prepared_by = parsePreparedBy(raw)
  const assignees = parseAssignees(raw, prepared_by)
  return { prepared_by, ...(assignees ? { assignees } : {}) }
}

/** `end_by` from any item's payload. */
export function parseEndBy(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as { end_by?: unknown }
    return typeof p.end_by === "string" && isClockTime(p.end_by) ? p.end_by : null
  } catch {
    return null
  }
}

const isGapMinutes = (m: unknown): m is number => typeof m === "number" && m > 0 && m <= 600

/** `starts_at` (a fixed start) and `gap_minutes` (a pause before) from any item's payload; only those set. */
export function parseFixedStartAndGap(raw: string | null | undefined): { starts_at?: string; gap_minutes?: number } {
  if (!raw) return {}
  try {
    const p = JSON.parse(raw) as { starts_at?: unknown; gap_minutes?: unknown }
    return { ...(typeof p.starts_at === "string" && isClockTime(p.starts_at) ? { starts_at: p.starts_at } : {}), ...(isGapMinutes(p.gap_minutes) ? { gap_minutes: p.gap_minutes } : {}) }
  } catch {
    return {}
  }
}

/** `planned_minutes` from any item's payload. */
export function parsePlannedMinutes(raw: string | null | undefined): number | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as { planned_minutes?: unknown }
    return typeof p.planned_minutes === "number" && p.planned_minutes > 0 ? p.planned_minutes : null
  } catch {
    return null
  }
}

/** `background_media_id` from any item's payload; the name is filled in from the library later. */
export function parseBackground(raw: string | null | undefined): { media_id: string; name: string } | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as { background_media_id?: unknown }
    return typeof p.background_media_id === "string" && p.background_media_id ? { media_id: p.background_media_id, name: "" } : null
  } catch {
    return null
  }
}

/** The picture payload of a stored item, or null when it is not well-formed. */
export function parseImagePayload(raw: string | null | undefined): { media_id: string; fit: "cover" | "contain" | "stretch"; loop?: boolean; sound?: boolean } | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<ImageItemPayload>
    if (typeof p.media_id !== "string" || !p.media_id) return null
    const fit = p.fit === "contain" || p.fit === "stretch" ? p.fit : "cover"
    return { media_id: p.media_id, fit, ...(p.loop === true ? { loop: true } : {}), ...(p.sound === false ? { sound: false } : {}) }
  } catch {
    return null
  }
}

/** The local audio cue payload, or null when its media id or settings are invalid. */
export function parseAudioPayload(raw: string | null | undefined): AudioItemPayload | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<AudioItemPayload>
    if (typeof p.media_id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(p.media_id)) return null
    if (p.output_device_id !== undefined) {
      if (typeof p.output_device_id !== "string") return null
      const deviceChars = Array.from(p.output_device_id)
      if (deviceChars.length > 1024 || deviceChars.some((char) => {
        const code = char.codePointAt(0) ?? 0
        return code < 0x20 || code === 0x7f
      })) return null
    }
    if (p.volume !== undefined && (typeof p.volume !== "number" || !Number.isFinite(p.volume) || p.volume < 0 || p.volume > 1)) return null
    if (p.loop !== undefined && typeof p.loop !== "boolean") return null
    const validFade = (ms: unknown): ms is number => typeof ms === "number" && Number.isInteger(ms) && ms >= 0 && ms <= 30_000
    if (p.fade_in_ms !== undefined && !validFade(p.fade_in_ms)) return null
    if (p.fade_out_ms !== undefined && !validFade(p.fade_out_ms)) return null
    return {
      media_id: p.media_id,
      ...(p.output_device_id ? { output_device_id: p.output_device_id } : {}),
      ...(p.volume !== undefined ? { volume: p.volume } : {}),
      ...(p.loop ? { loop: true } : {}),
      ...(p.fade_in_ms !== undefined && p.fade_in_ms > 0 ? { fade_in_ms: p.fade_in_ms } : {}),
      ...(p.fade_out_ms !== undefined && p.fade_out_ms > 0 ? { fade_out_ms: p.fade_out_ms } : {}),
    }
  } catch {
    return null
  }
}

/** The custom-slide payload of a stored item, or null when it is not well-formed. */
export function parseSlidePayload(raw: string | null | undefined): SlideItemPayload | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<SlideItemPayload>
    const title = typeof p.title === "string" ? p.title : ""
    const body = typeof p.body === "string" ? p.body : ""
    const link = typeof p.link === "string" ? safeLink(p.link) : null
    const sourceId = typeof p.source_asset_id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(p.source_asset_id) ? p.source_asset_id : undefined
    const sourceRevision = Number.isSafeInteger(p.source_revision) && Number(p.source_revision) > 0 ? Number(p.source_revision) : undefined
    return title.trim() || body.trim() || link ? { title, body, ...(link ? { link } : {}), ...(sourceId && sourceRevision ? { source_asset_id: sourceId, source_revision: sourceRevision } : {}) } : null
  } catch {
    return null
  }
}

/** The song payload of a stored item, or null when it is not well-formed. */
export function parseSongPayload(raw: string | null | undefined): SongItemPayload | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<SongItemPayload>
    if (typeof p.song_id !== "string" || !p.song_id) return null
    return {
      song_id: p.song_id,
      arrangement_id: typeof p.arrangement_id === "string" ? p.arrangement_id : null,
      languages: Array.isArray(p.languages) ? p.languages.filter((l): l is string => typeof l === "string") : [],
      ...(p.title_slide === true ? { title_slide: true } : {}),
    }
  } catch {
    return null
  }
}

function isStoredVerse(it: ProgramItem): boolean {
  return (
    it.kind === "verse" &&
    typeof it.book_number === "number" && it.book_number > 0 &&
    typeof it.chapter === "number" && it.chapter > 0 &&
    typeof it.verse === "number" && it.verse > 0
  )
}

/** Null is a valid absent payload; a present payload must be a JSON object we can preserve. */
function hasReadablePayload(raw: string | null | undefined): boolean {
  if (raw == null) return true
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
  } catch {
    return false
  }
}

function savedItemBlockMessage(
  subject: string,
  action: "saving" | "copying" | "approving",
  unsupported: number,
  corrupt: number,
): string {
  const problems = [
    unsupported > 0 ? `${unsupported} item${unsupported === 1 ? "" : "s"} from a newer version that this version cannot edit` : null,
    corrupt > 0 ? `${corrupt} saved item${corrupt === 1 ? "" : "s"} this version could not read` : null,
  ].filter((problem): problem is string => problem !== null)
  const reason = problems.join(" and ")
  if (action === "saving") return `${subject} has ${reason}; saving would remove them. Update Rhema Studio for newer item kinds or restore a backup for unreadable saved data.`
  if (action === "copying") return `${subject} has ${reason}; this version cannot copy them without omitting saved data. Update Rhema Studio for newer item kinds or restore a backup for unreadable saved data.`
  return `${subject} has ${reason}. It cannot be approved until all saved items can be read; update Rhema Studio or restore a backup.`
}

const findTranslation = (translations: Translation[], abbrev: string | null): Translation | undefined =>
  abbrev === null ? undefined : translations.find((t) => t.abbreviation.toLowerCase() === abbrev.toLowerCase())

/**
 * Pure: stored items → rundown items. Only well-formed items of a supported
 * kind become rundown entries; everything else is returned separately and is
 * never silently turned into a verse. Translation, secondary and notes are
 * carried onto the rundown item verbatim. A pinned translation that is not
 * installed falls back to the active one for text lookup only and is listed
 * in `missingTranslations`; the item still remembers it for the next save.
 */
export function toQueueItems(
  data: ProgramWithItems,
  translationId: number,
  translations: Translation[] = [],
  mediaKinds: ReadonlyMap<string, MediaAsset["kind"]> = new Map(),
): { items: QueueItem[]; headers: OutlineHeader[]; unsupported: ProgramItem[]; corrupt: ProgramItem[]; missingTranslations: string[] } {
  const items: QueueItem[] = []
  const headers: OutlineHeader[] = []
  const unsupported: ProgramItem[] = []
  const corrupt: ProgramItem[] = []
  const missing = new Set<string>()
  for (const it of data.items) {
    if (it.kind === "phase" || it.kind === "group") {
      if (!hasReadablePayload(it.payload)) corrupt.push(it)
      headers.push(parseHeader(it, items.length))
      continue
    }
    if (it.kind === "image") {
      const image = parseImagePayload(it.payload)
      if (!image) {
        corrupt.push(it)
        continue
      }
      if (mediaKinds.get(image.media_id) === "audio") {
        const audio = parseAudioPayload(it.payload)
        if (!audio) {
          unsupported.push(it)
          continue
        }
        items.push({
          id: it.id,
          kind: "audio",
          audio: { media_id: audio.media_id, name: it.reference, ...(audio.output_device_id ? { output_device_id: audio.output_device_id } : {}), ...(audio.volume !== undefined ? { volume: audio.volume } : {}), ...(audio.loop ? { loop: true } : {}), ...(audio.fade_in_ms ? { fade_in_ms: audio.fade_in_ms } : {}), ...(audio.fade_out_ms ? { fade_out_ms: audio.fade_out_ms } : {}) },
          reference: it.reference,
          confidence: 1,
          source: "manual",
          added_at: Date.now(),
          notes: it.notes,
          planned_minutes: parsePlannedMinutes(it.payload),
          end_by: parseEndBy(it.payload),
          ...parseFixedStartAndGap(it.payload),
          ...parseItemTiming(it.payload),
          ...parsePeople(it.payload),
          comments: parseComments(it.payload),
          on_live: parseOnLive(it.payload),
          ...parseCuesAndHidden(it.payload),
          auto_advance: parseAutoAdvance(it.payload),
          ...parseItemIntent(it.payload),
          ...parseAiSuggestion(it.payload),
          payload_extra: parsePayloadExtra(it.payload, "audio"),
        })
        continue
      }
      items.push({ id: it.id, kind: "image", image: { media_id: image.media_id, name: it.reference, fit: image.fit, ...(image.loop ? { loop: true } : {}), ...(image.sound === false ? { sound: false } : {}) }, reference: it.reference, confidence: 1, source: "manual", added_at: Date.now(), notes: it.notes, background: parseBackground(it.payload), planned_minutes: parsePlannedMinutes(it.payload), end_by: parseEndBy(it.payload), ...parseFixedStartAndGap(it.payload), ...parseItemTiming(it.payload), ...parsePeople(it.payload), comments: parseComments(it.payload), on_live: parseOnLive(it.payload), ...parseCuesAndHidden(it.payload), auto_advance: parseAutoAdvance(it.payload), ...parseItemIntent(it.payload), ...parseAiSuggestion(it.payload), payload_extra: parsePayloadExtra(it.payload, it.kind) })
      continue
    }
    if (it.kind === "audio") {
      const audio = parseAudioPayload(it.payload)
      if (!audio) {
        unsupported.push(it)
        continue
      }
      items.push({
        id: it.id,
        kind: "audio",
        audio: { media_id: audio.media_id, name: it.reference, ...(audio.output_device_id ? { output_device_id: audio.output_device_id } : {}), ...(audio.volume !== undefined ? { volume: audio.volume } : {}), ...(audio.loop ? { loop: true } : {}), ...(audio.fade_in_ms ? { fade_in_ms: audio.fade_in_ms } : {}), ...(audio.fade_out_ms ? { fade_out_ms: audio.fade_out_ms } : {}) },
        reference: it.reference,
        confidence: 1,
        source: "manual",
        added_at: Date.now(),
        notes: it.notes,
        planned_minutes: parsePlannedMinutes(it.payload),
        end_by: parseEndBy(it.payload),
        ...parseFixedStartAndGap(it.payload),
        ...parseItemTiming(it.payload),
        ...parsePeople(it.payload),
        comments: parseComments(it.payload),
        on_live: parseOnLive(it.payload),
        ...parseCuesAndHidden(it.payload),
        auto_advance: parseAutoAdvance(it.payload),
        ...parseItemIntent(it.payload),
        ...parseAiSuggestion(it.payload),
        payload_extra: parsePayloadExtra(it.payload, it.kind),
      })
      continue
    }
    if (it.kind === "slide") {
      const slide = parseSlidePayload(it.payload)
      if (!slide) {
        corrupt.push(it)
        continue
      }
      items.push({ id: it.id, kind: "slide", slide, reference: it.reference, confidence: 1, source: "manual", added_at: Date.now(), notes: it.notes, background: parseBackground(it.payload), planned_minutes: parsePlannedMinutes(it.payload), end_by: parseEndBy(it.payload), ...parseFixedStartAndGap(it.payload), ...parseItemTiming(it.payload), ...parsePeople(it.payload), comments: parseComments(it.payload), on_live: parseOnLive(it.payload), ...parseCuesAndHidden(it.payload), auto_advance: parseAutoAdvance(it.payload), ...parseItemIntent(it.payload), ...parseAiSuggestion(it.payload), payload_extra: parsePayloadExtra(it.payload, it.kind) })
      continue
    }
    if (it.kind === "cue") {
      if (!hasReadablePayload(it.payload)) {
        corrupt.push(it)
        continue
      }
      items.push({ id: it.id, kind: "cue", reference: it.reference, confidence: 1, source: "manual", added_at: Date.now(), notes: it.notes, background: parseBackground(it.payload), planned_minutes: parsePlannedMinutes(it.payload), end_by: parseEndBy(it.payload), ...parseFixedStartAndGap(it.payload), ...parseItemTiming(it.payload), ...parsePeople(it.payload), comments: parseComments(it.payload), on_live: parseOnLive(it.payload), ...parseCuesAndHidden(it.payload), auto_advance: parseAutoAdvance(it.payload), ...parseItemIntent(it.payload), ...parseAiSuggestion(it.payload), payload_extra: parsePayloadExtra(it.payload, it.kind) })
      continue
    }
    if (it.kind === "song") {
      const payload = parseSongPayload(it.payload)
      if (!payload) {
        corrupt.push(it)
        continue
      }
      items.push({
        id: it.id,
        kind: "song",
        song: { song_id: payload.song_id, title: it.reference, arrangement_id: payload.arrangement_id ?? null, languages: payload.languages ?? [], ...(payload.title_slide ? { title_slide: true } : {}) },
        reference: it.reference,
        confidence: 1,
        source: "manual",
        added_at: Date.now(),
        notes: it.notes,
        background: parseBackground(it.payload), planned_minutes: parsePlannedMinutes(it.payload), end_by: parseEndBy(it.payload), ...parseFixedStartAndGap(it.payload), ...parseItemTiming(it.payload), ...parsePeople(it.payload), comments: parseComments(it.payload), on_live: parseOnLive(it.payload), ...parseCuesAndHidden(it.payload), auto_advance: parseAutoAdvance(it.payload), ...parseItemIntent(it.payload), ...parseAiSuggestion(it.payload), payload_extra: parsePayloadExtra(it.payload, it.kind),
      })
      continue
    }
    if (!(SUPPORTED_ITEM_KINDS as readonly string[]).includes(it.kind)) {
      unsupported.push(it)
      continue
    }
    if (!isStoredVerse(it) || !hasReadablePayload(it.payload)) {
      corrupt.push(it)
      continue
    }
    const pinned = findTranslation(translations, it.translation)
    if (it.translation !== null && !pinned) missing.add(it.translation)
    if (it.secondary_translation !== null && !findTranslation(translations, it.secondary_translation)) missing.add(it.secondary_translation)
    items.push({
      id: it.id,
      kind: "verse",
      verse: {
        id: 0,
        translation_id: pinned?.id ?? translationId,
        book_number: it.book_number!,
        book_name: it.reference.replace(/\s+\d+:\d+$/, ""),
        book_abbreviation: "",
        chapter: it.chapter!,
        verse: it.verse!,
        text: "",
      },
      reference: it.reference,
      confidence: 1,
      source: "manual",
      added_at: Date.now(),
      translation: it.translation,
      secondary_translation: it.secondary_translation,
      notes: it.notes,
      background: parseBackground(it.payload), planned_minutes: parsePlannedMinutes(it.payload), end_by: parseEndBy(it.payload), ...parseFixedStartAndGap(it.payload), ...parseItemTiming(it.payload), ...parsePeople(it.payload), comments: parseComments(it.payload), on_live: parseOnLive(it.payload), ...parseCuesAndHidden(it.payload), auto_advance: parseAutoAdvance(it.payload), ...parseItemIntent(it.payload), ...parseAiSuggestion(it.payload), payload_extra: parsePayloadExtra(it.payload, it.kind),
    })
  }
  return { items, headers, unsupported, corrupt, missingTranslations: [...missing] }
}

const RULES: readonly PhaseRule[] = ["loop", "auto_once", "manual"]
const ROLES: readonly PhaseRole[] = ["pre", "warmup", "main", "post", "custom"]

/** A saved phase or group row, before the item at `at`; keys this build does not edit are kept. */
function parseHeader(it: ProgramItem, at: number): OutlineHeader {
  let p: Record<string, unknown> = {}
  try {
    const v: unknown = it.payload ? JSON.parse(it.payload) : {}
    if (v && typeof v === "object" && !Array.isArray(v)) p = v as Record<string, unknown>
  } catch {
    // An unreadable payload: the header keeps its name and place.
  }
  const event = it.kind === "group" ? parseRunOfShowEvent(p.run_of_show_event) : null
  const { run_of_show_event, rule, role, starts_at, advance_seconds, ...others } = p
  // A phase skipped for this service (#193); on a group the key is not this build's and is kept.
  const { disabled, ...phaseRest } = others
  const hasField = (key: string) => Object.prototype.hasOwnProperty.call(p, key)
  const unparsedFields = it.kind === "phase"
    ? {
      ...(hasField("rule") && !RULES.includes(rule as PhaseRule) ? { rule } : {}),
      ...(hasField("role") && !ROLES.includes(role as PhaseRole) ? { role } : {}),
      ...(hasField("starts_at") && !(typeof starts_at === "string" && isClockTime(starts_at)) ? { starts_at } : {}),
      ...(hasField("advance_seconds") && !isAdvanceSeconds(advance_seconds) ? { advance_seconds } : {}),
      ...(hasField("disabled") && disabled !== true ? { disabled } : {}),
    }
    : Object.fromEntries(["rule", "role", "starts_at", "advance_seconds"]
      .filter(hasField)
      .map((key) => [key, p[key]]))
  const rest = {
    ...(it.kind === "phase" ? phaseRest : others),
    ...unparsedFields,
    ...(!event && run_of_show_event !== undefined ? { run_of_show_event } : {}),
  }
  return {
    id: it.id,
    type: it.kind === "phase" ? "phase" : "group",
    name: it.reference,
    at,
    notes: it.notes,
    ...(it.kind === "phase" && RULES.includes(rule as PhaseRule) ? { rule: rule as PhaseRule } : {}),
    ...(it.kind === "phase" && ROLES.includes(role as PhaseRole) ? { role: role as PhaseRole } : {}),
    ...(it.kind === "phase" && typeof starts_at === "string" && isClockTime(starts_at) ? { starts_at } : {}),
    ...(it.kind === "phase" && isAdvanceSeconds(advance_seconds) ? { advance_seconds } : {}),
    ...(it.kind === "phase" && disabled === true ? { disabled: true } : {}),
    ...(Object.keys(rest).length ? { payload_extra: rest } : {}),
    ...(event ? { event } : {}),
  }
}

/**
 * What a save persists (exactly the items a save writes), so every saved
 * field counts as a change; verse text and timestamps are not part of it.
 */
export function rundownSignature(items: QueueItem[], headers: OutlineHeader[] = []): string {
  return JSON.stringify(toItemInputs(items, undefined, undefined, headers))
}

function remember(id: string | null) {
  try {
    if (id) localStorage.setItem(CURRENT_SERVICE_KEY, id)
    else localStorage.removeItem(CURRENT_SERVICE_KEY)
  } catch {
    // convenience only
  }
}

export function rememberedServiceId(): string | null {
  try {
    return localStorage.getItem(CURRENT_SERVICE_KEY)
  } catch {
    return null
  }
}

function describe(e: unknown): string {
  if (isContentCommandError(e)) return e.message
  return e instanceof Error ? e.message : String(e)
}

// Baseline the dirty flag compares against: the rundown as last loaded/saved.
let baseline = ""
/** With no service open: the operator's items as they were when the last service closed (or none). */
let closedBaseline = "[]"
const operatorItems = (items: QueueItem[]) => items.filter((i) => i.source === "manual")

/**
 * A rundown the operator built or changed with no service open: unsaved
 * work for the close question. Items kept from a service just closed are
 * not; heard verses collected by themselves never are.
 */
export function unsavedScratch(items: QueueItem[], current: Program | null): boolean {
  if (current) return false
  const mine = operatorItems(items)
  return mine.length > 0 && rundownSignature(mine) !== closedBaseline // an empty rundown is nothing to lose
}
// Monotonic save ticket so a slow, older save cannot overwrite a newer one.
let saveGeneration = 0
let approvalGeneration = 0
let openGeneration = 0

const translationAbbrev = (id: number): string | null =>
  useBibleStore.getState().translations.find((t) => t.id === id)?.abbreviation ?? null

const activeTranslations = (): ActiveTranslations => {
  const b = useBibleStore.getState()
  return {
    primary: translationAbbrev(b.activeTranslationId),
    secondary: b.secondaryTranslationId === null ? null : translationAbbrev(b.secondaryTranslationId),
  }
}

/**
 * Give the rundown's items new ids and move every reference to them: what is
 * on air, held under a quick screen, selected in the preview, highlighted,
 * the removed item's neighbours and the service log. A go-live waiting for
 * approval, or still loading, belongs to the old service and is dropped.
 */
async function idHolders() {
  // Imported when needed: these modules import this one.
  const [{ remapJournalItemIds }, { useApprovalGateStore }, { cancelPendingPresents }] = await Promise.all([
    import("@/stores/journal-store"),
    import("@/stores/approval-gate-store"),
    import("@/hooks/use-broadcast"),
  ])
  return { remapJournalItemIds, useApprovalGateStore, cancelPendingPresents }
}

/** Synchronous (after `idHolders`), so no save or edit can see half the ids renewed. */
function renewItemIds(h: Awaited<ReturnType<typeof idHolders>>): void {
  const ids = new Map(useQueueStore.getState().items.map((i) => [i.id, crypto.randomUUID()]))
  const re = (id: string | null | undefined): string | null => (id ? (ids.get(id) ?? id) : null)
  const reSlide = <T extends { itemId: string }>(s: T | null): T | null => (s ? { ...s, itemId: re(s.itemId) ?? s.itemId } : null)
  useQueueStore.setState((q) => ({
    items: q.items.map((i) => ({ ...i, id: ids.get(i.id) ?? i.id })),
    // Phases and groups are rows too: a copy gets its own.
    headers: q.headers.map((h) => ({ ...h, id: crypto.randomUUID() })),
    highlightedId: re(q.highlightedId),
    removedActive: q.removedActive ? { prevId: re(q.removedActive.prevId), nextId: re(q.removedActive.nextId) } : null,
    // The states before hold the old ids: undoing into them would bring back another service's items.
    past: [],
    future: [],
  }))
  const b = useBroadcastStore.getState()
  useBroadcastStore.setState({
    liveItemId: re(b.liveItemId),
    liveSlide: reSlide(b.liveSlide),
    heldLive: b.heldLive ? { ...b.heldLive, liveItemId: re(b.heldLive.liveItemId), liveSlide: reSlide(b.heldLive.liveSlide) } : null,
  })
  const sel = useBibleStore.getState().selectedSlide
  if (sel) useBibleStore.setState({ selectedSlide: { ...sel, item: { ...sel.item, id: ids.get(sel.item.id) ?? sel.item.id } } })
  h.remapJournalItemIds(re)
  h.useApprovalGateStore.setState({ held: null, retry: null })
  h.cancelPendingPresents()
}

export const useServiceStore = create<ServiceState>((set, get) => ({
  programs: [],
  current: null,
  dirty: false,
  loading: false,
  saving: false,
  error: null,
  conflict: null,
  unsupportedItems: [],
  corruptItems: [],
  missingTranslations: [],
  approvedDesigns: null,
  approvedDesignRevision: null,
  approvedDesignsError: null,

  loadPrograms: async () => {
    set({ loading: true })
    try {
      const programs = await invoke<Program[]>("content_list_programs")
      set({ programs, error: null })
      return true
    } catch (e) {
      set({ error: describe(e) })
      return false
    } finally {
      set({ loading: false })
    }
  },

  createProgram: async (title, serviceDate, opts) => {
    if (get().dirty && !opts?.discard) return null
    try {
      const program = await invoke<Program>("content_create_program", { title, serviceDate })
      set((s) => ({ programs: [program, ...s.programs], error: null }))
      return program
    } catch (e) {
      set({ error: describe(e) })
      return null
    }
  },

  createFromRundown: async (title, serviceDate, opts) => {
    if (get().current && get().dirty && !opts?.discard) return "unsaved"
    const { current, unsupportedItems, corruptItems } = get()
    if (current && !opts?.sourceValidated && (unsupportedItems.length > 0 || corruptItems.length > 0)) {
      set({ error: savedItemBlockMessage("This service", "copying", unsupportedItems.length, corruptItems.length) })
      return "failed"
    }
    const rundown = useQueueStore.getState()
    const hasPlan = rundown.items.length > 0 || rundown.headers.length > 0
    const holders = await idHolders()
    const program = await get().createProgram(title, serviceDate, { discard: true })
    if (!program) return "failed"
    baseline = "" // the rundown is not yet what the database has
    set({ current: program, dirty: hasPlan, conflict: null, unsupportedItems: [], corruptItems: [], missingTranslations: [], approvedDesigns: null, approvedDesignRevision: null, approvedDesignsError: null })
    // Item ids are unique across services: items taken from another service (or copied) get new ones, or the save is refused.
    // In the same tick as the new service becoming current, so the original never looks changed.
    renewItemIds(holders)
    remember(program.id)
    if (!get().dirty) return "created"
    const saved = await get().saveCurrent({ carryCommentHistory: true })
    return saved === "saved" ? "created" : "created_unsaved"
  },

  listRevisions: async () => {
    const current = get().current
    if (!current) return []
    try {
      return await invoke<RevisionSummary[]>("content_list_revisions", { programId: current.id })
    } catch (e) {
      set({ error: describe(e) })
      return []
    }
  },

  approve: async () => {
    const current = get().current
    if (!current) return "error"
    if (get().dirty) return "unsaved"
    const { unsupportedItems, corruptItems } = get()
    if (unsupportedItems.length > 0 || corruptItems.length > 0) {
      set({ error: savedItemBlockMessage("This service", "approving", unsupportedItems.length, corruptItems.length) })
      return "error"
    }
    const ticket = ++approvalGeneration
    try {
      const media = await useMediaStore.getState().list()
      if (useMediaStore.getState().error) {
        set({ error: `Could not check local media before approval: ${useMediaStore.getState().error}` })
        return "error"
      }
      if (get().current?.id !== current.id || get().current?.revision !== current.revision) return "conflict"
      if (get().dirty) return "unsaved"
      const broadcast = useBroadcastStore.getState()
      const blockers = approvedDesignBlockers(useQueueStore.getState().items, broadcast.scenes, broadcast.themes, broadcast.outputs, media)
      if (blockers.length) {
        set({ error: blockers.join(" ") })
        return "error"
      }
      const designs = captureApprovedDesigns(
        useQueueStore.getState().items,
        broadcast.scenes,
        broadcast.themes,
        broadcast.outputs,
        useSettingsStore.getState().brandKit.logoUrl,
        media,
      )
      const program = await invoke<Program>("content_approve_program_with_designs", { id: current.id, expectedRevision: current.revision, designs })
      if (ticket !== approvalGeneration || get().current?.id !== current.id || get().current?.revision !== current.revision) return "ok"
      set((s) => ({ current: program, programs: s.programs.map((p) => (p.id === program.id ? program : p)), approvedDesigns: designs, approvedDesignRevision: program.approved_revision ?? null, approvedDesignsError: null, error: null }))
      return "ok"
    } catch (e) {
      if (isContentCommandError(e) && e.kind === "conflict") {
        set({ conflict: { expected: e.expected ?? current.revision, actual: e.actual ?? -1 }, error: e.message })
        return "conflict"
      }
      set({ error: describe(e) })
      return "error"
    }
  },

  restoreRevision: async (revisionId) => {
    const current = get().current
    if (!current) return "error"
    if (get().dirty) return "unsaved"
    try {
      await invoke<ProgramWithItems>("content_restore_revision", { programId: current.id, expectedRevision: current.revision, revisionId })
    } catch (e) {
      if (isContentCommandError(e) && e.kind === "conflict") {
        set({ conflict: { expected: e.expected ?? current.revision, actual: e.actual ?? -1 }, error: e.message })
        return "conflict"
      }
      set({ error: describe(e) })
      return "error"
    }
    return get().openProgram(current.id, { discard: true })
  },

  updateDetails: async (title, serviceDate) => {
    const current = get().current
    if (!current) return "failed"
    try {
      const program = await invoke<Program>("content_update_program", { id: current.id, expectedRevision: current.revision, title, serviceDate })
      // Only this service's record changed; a newer save or open owns the state if it moved on meanwhile.
      if (get().current?.id === program.id) set({ current: program, error: null })
      void get().loadPrograms()
      return "ok"
    } catch (e) {
      set({ error: describe(e) })
      return isContentCommandError(e) && e.kind === "conflict" ? "conflict" : "failed"
    }
  },

  setArchived: async (id, archived) => {
    try {
      const program = await invoke<Program>("content_set_program_archived", { id, archived })
      if (get().current?.id === id) set({ current: { ...get().current!, archived_at: program.archived_at } })
      await get().loadPrograms()
      return true
    } catch (e) {
      set({ error: describe(e) })
      return false
    }
  },

  setTemplate: async (id, template) => {
    try {
      const program = await invoke<Program>("content_set_program_template", { id, template })
      if (get().current?.id === id) set({ current: { ...get().current!, is_template: program.is_template } })
      await get().loadPrograms()
      return true
    } catch (e) {
      set({ error: describe(e) })
      return false
    }
  },

  newFromTemplate: async (templateId, title, serviceDate) => {
    if (get().dirty) return "unsaved"
    // The template is read, never opened: nothing on this path can save into it.
    let data: ProgramWithItems | null = null
    try {
      data = await invoke<ProgramWithItems | null>("content_get_program", { id: templateId })
    } catch (e) {
      set({ error: describe(e) })
      return "failed"
    }
    if (!data) {
      set({ error: "That template no longer exists" })
      return "failed"
    }
    const bible = useBibleStore.getState()
    let mediaKinds: ReadonlyMap<string, MediaAsset["kind"]>
    try {
      mediaKinds = await loadMediaKinds(data)
    } catch (e) {
      set({ error: describe(e) })
      return "failed"
    }
    const { items, headers, unsupported, corrupt } = toQueueItems(data, bible.activeTranslationId, bible.translations, mediaKinds)
    if (unsupported.length > 0 || corrupt.length > 0) {
      set({ error: savedItemBlockMessage("The template", "copying", unsupported.length, corrupt.length) })
      return "failed"
    }
    const before = useQueueStore.getState().items
    const headersBefore = useQueueStore.getState().headers
    useQueueStore.setState({ items: items.map((i) => ({ ...i, id: crypto.randomUUID() })), headers: headers.map((h) => ({ ...h, id: crypto.randomUUID() })), activeIndex: null })
    const r = await get().createFromRundown(title, serviceDate, { discard: true, sourceValidated: true })
    if (r === "failed") {
      useQueueStore.setState({ items: before, headers: headersBefore, activeIndex: null }) // nothing was created: the screen goes back as it was
      return r
    }
    // Reload the new service so verse text is filled in for Preview.
    const created = get().current
    if (created && r === "created") await get().openProgram(created.id, { discard: true })
    return r
  },

  duplicateCurrent: async (title, serviceDate) => {
    if (!get().current) return "failed"
    if (get().dirty) return "unsaved"
    // Items this version cannot show would be dropped from the copy without a word: refuse, as a template does.
    const { unsupportedItems, corruptItems } = get()
    if (unsupportedItems.length > 0 || corruptItems.length > 0) {
      set({ error: savedItemBlockMessage("This service", "copying", unsupportedItems.length, corruptItems.length) })
      return "failed"
    }
    // The copy gets fresh item ids (createFromRundown), never sharing identity with the original.
    return get().createFromRundown(title, serviceDate, { discard: true })
  },

  openProgram: async (id, opts) => {
    if (get().dirty && !opts?.discard) return "unsaved"
    const ticket = ++openGeneration
    set({ loading: true })
    try {
      const data = await invoke<ProgramWithItems | null>("content_get_program", { id })
      if (ticket !== openGeneration) return "ok"
      if (!data) {
        set({ error: "That service no longer exists" })
        if (rememberedServiceId() === id) remember(null) // not again at the next start
        if (get().current?.id === id) {
          closedBaseline = rundownSignature(operatorItems(useQueueStore.getState().items))
          set({ current: null, dirty: false, unsupportedItems: [], corruptItems: [], missingTranslations: [], approvedDesigns: null, approvedDesignRevision: null, approvedDesignsError: null })
          remember(null)
        }
        return "missing"
      }
      const bible = useBibleStore.getState()
      const mediaKinds = await loadMediaKinds(data)
      const { items, headers, unsupported, corrupt, missingTranslations } = toQueueItems(data, bible.activeTranslationId, bible.translations, mediaKinds)
      let approvedDesigns: ApprovedDesignSnapshot | null = null
      let approvedDesignsError: string | null = null
      if (data.program.approved_revision !== null && data.program.approved_revision !== undefined) {
        try {
          approvedDesigns = await invoke<ApprovedDesignSnapshot | null>("content_approved_designs", { programId: id, revision: data.program.approved_revision })
          if (!approvedDesigns) approvedDesignsError = "This approved service predates saved scene and look snapshots."
        } catch (e) {
          approvedDesignsError = describe(e)
        }
      }
      if (ticket !== openGeneration) return "ok"
      baseline = rundownSignature(items, headers)
      useQueueStore.setState({ items, headers, activeIndex: null })
      // Undo never reaches into the service open before.
      useQueueStore.getState().resetHistory()
      set({ current: data.program, dirty: false, error: null, conflict: null, unsupportedItems: unsupported, corruptItems: corrupt, missingTranslations, approvedDesigns, approvedDesignRevision: approvedDesigns ? data.program.approved_revision ?? null : null, approvedDesignsError })
      remember(data.program.id)
      // Fill in verse text so preview works before anything is presented.
      // Text is not part of the signature, so this never marks dirty.
      await Promise.all(
        items.filter(isVerseItem).map(async (item) => {
          try {
            const v = await invoke<Verse | null>("get_verse", {
              translationId: item.verse.translation_id,
              bookNumber: item.verse.book_number,
              chapter: item.verse.chapter,
              verse: item.verse.verse,
            })
            if (v?.text) useQueueStore.getState().backfillText(item.id, v.text)
          } catch {
            // Leave empty; presentVerse refetches on present anyway.
          }
        })
      )
      return "ok"
    } catch (e) {
      set({ error: describe(e) })
      return "error"
    } finally {
      set({ loading: false })
    }
  },

  saveCurrent: async (options) => {
    const current = get().current
    if (!current) return "nothing"
    if (get().saving) return "nothing"
    const { unsupportedItems, corruptItems } = get()
    if (unsupportedItems.length > 0 || corruptItems.length > 0) {
      set({
        error: savedItemBlockMessage("This service", "saving", unsupportedItems.length, corruptItems.length),
      })
      return "unsupported"
    }
    const generation = ++saveGeneration
    // Verses never saved take their translations now (the one they were added in, and the
    // active second one): the save writes them, and the items on screen get the same pins,
    // so presenting them follows the saved service, not a later change of translation (RG-06).
    const active = activeTranslations()
    const pins = new Map<string, { translation: string | null; secondary_translation: string | null }>()
    const snapshotItems = useQueueStore.getState().items.map((i) => {
      if (!isVerseItem(i) || i.translation !== undefined) return i
      const pin = { translation: translationAbbrev(i.verse.translation_id), secondary_translation: i.secondary_translation === undefined ? active.secondary : i.secondary_translation }
      pins.set(i.id, pin)
      return { ...i, ...pin }
    })
    const snapshotHeaders = useQueueStore.getState().headers
    const snapshot = rundownSignature(snapshotItems, snapshotHeaders)
    set({ saving: true, conflict: null })
    try {
      const data = await invoke<ProgramWithItems>(options?.carryCommentHistory ? "content_replace_items_with_history" : "content_replace_items", {
        programId: current.id,
        expectedRevision: current.revision,
        items: toItemInputs(snapshotItems, translationAbbrev, active, snapshotHeaders),
      })
      if (generation !== saveGeneration) return "saved" // a newer save owns the state now
      if (get().current?.id !== current.id) return "saved" // discarded or another service opened meanwhile: do not link it back
      if (pins.size > 0) {
        useQueueStore.setState((q) => ({
          items: q.items.map((i) => (isVerseItem(i) && i.translation === undefined && pins.has(i.id) ? { ...i, ...pins.get(i.id) } : i)),
        }))
        // The copy on air is pinned too, so a later change of translation leaves it alone.
        const live = useBroadcastStore.getState()
        const livePin = live.liveItemId ? pins.get(live.liveItemId) : undefined
        if (livePin) useBroadcastStore.setState({ liveItem: { ...(live.liveItem ?? {}), ...livePin } })
      }
      // What was saved is the new baseline; edits made meanwhile stay dirty.
      baseline = snapshot
      set((s) => ({
        current: data.program,
        dirty: rundownSignature(useQueueStore.getState().items, useQueueStore.getState().headers) !== snapshot,
        error: null,
        programs: s.programs.map((p) => (p.id === data.program.id ? data.program : p)),
      }))
      return "saved"
    } catch (e) {
      if (generation !== saveGeneration) return "failed"
      if (isContentCommandError(e) && e.kind === "conflict") {
        set({
          conflict: { expected: e.expected ?? current.revision, actual: e.actual ?? -1 },
          error: "This service was changed elsewhere since you opened it. Reload it to see the latest, or keep editing and reload later.",
        })
        return "conflict"
      }
      set({ error: describe(e) })
      return "failed"
    } finally {
      if (generation === saveGeneration) set({ saving: false })
    }
  },

  deleteProgram: async (id, opts) => {
    const s = get()
    if (s.current?.id === id && s.dirty && !opts?.discard) return "unsaved"
    const target = s.programs.find((p) => p.id === id) ?? (s.current?.id === id ? s.current : null)
    if (!target) return "failed"
    try {
      await invoke("content_delete_program", { id, expectedRevision: target.revision })
      set((st) => ({
        programs: st.programs.filter((p) => p.id !== id),
        ...(st.current?.id === id ? { current: null, dirty: false, conflict: null, unsupportedItems: [], corruptItems: [], missingTranslations: [], approvedDesigns: null, approvedDesignRevision: null, approvedDesignsError: null } : {}),
        error: null,
      }))
      if (get().current === null) remember(null)
      return "deleted"
    } catch (e) {
      set({ error: describe(e) })
      return isContentCommandError(e) && e.kind === "conflict" ? "conflict" : "failed"
    }
  },

  closeProgram: (opts) => {
    if (get().dirty && !opts?.discard) return "unsaved"
    // The rundown stays on screen: as it is now it belongs to a saved service (or was just discarded).
    closedBaseline = rundownSignature(operatorItems(useQueueStore.getState().items))
    set({ current: null, dirty: false, conflict: null, unsupportedItems: [], corruptItems: [], missingTranslations: [], approvedDesigns: null, approvedDesignRevision: null, approvedDesignsError: null })
    remember(null)
    return "closed"
  },
}))

// Any rundown change while a service is open makes it dirty; a change that
// brings it back to the baseline makes it clean again.
function recheckDirty() {
  const svc = useServiceStore.getState()
  if (!svc.current || svc.loading) return
  const dirty = rundownSignature(useQueueStore.getState().items, useQueueStore.getState().headers) !== baseline
  if (dirty !== svc.dirty) useServiceStore.setState({ dirty })
}
useQueueStore.subscribe(recheckDirty)
// The open service changed, or was approved again: the approved words of its songs are loaded (#193).
// Imported when needed: the pins' module is imported by modules this one imports.
useServiceStore.subscribe((s, prev) => {
  if (s.current?.id === prev.current?.id && s.current?.approved_at === prev.current?.approved_at && s.current?.approved_revision === prev.current?.approved_revision) return
  void import("@/stores/song-pins-store").then((m) => m.loadSongPins(s.current)).catch(() => {})
})
// Edits made while a load was running (a rename refreshing the list, verse text filling in) count once it ends.
useServiceStore.subscribe((s, prev) => {
  if (prev.loading && !s.loading) recheckDirty()
})
