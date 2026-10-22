
import { useEffect, useState } from "react"
import { ImageIcon, MessageSquareIcon, StickyNoteIcon, Volume2Icon, XIcon } from "lucide-react"
import { cleanComments, commentKey, MAX_COMMENTS } from "@/lib/comments"
import { useSettingsStore } from "@/stores/settings-store"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useQueueStore } from "@/stores"
import { useSongStore } from "@/stores/song-store"
import { useMediaStore } from "@/stores/media-store"

import { isImageItem, isSlideItem, isSongItem, type ImageQueueItem, type QueueItem, type SlideQueueItem, type SongQueueItem } from "@/types"
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
      ? <span className="flex shrink-0 items-center gap-1 text-[0.6875rem] font-semibold text-primary uppercase"><Volume2Icon className="size-3.5" aria-hidden /> playing</span>
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

export function PlannedMinutes({ item }: { item: QueueItem }) {
  const label = "mb-0.5 block text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase"
  return (
    <div className="ml-7 grid grid-cols-[5rem_minmax(0,1fr)_6.5rem] gap-2 py-1 pl-2 text-xs">
      <label className="min-w-0">
        <span className={label}>Minutes</span>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          max={600}
          step={0.5}
          aria-label={`Planned minutes for ${item.reference}`}
          value={item.planned_minutes ?? ""}
          placeholder="—"
          className="h-7 [appearance:textfield] text-xs tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          onChange={(e) => {
            const n = Number(e.target.value)
            useQueueStore.getState().updateItem(item.id, (i) => ({ ...i, planned_minutes: e.target.value === "" || !(n > 0) ? null : Math.min(600, n) }))
          }}
        />
      </label>
      <label className="min-w-0">
        <span className={label}>Prepared by</span>
        <Input
          aria-label={`Who prepares ${item.reference}`}
          value={item.prepared_by ?? ""}
          placeholder="Name"
          maxLength={60}
          className="h-7 text-xs"
          onChange={(e) => useQueueStore.getState().updateItem(item.id, (i) => ({ ...i, prepared_by: e.target.value.trim() ? e.target.value : null }))}
        />
      </label>
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
      {!me && <p className="text-[0.6875rem] text-muted-foreground">Set your name in Team so the team knows who wrote it.</p>}
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
