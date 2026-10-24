
import { useEffect, useState } from "react"
import { ImageIcon, MessageSquareIcon, PinIcon, StickyNoteIcon, Volume2Icon, XIcon } from "lucide-react"
import { cleanComments, commentKey, MAX_COMMENTS } from "@/lib/comments"
import { itemAssignees, knownPeople, MAX_ASSIGNEES, withAssignees } from "@/lib/assignees"
import { useSettingsStore } from "@/stores/settings-store"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useQueueStore } from "@/stores"
import { useSongStore } from "@/stores/song-store"
import { useMediaStore } from "@/stores/media-store"

import { GO_LIVE_CUES, isImageItem, isSlideItem, isSongItem, isVerseItem, type GoLiveCue, type ImageQueueItem, type QueueItem, type SlideQueueItem, type SongQueueItem, type TakeStep } from "@/types"
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
  const comments = item.comments ?? []
  const add = () => {
    if (comments.length >= MAX_COMMENTS) return // never push the oldest out
    const next = cleanComments([...comments, { by: me || "Unnamed", at: new Date().toISOString(), text: draft }])
    if (next.length === comments.length) return // nothing left after cleaning
    // Written here, so already read here (also when no name is set).
    useSettingsStore.getState().markCommentsSeen([commentKey(next[next.length - 1])])
    useQueueStore.getState().updateItem(item.id, (i) => ({ ...i, comments: next }))
    setDraft("")
  }
  const remove = (index: number) =>
    useQueueStore.getState().updateItem(item.id, (i) => {
      const left = (i.comments ?? []).filter((_, k) => k !== index)
      return { ...i, comments: left.length ? left : null }
    })
  return (
    <div className="ml-7 space-y-1 py-1 pl-2 text-xs">
      {comments.map((c, k) => (
        <div key={`${c.at}-${k}`} className="flex items-start gap-2 rounded bg-muted/40 px-2 py-1">
          <MessageSquareIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <span className="font-medium">{c.by}</span> <span className="text-muted-foreground">{commentTime(c.at)}</span>
            <p className="whitespace-pre-wrap break-words">{c.text}</p>
          </div>
          <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={`Remove ${c.by}'s comment`} onClick={() => remove(k)}>
            <XIcon className="size-3" />
          </button>
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
        <Button size="sm" variant="outline" className="h-7" disabled={!draft.trim() || comments.length >= MAX_COMMENTS} onClick={add}>
          Comment
        </Button>
      </div>
      {!me && <p className="text-xs text-muted-foreground">Set your name in Team so the team knows who wrote it.</p>}
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

const fieldLabel = "mb-0.5 block text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase"
const fieldSelect = "h-7 w-full rounded-md border border-input bg-transparent px-2 text-xs"

/** One kind of Take step replaced (or removed, with null); the rest kept, in the order they run. */
function setTakeStep(itemId: string, kind: ParsedTakeStep["kind"], step: TakeStep | null) {
  useQueueStore.getState().updateItem(itemId, (i) => {
    const rest = cleanTakeSteps(i.on_take).filter((s) => parseTakeStep(s)?.kind !== kind)
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
    const armed = takeSteps(item).find((s) => s.kind === "scene")
    if (armed && armed.kind === "scene") setTakeStep(item.id, "scene", id ? sceneStep(id, armed.outputId) : null)
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
      {scenes.length === 0 && cameras.length === 0 && <p className="text-muted-foreground">Scenes are made in Production → Programs, cameras in Production → Cameras.</p>}
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
  const sceneArmed = steps.find((s) => s.kind === "scene")
  const obs = steps.find((s) => s.kind === "obs")
  const sourceOnly = steps.some((s) => s.kind === "source")
  const [obsText, setObsText] = useState<string | null>(null)
  const sceneName = scenes.find((s) => s.id === item.scene_id)?.name
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
          checked={!!sceneArmed}
          disabled={!item.scene_id && !sceneArmed}
          onChange={(e) => setTakeStep(item.id, "scene", e.target.checked && item.scene_id ? sceneStep(item.scene_id) : null)}
        />
        <span>
          <span className="font-medium">Take its scene{sceneName ? `, ${sceneName}` : ""}</span>
          <span className="block text-muted-foreground">{item.scene_id ? "Arranges the screen as the scene; what is live stays live." : "Choose its scene first (Slides → Look and scene)."}</span>
        </span>
      </label>
      {sceneArmed?.kind === "scene" && congregation.length > 1 && (
        <label className="ml-6 min-w-0">
          <span className={fieldLabel}>On</span>
          <select aria-label={`Screen for the scene of ${item.reference}`} value={sceneArmed.outputId ?? ""} onChange={(e) => setTakeStep(item.id, "scene", sceneStep(sceneArmed.sceneId, e.target.value || null))} className={fieldSelect}>
            <option value="">Every congregation screen</option>
            {congregation.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
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
