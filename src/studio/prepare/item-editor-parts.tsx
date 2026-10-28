
import { useEffect, useState } from "react"
import { ImageIcon, MessageSquareIcon, PinIcon, StickyNoteIcon, Volume2Icon, XIcon } from "lucide-react"
import { canDeleteComment, cleanComments, commentDeleted, commentKey, MAX_COMMENTS, MAX_COMMENT_HISTORY, tombstoneComment } from "@/lib/comments"
import { itemAssignees, knownPeople, MAX_ASSIGNEES, withAssignees } from "@/lib/assignees"
import { useSettingsStore } from "@/stores/settings-store"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useQueueStore } from "@/stores"
import { useSongStore } from "@/stores/song-store"
import { useMediaStore } from "@/stores/media-store"
import { useSlideStore } from "@/stores/slide-store"
import { useShellStore } from "@/studio/shell-store"

import { CUE_TRIGGERS, GO_LIVE_CUES, ITEM_CUE_DOES, isImageItem, isSlideItem, isSongItem, isVerseItem, type CueQueueItem, type CueTrigger, type GoLiveCue, type ImageQueueItem, type ItemCue, type ItemCueDo, type QueueItem, type SlideQueueItem, type SongQueueItem, type TakeStep } from "@/types"
import { CUE_DO_LABEL, cueTakesText, MAX_ITEM_CUES, TRIGGER_LABEL } from "@/lib/item-cues"
import { useSongApproval, useSongPins } from "@/stores/song-pins-store"
import { CUE_ACTIONS, takeImpact } from "@/lib/cues"
import { cleanTakeSteps, obsStep, parseTakeStep, sceneStep, takeSteps, type ParsedTakeStep } from "@/lib/item-intent"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useObsStore } from "@/stores/obs-store"
import { formatDuration, parseDuration } from "@/lib/run-of-show"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useSoundStore } from "@/stores/sound-store"

/** Prepare-only: how the picture fills the screen. */
const commentTime = (at: string) => new Date(at).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })

export function ImageItemControls({ item }: { item: ImageQueueItem }) {
  const isVideo = useMediaStore((s) => s.assets.find((a) => a.id === item.image.media_id)?.kind === "video")
  const isSound = useMediaStore((s) => s.assets.find((a) => a.id === item.image.media_id)?.kind === "audio")
  if (isSound) return <p className="ml-7 py-1 pl-2 text-xs text-muted-foreground">Plays when this item is reached (not in rehearsal); the screens keep what they show. Pause, fade or stop it with ♪ in Present.</p>
  const setImage = (patch: Partial<ImageQueueItem["image"]>) => useQueueStore.getState().updateItem(item.id, (i) => (isImageItem(i) ? { ...i, image: { ...i.image, ...patch } } : i))
  return (
    <div className="ml-7 flex flex-wrap items-center gap-2 py-1 pl-2 text-xs">
      {isVideo && (
        <>
          <label className="flex items-center gap-1"><input type="checkbox" checked={item.image.loop === true} onChange={(e) => setImage({ loop: e.target.checked })} /> Loop</label>
          <label className="flex items-center gap-1" title="Sound plays from the main output only"><input type="checkbox" checked={item.image.sound !== false} onChange={(e) => setImage({ sound: e.target.checked })} /> Sound</label>
        </>
      )}
      <span className="text-muted-foreground">Fit</span>
      <Select value={item.image.fit} onValueChange={(v) => useQueueStore.getState().updateItem(item.id, (i) => (isImageItem(i) ? { ...i, image: { ...i.image, fit: v as ImageQueueItem["image"]["fit"] } } : i))}>
        <SelectTrigger className="h-6 w-32 text-xs" aria-label="Picture fit"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="cover">Fill the screen</SelectItem>
          <SelectItem value="contain">Show it all</SelectItem>
          <SelectItem value="stretch">Stretch</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

/** Prepare-only: a library picture or video behind this item's text (a video plays silently and loops). */

/** Picture, video or sound, by the library file the item points at. */
export function MediaKindIcon({ mediaId }: { mediaId: string }) {
  const kind = useMediaStore((s) => s.assets.find((a) => a.id === mediaId)?.kind)
  const playing = useSoundStore((s) => s.playing && s.assetId === mediaId)
  if (kind === "audio") {
    return playing
      ? <span className="flex shrink-0 items-center gap-1 text-[0.6875rem] font-semibold text-primary-text uppercase"><Volume2Icon className="size-3.5" aria-hidden /> playing</span>
      : <Volume2Icon className="size-3.5 shrink-0 text-muted-foreground" aria-label="Sound" />
  }
  return <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label={kind === "video" ? "Video" : "Picture"} />
}

export function BackgroundPicker({ item }: { item: QueueItem }) {
  const assets = useMediaStore((s) => s.assets)
  const loaded = useMediaStore((s) => s.loaded)
  const loading = useMediaStore((s) => s.loading)
  useEffect(() => {
    if (!loaded && !loading) void useMediaStore.getState().list()
  }, [loaded, loading])
  const pictures = assets.filter((a) => (a.kind === "image" || a.kind === "video") && a.present)
  if (pictures.length === 0 && !item.background) return null
  return (
    <div className="ml-7 flex items-center gap-2 py-1 pl-2 text-xs">
      <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <Select
        value={item.background?.media_id ?? "__none"}
        onValueChange={(v) =>
          useQueueStore.getState().updateItem(item.id, (i) => ({
            ...i,
            background: v === "__none" ? null : { media_id: v, name: pictures.find((p) => p.id === v)?.name ?? "" },
          }))
        }
      >
        <SelectTrigger className="h-6 w-56 text-xs" aria-label="Background picture or video"><SelectValue placeholder="No background" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">No background</SelectItem>
          {pictures.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.kind === "video" ? " · video" : ""}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

/** Prepare-only: planned minutes, for the service total and the on-time chip in Present. */

/** "missing" after the item's file (picture, video or sound) when the library says it is gone. */
export function MissingMediaMark({ mediaId }: { mediaId: string }) {
  const asset = useMediaStore((s) => s.assets.find((a) => a.id === mediaId))
  const loaded = useMediaStore((s) => s.assets.length > 0)
  if (!loaded || asset?.present) return null
  return <span className="shrink-0 rounded bg-destructive/15 px-1 text-[0.6875rem] font-semibold text-destructive uppercase" title="The file is missing from the media folder">missing</span>
}

/**
 * Who is preparing or responsible for an item (#299 6.10): one chip per person, typed in (Enter
 * or a comma adds one) with the names already on this service offered. There is no team list in
 * the app yet, so any name goes. Older builds see the names as one "prepared by" line.
 */
export function AssigneesInput({ item }: { item: QueueItem }) {
  const [draft, setDraft] = useState("")
  const people = itemAssignees(item)
  const offered = useQueueStore((s) => s.items)
  const operatorName = useSettingsStore((s) => s.operatorName)
  const suggestions = knownPeople(offered, operatorName).filter((n) => !people.some((p) => p.toLowerCase() === n.toLowerCase()))
  const listId = `people-known-${item.id}`
  const save = (names: string[]) => useQueueStore.getState().updateItem(item.id, (i) => withAssignees(i, names))
  const add = () => {
    // "Tolu, Ade" pasted in is two people.
    const names = draft.split(",").map((n) => n.trim()).filter(Boolean)
    if (names.length) save([...people, ...names])
    setDraft("")
  }
  return (
    <div className="flex min-h-7 flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-1 py-0.5" role="group" aria-labelledby={`people-${item.id}`}>
      {people.map((name) => (
        <span key={name} className="inline-flex max-w-full items-center gap-0.5 rounded bg-muted py-0.5 pr-0.5 pl-1.5 text-xs">
          <span className="truncate">{name}</span>
          <button type="button" aria-label={`Remove ${name} from ${item.reference}`} className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 outline-none" onClick={() => save(people.filter((p) => p !== name))}>
            <XIcon className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      {people.length < MAX_ASSIGNEES && (
        <input
          aria-label={`Add a person to ${item.reference}`}
          list={suggestions.length ? listId : undefined}
          value={draft}
          placeholder={people.length ? "Add" : "Name"}
          maxLength={60}
          className="h-6 min-w-16 flex-1 bg-transparent px-1 text-xs outline-none placeholder:text-muted-foreground"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add() }
            else if (e.key === "Backspace" && !draft && people.length) save(people.slice(0, -1))
          }}
          onBlur={add}
        />
      )}
      {suggestions.length > 0 && <datalist id={listId}>{suggestions.map((n) => <option key={n} value={n} />)}</datalist>}
    </div>
  )
}

export function PlannedMinutes({ item }: { item: QueueItem }) {
  const label = "mb-0.5 block text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase"
  return (
    <>
    <div className="ml-7 grid grid-cols-[5rem_minmax(0,1fr)_6.5rem] gap-2 py-1 pl-2 text-xs">
      <label className="min-w-0">
        <span className={label} title="35, 4:30 (min:sec), 1:10:00 or 1h10">Time</span>
        <DurationInput
          aria-label={`Planned time for ${item.reference}`}
          minutes={item.planned_minutes ?? null}
          onChange={(m) => useQueueStore.getState().updateItem(item.id, (i) => ({ ...i, planned_minutes: m }))}
        />
      </label>
      <div className="min-w-0">
        <span className={label} id={`people-${item.id}`}>People</span>
        <AssigneesInput item={item} />
      </div>
      <label className="min-w-0">
        <span className={label}>End by</span>
        <Input
          type="time"
          aria-label={`Finish ${item.reference} by`}
          value={item.end_by ?? ""}
          className="h-7 px-2 text-xs tabular-nums"
          onChange={(e) => {
            const t = e.target.value
            useQueueStore.getState().updateItem(item.id, (i) => ({ ...i, end_by: /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : null }))
          }}
        />
      </label>
    </div>
    <StartRule item={item} />
    </>
  )
}

/**
 * How the item starts (#196 R3): after the item before (linked, as by default), after a planned
 * pause, or at a fixed clock time that running late or early before it does not move.
 */
function StartRule({ item }: { item: QueueItem }) {
  const label = "mb-0.5 block text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase"
  const fixed = Boolean(item.starts_at)
  return (
    <div className="ml-7 space-y-1 py-1 pl-2 text-xs">
      <div className="grid grid-cols-[6.5rem_5rem] gap-2">
        <label className="min-w-0">
          <span className={cn(label, "flex items-center gap-1")}>{fixed && <PinIcon className="size-3" aria-hidden />}Fixed start</span>
          <Input
            type="time"
            aria-label={`Fixed start for ${item.reference}`}
            value={item.starts_at ?? ""}
            className="h-7 px-2 text-xs tabular-nums"
            onChange={(e) => {
              const t = e.target.value
              useQueueStore.getState().updateItem(item.id, (i) => ({ ...i, starts_at: /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : null }))
            }}
          />
        </label>
        <label className="min-w-0">
          <span className={label} title="35, 4:30 (min:sec) or 1h">Pause before</span>
          <DurationInput
            aria-label={`Pause before ${item.reference}`}
            minutes={fixed ? null : item.gap_minutes ?? null}
            disabled={fixed}
            onChange={(m) => useQueueStore.getState().updateItem(item.id, (i) => ({ ...i, gap_minutes: m }))}
          />
        </label>
      </div>
      <p className="text-muted-foreground">
        {fixed
          ? `Starts at ${item.starts_at} however early or late what comes before runs; ±5 min does not move it. If the items before run past ${item.starts_at}, it starts when they finish and the run of show says so.`
          : item.gap_minutes
            ? "Starts after the item before and this pause. Running late uses the pause up first; only lateness beyond it moves this item."
            : "Starts when the item before ends. Set a fixed start to hold a clock time, or a pause to leave room for running late."}
      </p>
    </div>
  )
}

/**
 * Prepare-only: the team's comments on an item (CL-007), saved with the
 * service and carried in service files and the church folder, so the pastor
 * at home and the operator at church read the same thread. Never on screen.
 */
export function CommentsEditor({ item }: { item: QueueItem }) {
  const [draft, setDraft] = useState("")
  const me = useSettingsStore((s) => s.operatorName.trim())
  const currentItem = useQueueStore((s) => s.items.find((i) => i.id === item.id))
  const comments = cleanComments((currentItem ?? item).comments ?? [])
  const activeComments = comments.filter((c) => !commentDeleted(c)).length
  const add = () => {
    if (!me || activeComments >= MAX_COMMENTS || comments.length >= MAX_COMMENT_HISTORY) return
    const next = cleanComments([...comments, { id: crypto.randomUUID(), by: me, at: new Date().toISOString(), text: draft }])
    if (next.length === comments.length) return // nothing left after cleaning
    // Written here, so already read here (also when no name is set).
    useSettingsStore.getState().markCommentsSeen([commentKey(next[next.length - 1])])
    useQueueStore.getState().updateItem(item.id, (i) => ({ ...i, comments: next }))
    setDraft("")
  }
  const remove = (id: string) =>
    useQueueStore.getState().updateItem(item.id, (i) => {
      const comments = cleanComments(i.comments ?? [])
      const comment = comments.find((c) => c.id === id)
      if (!comment || !canDeleteComment(comment, useSettingsStore.getState().operatorName)) return i
      const tombstone = tombstoneComment(comment, useSettingsStore.getState().operatorName)
      if (!tombstone) return i
      return { ...i, comments: comments.map((c) => (c.id === id ? tombstone : c)) }
    })
  return (
    <div className="ml-7 space-y-1 py-1 pl-2 text-xs">
      {comments.map((c) => (
        <div key={c.id ?? `${c.at}-${c.by}`} className="flex items-start gap-2 rounded bg-muted/40 px-2 py-1">
          <MessageSquareIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <span className="font-medium">{c.by}</span> <span className="text-muted-foreground">{commentTime(c.at)}</span>
            <p className="whitespace-pre-wrap break-words">{c.text}</p>
            {commentDeleted(c) && <p className="text-muted-foreground">Removed by {c.deleted_by || "unknown operator"}{c.deleted_at ? ` · ${commentTime(c.deleted_at)}` : ""}</p>}
          </div>
          {canDeleteComment(c, me) && <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={`Remove ${c.by}'s comment`} onClick={() => remove(c.id ?? "")}><XIcon className="size-3" /></button>}
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input
          aria-label={`Comment on ${item.reference}`}
          placeholder="Comment for the team (never on screen)"
          value={draft}
          maxLength={1000}
          className="h-7 text-xs"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              e.preventDefault()
              add()
            }
          }}
        />
        <Button size="sm" variant="outline" className="h-7" disabled={!draft.trim() || !me || activeComments >= MAX_COMMENTS || comments.length >= MAX_COMMENT_HISTORY} onClick={add}>
          Comment
        </Button>
      </div>
      {!me && <p className="text-xs text-muted-foreground">Set your name in Team so the team knows who wrote it.</p>}
      {comments.length >= MAX_COMMENT_HISTORY && <p className="text-xs text-muted-foreground">This thread has reached its retained history limit. Keep this service copy as its audit record.</p>}
    </div>
  )
}

/** Prepare-only: a note for the operator ("read slowly", "pause for prayer"). Never on screen. */

export function NoteEditor({ item }: { item: QueueItem }) {
  return (
    <div className="ml-7 flex items-center gap-2 py-1 pl-2">
      <StickyNoteIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <Input
        aria-label={`Note for ${item.reference}`}
        placeholder="Note for the operator and the stage screen (never on the congregation's)"
        value={item.notes ?? ""}
        maxLength={4000}
        className="h-7 text-xs"
        onChange={(e) => useQueueStore.getState().updateItem(item.id, (i) => ({ ...i, notes: e.target.value || null }))}
      />
    </div>
  )
}

/** Prepare-only: edit a custom slide in place. The preview follows every keystroke. */

export function CustomSlideEditor({ item }: { item: SlideQueueItem }) {
  const update = (patch: Partial<SlideQueueItem["slide"]>) =>
    useQueueStore.getState().updateItem(item.id, (i) => {
      if (!isSlideItem(i)) return i
      const slide = { ...i.slide, ...patch }
      return { ...i, slide, reference: slide.title.trim() || slide.body.split("\n")[0]?.trim() || "Slide" }
    })
  return (
    <div className="ml-7 flex flex-col gap-1.5 py-1 pl-2">
      {item.slide.source_asset_id && <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5">
        <p className="text-[0.6875rem] text-muted-foreground">This is this service’s copy. Changes here won’t change the reusable source.</p>
        <Button size="xs" variant="outline" onClick={() => { useSlideStore.getState().requestEdit(item.slide.source_asset_id!); useShellStore.getState().openLibrarySection("slides") }}>Edit reusable source</Button>
      </div>}
      <Input aria-label="Slide title" maxLength={200} value={item.slide.title} placeholder="Title" className="h-8 text-sm" onChange={(e) => update({ title: e.target.value })} />
      <Textarea
        aria-label="Slide text"
        value={item.slide.body}
        placeholder="One line per line on screen"
        rows={Math.min(8, Math.max(3, item.slide.body.split("\n").length))}
        className="text-sm"
        onChange={(e) => update({ body: e.target.value })}
      />
    </div>
  )
}

/** Prepare-only: which languages this service shows the song in, and which order. */

export function SongItemControls({ item }: { item: SongQueueItem }) {
  const song = useSongStore((s) => s.songs[item.song.song_id])
  const update = (patch: Partial<SongQueueItem["song"]>) =>
    useQueueStore.getState().updateItem(item.id, (i) => (isSongItem(i) ? { ...i, song: { ...i.song, ...patch } } : i))
  if (!song) return null
  const available = [...new Set([song.song.primary_language, ...song.sections.flatMap((s) => Object.keys(s.texts))])]
  const toggle = (lang: string) => {
    const on = item.song.languages.includes(lang)
    const next = on ? item.song.languages.filter((l) => l !== lang) : [...item.song.languages, lang]
    if (next.length === 0) return
    update({ languages: next })
  }
  return (
    <div className="ml-7 flex flex-wrap items-center gap-2 py-1 pl-2 text-xs">
      <span className="text-muted-foreground">Show in</span>
      <span role="group" aria-label="Languages" className="flex gap-1">
        {available.map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={item.song.languages.includes(l)}
            onClick={() => toggle(l)}
            className={cn(
              "h-6 rounded-full border px-2 uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              item.song.languages.includes(l) ? "border-primary/50 bg-primary/10" : "border-border text-muted-foreground"
            )}
          >
            {l}
          </button>
        ))}
      </span>
      <label className="flex items-center gap-1.5" title="A slide with the song's title (and authors) before its words">
        <input type="checkbox" className="size-3.5" checked={!!item.song.title_slide} onChange={(e) => update({ title_slide: e.target.checked || undefined })} />
        Title slide first
      </label>
      {song.arrangements.length > 1 && (
        <Select value={item.song.arrangement_id ?? "__default"} onValueChange={(v) => update({ arrangement_id: v === "__default" ? null : v })}>
          <SelectTrigger className="h-6 w-36 text-xs" aria-label="Order"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__default">Default order</SelectItem>
            {song.arrangements.filter((a) => !a.is_default).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

/**
 * A song edited in the library since the service was approved (#193): Present shows the approved
 * words; approving again pins the new ones, or Present can use them for this service.
 */
export function SongApprovalNote({ item }: { item: SongQueueItem }) {
  const state = useSongApproval(item.song.song_id)
  if (!state) return null
  return (
    <div role="status" className="mx-2 mt-2 flex flex-wrap items-center gap-2 rounded-md bg-tone-amber px-2 py-1.5 text-xs text-tone-amber-foreground">
      <span className="min-w-0 flex-1">
        Changed since approval: the song was edited in the library (approved at revision {state.approvedRevision}, now {state.libraryRevision}). {state.usingNew ? "Present shows the new words in this service." : "Present shows the approved words. Approve the service again to use the new ones, or choose them in Present."}
      </span>
      {state.usingNew && <Button size="xs" variant="outline" onClick={() => useSongPins.getState().setLatest(item.song.song_id, false)}>Back to the approved words</Button>}
    </div>
  )
}

/**
 * The slides of one song item. Loads the song when it is not cached. In
 * prepare mode each slide previews; in present mode double-click presents.
 */

/**
 * What happens as the item goes on air (issue #193): a message on the stage screen only and one
 * cue that never changes what the congregation sees. Runs once per go-live, not in rehearsal.
 */
export function GoLiveCues({ item }: { item: QueueItem }) {
  const on = item.on_live ?? {}
  const set = (patch: Partial<NonNullable<QueueItem["on_live"]>>) =>
    useQueueStore.getState().updateItem(item.id, (i) => {
      // Kept as typed (cleaned when saved), so a space can be typed.
      const next = { ...(i.on_live ?? {}), ...patch }
      return { ...i, on_live: next.stage_message?.trim() || next.cue ? next : null }
    })
  const label = "mb-0.5 block text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase"
  return (
    <section className="mt-4 ml-7 flex flex-col gap-2 border-t border-border pt-3 pl-2 text-xs" aria-labelledby={`golive-${item.id}`}>
      <h3 id={`golive-${item.id}`} className="text-sm font-semibold">When it goes live</h3>
      <p className="text-muted-foreground">Runs once as this item goes on air for the congregation (not in rehearsal). Nothing here changes what the congregation sees.</p>
      <label className="min-w-0">
        <span className={label}>Stage message</span>
        <Input
          aria-label={`Stage message when ${item.reference} goes live`}
          value={on.stage_message ?? ""}
          placeholder="Shown on the stage screen only, e.g. Wrap up in 2 minutes"
          maxLength={120}
          className="h-7 text-xs"
          onChange={(e) => set({ stage_message: e.target.value })}
        />
      </label>
      <label className="min-w-0">
        <span className={label}>Cue</span>
        <select
          aria-label={`Cue when ${item.reference} goes live`}
          value={on.cue ?? ""}
          onChange={(e) => set({ cue: (e.target.value || undefined) as GoLiveCue | undefined })}
          className="h-7 w-full rounded-md border border-input bg-transparent px-2 text-xs"
        >
          <option value="">None</option>
          {GO_LIVE_CUES.map((c) => <option key={c} value={c}>{CUE_ACTIONS[c].label}</option>)}
        </select>
      </label>
    </section>
  )
}

/**
 * The item's cue list (#193, #196 R6): more cues for when it starts, and cues for when its planned
 * time is up, when it is paused (a hold, or the timer paused) and when it ends. Each is a stage
 * message, an OBS recording marker or a timer step: none changes what the congregation sees, and
 * none runs in rehearsal.
 */
export function ItemCuesEditor({ item }: { item: QueueItem }) {
  const cues = item.cues ?? []
  const write = (next: ItemCue[]) => useQueueStore.getState().updateItem(item.id, (i) => ({ ...i, cues: next.length ? next : null }))
  const change = (k: number, patch: Partial<ItemCue>) => write(cues.map((c, j) => (j === k ? { ...c, ...patch, ...(patch.do && !cueTakesText(patch.do) ? { text: undefined } : {}) } : c)))
  return (
    <section className="mt-4 ml-7 flex flex-col gap-2 border-t border-border pt-3 pl-2 text-xs" aria-labelledby={`cues-${item.id}`}>
      <h3 id={`cues-${item.id}`} className="text-sm font-semibold">Cues</h3>
      <p className="text-muted-foreground">More moments for this item: when its planned time is up, when it is paused, when it ends. None changes what the congregation sees, and none runs in rehearsal.</p>
      {cues.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label={`Cues of ${item.reference}`}>
          {cues.map((c, k) => (
            <li key={k} className="flex flex-wrap items-center gap-1.5">
              <select aria-label={`Cue ${k + 1}: when`} value={c.on} onChange={(e) => change(k, { on: e.target.value as CueTrigger })} className={cn(fieldSelect, "w-auto min-w-0 flex-1 basis-36")}>
                {CUE_TRIGGERS.map((t) => <option key={t} value={t}>{TRIGGER_LABEL[t]}</option>)}
              </select>
              <select aria-label={`Cue ${k + 1}: what`} value={c.do} onChange={(e) => change(k, { do: e.target.value as ItemCueDo })} className={cn(fieldSelect, "w-auto min-w-0 flex-1 basis-36")}>
                {ITEM_CUE_DOES.map((d) => <option key={d} value={d}>{CUE_DO_LABEL[d]}</option>)}
              </select>
              {cueTakesText(c.do) && (
                <Input
                  aria-label={c.do === "stage.message" ? `Cue ${k + 1}: stage message` : `Cue ${k + 1}: marker name`}
                  value={c.text ?? ""}
                  maxLength={120}
                  placeholder={c.do === "stage.message" ? "Shown on the stage screen only" : `Marker name (else "${item.reference}")`}
                  className="h-7 min-w-0 flex-1 basis-48 text-xs"
                  onChange={(e) => change(k, { text: e.target.value })}
                />
              )}
              <Button variant="ghost" size="icon-xs" aria-label={`Remove cue ${k + 1}`} onClick={() => write(cues.filter((_, j) => j !== k))}><XIcon /></Button>
            </li>
          ))}
        </ul>
      )}
      {cues.length < MAX_ITEM_CUES && (
        <Button variant="outline" size="xs" className="self-start" onClick={() => write([...cues, { on: "end", do: "obs.mark" }])}>Add a cue</Button>
      )}
    </section>
  )
}

/** A cue-only item (#193): its name; it shows nothing and fires its cues when taken. */
export function CueItemEditor({ item }: { item: CueQueueItem }) {
  return (
    <div className="flex flex-col gap-2 px-2 pt-3 text-xs">
      <label className="min-w-0">
        <span className={fieldLabel}>Name</span>
        <Input
          aria-label="Name of the cue"
          value={item.reference}
          maxLength={200}
          className="h-7 text-xs"
          onChange={(e) => useQueueStore.getState().updateItem(item.id, (i) => ({ ...i, reference: e.target.value }))}
        />
      </label>
      <p className="text-muted-foreground">A moment in the run of show with nothing on screen, e.g. "Sermon begins" with an OBS recording marker. Taking it in Present fires its cues (set them in Signals) and starts its time; the screens keep what they show.</p>
    </div>
  )
}

const fieldLabel = "mb-0.5 block text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase"
const fieldSelect = "h-7 w-full rounded-md border border-input bg-transparent px-2 text-xs"

/** Replace one Take action; scene actions are keyed by their congregation output. */
function setTakeStep(itemId: string, kind: ParsedTakeStep["kind"], step: TakeStep | null, sceneOutputId?: string | null) {
  useQueueStore.getState().updateItem(itemId, (i) => {
    const parsedNext = step ? parseTakeStep(step) : null
    const targetOutputId = sceneOutputId !== undefined
      ? sceneOutputId
      : parsedNext?.kind === "scene" ? parsedNext.outputId : null
    const rest = cleanTakeSteps(i.on_take).filter((s) => {
      const parsed = parseTakeStep(s)
      if (parsed?.kind !== kind) return true
      return kind === "scene" && parsed.kind === "scene" && parsed.outputId !== targetOutputId
    })
    const next = cleanTakeSteps(step ? [...rest, step] : rest)
    return { ...i, on_take: next.length ? next : null }
  })
}

/**
 * Prepare: how this item is meant to look (#299 6.6, #243 RS.3): a congregation scene, a look and a
 * camera, chosen from the church's own. Present shows them under Preview as the plan; none is taken
 * by itself (Signals → When you Take it can arm the scene for your Take).
 */
export function LookAndScene({ item }: { item: QueueItem }) {
  const scenes = useBroadcastStore((s) => s.scenes)
  const looks = useBroadcastStore((s) => s.themes)
  const cameras = useSettingsStore((s) => s.cameras)
  const update = (patch: Partial<Pick<QueueItem, "scene_id" | "look_id" | "camera">>) => useQueueStore.getState().updateItem(item.id, (i) => ({ ...i, ...patch }))
  const setScene = (id: string | null) => {
    update({ scene_id: id })
    // A scene armed for the Take follows the item's scene (and goes when it has none).
    const shared = takeSteps(item).find((s) => s.kind === "scene" && s.outputId === null)
    if (shared?.kind === "scene") setTakeStep(item.id, "scene", id ? sceneStep(id) : null, null)
  }
  const pick = (value: string) => (value === "" ? null : value)
  // A saved choice this computer does not have stays selected, and says so.
  const unknown = (id: string | null | undefined, known: boolean) => (id && !known ? <option value={id}>Not on this computer</option> : null)
  return (
    <section className="mt-4 ml-7 flex flex-col gap-2 border-t border-border pt-3 pl-2 text-xs" aria-labelledby={`look-${item.id}`}>
      <h3 id={`look-${item.id}`} className="text-sm font-semibold">Look and scene</h3>
      <p className="text-muted-foreground">The plan for this item. Present shows it under Preview; nothing here changes a screen. The look is how Preview above draws it.</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="min-w-0">
          <span className={fieldLabel}>Scene</span>
          <select aria-label={`Scene for ${item.reference}`} value={item.scene_id ?? ""} onChange={(e) => setScene(pick(e.target.value))} className={fieldSelect}>
            <option value="">None</option>
            {unknown(item.scene_id, scenes.some((s) => s.id === item.scene_id))}
            {scenes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="min-w-0">
          <span className={fieldLabel}>Look</span>
          <select aria-label={`Look for ${item.reference}`} value={item.look_id ?? ""} onChange={(e) => update({ look_id: pick(e.target.value) })} className={fieldSelect}>
            <option value="">The screen's own</option>
            {unknown(item.look_id, looks.some((l) => l.id === item.look_id))}
            {looks.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label className="min-w-0">
          <span className={fieldLabel}>Camera</span>
          <select aria-label={`Camera for ${item.reference}`} value={item.camera ?? ""} onChange={(e) => update({ camera: pick(e.target.value) })} className={fieldSelect}>
            <option value="">None</option>
            {unknown(item.camera, cameras.some((c) => c.name === item.camera))}
            {cameras.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}
          </select>
        </label>
      </div>
      {scenes.length === 0 && cameras.length === 0 && <p className="text-muted-foreground">Scenes are made in Production → Scenes, cameras in Production → Cameras.</p>}
    </section>
  )
}

/**
 * Prepare: what your own Take of this item also does (#243 RS.4, OB.2): take its scene, switch OBS,
 * or (a reading) go to the Bible feeds only. Runs once as you, or a joined desk, take it on air;
 * never for a timed move or a phase running by itself, and none of it puts anything live by itself.
 */
export function TakeSteps({ item }: { item: QueueItem }) {
  const scenes = useBroadcastStore((s) => s.scenes)
  const outputs = useBroadcastStore((s) => s.outputs)
  const obsScenes = useObsStore((s) => s.scenes)
  const obsOn = useSettingsStore((s) => s.obs.enabled)
  const steps = takeSteps(item)
  const sceneSteps = steps.filter((s): s is Extract<ParsedTakeStep, { kind: "scene" }> => s.kind === "scene")
  const sharedScene = sceneSteps.find((s) => s.outputId === null)
  const sceneOverrides = sceneSteps.filter((s) => s.outputId !== null)
  const obs = steps.find((s) => s.kind === "obs")
  const sourceOnly = steps.some((s) => s.kind === "source")
  const [obsText, setObsText] = useState<string | null>(null)
  const sharedSceneId = sharedScene?.sceneId ?? item.scene_id
  const sceneName = scenes.find((s) => s.id === sharedSceneId)?.name
  const congregation = outputs.filter((o) => (o.role ?? "congregation") === "congregation")
  const impact = takeImpact(item.on_take)
  const listId = `obs-scenes-${item.id}`
  const applyObs = () => {
    if (obsText === null) return
    setTakeStep(item.id, "obs", obsText.trim() ? obsStep(obsText.trim()) : null)
    setObsText(null)
  }
  return (
    <section className="mt-4 ml-7 flex flex-col gap-2 border-t border-border pt-3 pl-2 text-xs" aria-labelledby={`take-${item.id}`}>
      <h3 id={`take-${item.id}`} className="text-sm font-semibold">When you Take it</h3>
      <p className="text-muted-foreground">Runs once when you (or a joined desk) take this item on air: not for a timed move or a phase running by itself. In rehearsal a scene Take is practice and OBS is never changed.</p>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5 size-4"
          checked={!!sharedScene}
          disabled={!item.scene_id && !sharedScene}
          onChange={(e) => setTakeStep(item.id, "scene", e.target.checked && sharedSceneId ? sceneStep(sharedSceneId) : null, null)}
        />
        <span>
          <span className="font-medium">Take its scene{sceneName ? `, ${sceneName}` : ""} on every congregation screen</span>
          <span className="block text-muted-foreground">{sharedSceneId ? "Arranges each congregation screen as this scene; screen overrides run after it. What is live stays live." : "Choose its scene first (Slides → Look and scene)."}</span>
        </span>
      </label>
      {sceneOverrides.map((override, index) => {
        const output = outputs.find((candidate) => candidate.id === override.outputId)
        const isValidOutput = !!output && (output.role ?? "congregation") === "congregation"
        const optionsForThisOverride = congregation.filter((candidate) =>
          candidate.id === override.outputId || !sceneOverrides.some((other) => other !== override && other.outputId === candidate.id),
        )
        const sceneExists = scenes.some((candidate) => candidate.id === override.sceneId)
        return (
          <div key={`${override.outputId}:${index}`} className="ml-6 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <label className="min-w-0">
              <span className={fieldLabel}>Congregation screen</span>
              <select
                aria-label={`Screen target for ${item.reference} ${index + 1}`}
                value={override.outputId!}
                onChange={(e) => setTakeStep(item.id, "scene", sceneStep(override.sceneId, e.target.value), override.outputId)}
                className={fieldSelect}
              >
                {!isValidOutput && (
                  <option value={override.outputId!} disabled>
                    {output ? `Not a congregation screen: ${output.name}` : `Screen not found: ${override.outputId}`}
                  </option>
                )}
                {optionsForThisOverride.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
              </select>
            </label>
            <label className="min-w-0">
              <span className={fieldLabel}>Scene on this screen</span>
              <select
                aria-label={`Scene override ${index + 1} for ${item.reference}`}
                value={override.sceneId}
                onChange={(e) => setTakeStep(item.id, "scene", sceneStep(e.target.value, override.outputId), override.outputId)}
                className={fieldSelect}
              >
                {!sceneExists && <option value={override.sceneId} disabled>Scene not on this computer: {override.sceneId}</option>}
                {scenes.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
              </select>
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove screen override ${index + 1} for ${item.reference}`}
              className="mt-3 size-7"
              onClick={() => setTakeStep(item.id, "scene", null, override.outputId)}
            >
              <XIcon className="size-3.5" aria-hidden />
            </Button>
          </div>
        )
      })}
      {congregation.some((o) => !sceneOverrides.some((override) => override.outputId === o.id)) && scenes.length > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Add screen override for ${item.reference}`}
          className="ml-6 h-7 w-fit text-xs"
          onClick={() => {
            const target = congregation.find((o) => !sceneOverrides.some((override) => override.outputId === o.id))
            const sceneId = item.scene_id && scenes.some((candidate) => candidate.id === item.scene_id) ? item.scene_id : scenes[0]?.id
            if (target && sceneId) setTakeStep(item.id, "scene", sceneStep(sceneId, target.id))
          }}
        >
          Add screen override
        </Button>
      )}
      <label className="min-w-0">
        <span className={fieldLabel}>Switch OBS to</span>
        <Input
          aria-label={`OBS scene when ${item.reference} is taken`}
          list={listId}
          value={obsText ?? (obs?.kind === "obs" ? obs.scene : "")}
          placeholder={obsOn ? "An OBS scene, e.g. Sermon" : "Connect OBS in Production → OBS first"}
          maxLength={180}
          className="h-7 text-xs"
          onChange={(e) => setObsText(e.target.value)}
          onBlur={applyObs}
          onKeyDown={(e) => { if (e.key === "Enter") applyObs(); if (e.key === "Escape") setObsText(null) }}
        />
        <datalist id={listId}>{obsScenes.map((n) => <option key={n} value={n} />)}</datalist>
        <span className="mt-0.5 block text-muted-foreground">In OBS's Studio Mode it waits in OBS's preview for OBS's own Take.</span>
      </label>
      {isVerseItem(item) && (
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 size-4" checked={sourceOnly} onChange={(e) => setTakeStep(item.id, "source", e.target.checked ? "source.only" : null)} />
          <span>
            <span className="font-medium">Bible feeds only</span>
            <span className="block text-muted-foreground">Take sends this reading to the feeds that follow Bible (an OBS lower third, a scene's Bible box); the main screens keep what they show.</span>
          </span>
        </label>
      )}
      {impact.length > 0 && (
        <ul className="list-disc pl-4 text-muted-foreground" aria-label="What your Take of it also touches">
          {impact.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
    </section>
  )
}

/** Prepare: let this item move on by itself after its planned minutes (only while timed moves are on in Present). */
export function TimedAdvance({ item }: { item: QueueItem }) {
  const minutes = item.planned_minutes ?? 0
  return (
    <label className="mt-3 ml-7 flex items-start gap-2 pl-2 text-xs">
      <input
        type="checkbox"
        className="mt-0.5 size-4"
        checked={!!item.auto_advance}
        disabled={!minutes && !item.auto_advance}
        onChange={(e) => useQueueStore.getState().updateItem(item.id, (i) => ({ ...i, auto_advance: e.target.checked || null }))}
      />
      <span>
        <span className="font-medium">Move on by itself{minutes ? ` after ${minutes} min` : ""}</span>
        <span className="block text-muted-foreground">
          {minutes ? "Goes to the next item in its phase, only while Timed moves is on in Present. Anything you do to what is live cancels it." : "Give it planned minutes first."}
        </span>
      </span>
    </label>
  )
}

/**
 * A planned time typed as "35", "4:30", "1:10:00" or "1h10" (#196); applied on Enter or leaving the
 * field, written back the same way. Anything else is shown as a mistake and not applied.
 */
export function DurationInput({ minutes, onChange, ...rest }: { minutes: number | null; onChange: (m: number | null) => void; "aria-label": string; disabled?: boolean }) {
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? (minutes ? formatDuration(minutes) : "")
  const bad = text !== null && text.trim() !== "" && parseDuration(text) === null
  const apply = () => {
    if (text === null) return
    if (text.trim() === "") onChange(null)
    else if (!bad) onChange(parseDuration(text))
    if (!bad) setText(null)
  }
  return (
    <Input
      {...rest}
      inputMode="text"
      value={shown}
      placeholder="—"
      aria-invalid={bad || undefined}
      title={bad ? "Type minutes (35), min:sec (4:30), h:mm:ss (1:10:00) or 1h10" : undefined}
      className={cn("h-7 text-xs tabular-nums", bad && "border-destructive")}
      onChange={(e) => setText(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => { if (e.key === "Enter") apply(); if (e.key === "Escape") setText(null) }}
    />
  )
}
