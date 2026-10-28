import { CUE_TRIGGERS, GO_LIVE_CUES, ITEM_CUE_DOES, type CueTrigger, type ItemCue, type ItemCueDo, type QueueItem } from "@/types"

/**
 * An item's cue list (#193, #196 R6): what runs as its event starts, when its planned time is up,
 * when it is paused and when it ends. A cue never changes what the congregation sees: it starts,
 * pauses or resets the service timer, sets or clears the stage-only message, or marks the OBS
 * recording (a chapter, and a line in the service log). Never in rehearsal.
 */
export const MAX_ITEM_CUES = 12

export const TRIGGER_LABEL: Record<CueTrigger, string> = {
  live: "When it starts",
  finish: "When its planned time is up",
  pause: "When it is paused",
  end: "When it ends",
}

export const CUE_DO_LABEL: Record<ItemCueDo, string> = {
  "timer.start": "Start the timer",
  "timer.fresh": "Start the timer from zero (unless it is running)",
  "timer.pause": "Pause the timer",
  "stage.clearMessage": "Clear the stage message",
  "stage.message": "Stage message",
  "obs.mark": "OBS recording marker",
}

/** Which cues take words: a stage message needs them; a marker uses the item's name without. */
export const cueTakesText = (d: ItemCueDo): boolean => d === "stage.message" || d === "obs.mark"

/** One line, at most 120 characters, control characters as spaces. */
function oneLine(raw: unknown): string {
  if (typeof raw !== "string") return ""
  // eslint-disable-next-line no-control-regex
  return Array.from(raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim()).slice(0, 120).join("").trim()
}

/** The cues worth saving: a known trigger and action, words where they belong; at most 12. */
export function cleanCues(cues: readonly ItemCue[] | null | undefined): ItemCue[] {
  if (!Array.isArray(cues)) return []
  const out: ItemCue[] = []
  for (const c of cues) {
    if (!c || typeof c !== "object") continue
    if (!(CUE_TRIGGERS as readonly string[]).includes(c.on) || !(ITEM_CUE_DOES as readonly string[]).includes(c.do)) continue
    const text = cueTakesText(c.do) ? oneLine(c.text) : ""
    if (c.do === "stage.message" && !text) continue
    out.push({ on: c.on, do: c.do, ...(text ? { text } : {}) })
    if (out.length === MAX_ITEM_CUES) break
  }
  return out
}

/**
 * Every cue of an item for one moment, in order: its go-live message and cue (`on_live`, which
 * older builds run too) first, then the list's.
 */
export function cuesFor(item: Pick<QueueItem, "on_live" | "cues">, on: CueTrigger): ItemCue[] {
  const out: ItemCue[] = []
  if (on === "live" && item.on_live) {
    const message = item.on_live.stage_message?.trim()
    if (message) out.push({ on, do: "stage.message", text: message })
    if (item.on_live.cue && (GO_LIVE_CUES as readonly string[]).includes(item.on_live.cue)) out.push({ on, do: item.on_live.cue })
  }
  return [...out, ...cleanCues(item.cues).filter((c) => c.on === on)]
}

/** Whether an item has anything to fire at all. */
export const hasCues = (item: Pick<QueueItem, "on_live" | "cues">): boolean => CUE_TRIGGERS.some((t) => cuesFor(item, t).length > 0)

/** A cue in words, for the rundown's bell and the item editor: "When it ends: pause the timer". */
export function cueText(c: ItemCue, itemName = ""): string {
  const what = c.do === "stage.message" ? `stage message "${c.text ?? ""}"` : c.do === "obs.mark" ? `OBS marker "${c.text || itemName}"` : CUE_DO_LABEL[c.do].toLowerCase()
  return `${TRIGGER_LABEL[c.on]}: ${what}`
}
