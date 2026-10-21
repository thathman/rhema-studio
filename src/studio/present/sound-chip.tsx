import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { MusicIcon, PauseIcon, PlayIcon, SquareIcon } from "lucide-react"
import { currentSong } from "@/lib/backing-tracks"
import { useBroadcastStore, useQueueStore } from "@/stores"
import type { MediaAsset } from "@/types/content"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useMediaStore } from "@/stores/media-store"
import { FADE_MS, useSoundStore } from "@/stores/sound-store"
import { cn } from "@/lib/utils"

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`

/**
 * Sound on this computer (walk-in music, a backing track): pick one from
 * the media library, then pause, fade out or stop. Never changes a screen.
 */
export function SoundChip() {
  const sound = useSoundStore()
  const assets = useMediaStore((s) => s.assets)
  const sounds = assets.filter((a) => a.kind === "audio")
  const active = sound.assetId !== null
  const left = sound.duration > 0 ? Math.max(0, sound.duration - sound.position) : null
  const items = useQueueStore((s) => s.items)
  const activeIndex = useQueueStore((s) => s.activeIndex)
  const liveItemId = useBroadcastStore((s) => s.liveItemId)
  const song = currentSong(items, liveItemId, activeIndex)
  // The current song's sound attachments, looked up while the popover is open
  // and again when the song changes; a slower, older lookup never wins.
  const [open, setOpen] = useState(false)
  const [tracks, setTracks] = useState<{ songId: string; files: MediaAsset[] } | null>(null)
  const songId = song?.song.song_id ?? null
  useEffect(() => {
    if (!open || !songId) return
    let cancelled = false
    invoke<MediaAsset[]>("content_list_song_attachments", { songId })
      .then((files) => { if (!cancelled) setTracks({ songId, files: files.filter((f) => f.kind === "audio") }) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [open, songId])
  const onOpen = (next: boolean) => {
    setOpen(next)
    if (next && !useMediaStore.getState().loaded) void useMediaStore.getState().list()
  }
  const songTracks = song && tracks?.songId === song.song.song_id ? tracks.files : []
  return (
    <Popover onOpenChange={onOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-8 max-w-48 items-center gap-2 rounded-full border border-border bg-card px-3 text-xs font-medium tabular-nums outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
            sound.playing && "border-primary/60 text-primary",
            sound.error && "text-confidence-mid",
          )}
          title={sound.error ?? "Play a sound on this computer"}
        >
          <MusicIcon className="size-3.5 shrink-0" />
          {/* Idle it is just the note, to save room in the header; the name shows while a sound is loaded. */}
          {active ? <span className="truncate">{`${sound.playing ? "" : "❚❚ "}${sound.name}`}</span> : <span className="sr-only">Sound</span>}
          {active && left !== null && <span className="shrink-0 text-muted-foreground">−{mmss(left)}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col gap-3 text-xs">
          {active && (
            <div className="flex flex-col gap-2 rounded-md border border-border p-2">
              <p className="truncate font-medium">{sound.name}</p>
              <p className="tabular-nums text-muted-foreground">{mmss(sound.position)}{sound.duration > 0 ? ` / ${mmss(sound.duration)}` : ""}{sound.fading ? " · fading out" : ""}</p>
              <div className="flex flex-wrap gap-1.5">
                {sound.playing ? (
                  <Button size="sm" variant="outline" onClick={sound.pause}><PauseIcon /> Pause</Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={sound.resume}><PlayIcon /> Resume</Button>
                )}
                <Button size="sm" variant="outline" disabled={!sound.playing || sound.fading} onClick={() => sound.fadeOut()}>Fade out ({FADE_MS / 1000} s)</Button>
                <Button size="sm" variant="outline" onClick={sound.stop}><SquareIcon /> Stop</Button>
              </div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={sound.loop} onChange={(e) => sound.setLoop(e.target.checked)} />
              Repeat
            </label>
            <label className="flex flex-1 items-center gap-1.5">
              Volume
              <input type="range" min={0} max={1} step={0.05} value={sound.volume} onChange={(e) => sound.setVolume(Number(e.target.value))} aria-label="Sound volume" className="flex-1" />
            </label>
          </div>
          {sound.error && <p role="alert" className="text-confidence-mid">{sound.error}</p>}
          {song && songTracks.length > 0 && (
            <ul aria-label={`Backing tracks for ${song.reference}`} className="rounded-md border border-border p-2">
              <li className="pb-1 text-muted-foreground">Backing track for {song.reference}</li>
              {songTracks.map((a) => {
                const present = assets.find((x) => x.id === a.id)?.present ?? true // not listed yet: Play reports a missing file itself
                return (
                  <li key={a.id} className="flex items-center gap-2 py-1">
                    <span className={cn("min-w-0 flex-1 truncate", sound.assetId === a.id && "font-medium text-primary")} title={a.name}>{a.name}</span>
                    {!present && <span className="text-destructive">missing</span>}
                    <Button size="xs" disabled={!present} onClick={() => void sound.play({ id: a.id, name: a.name })}><PlayIcon /> Play</Button>
                  </li>
                )
              })}
            </ul>
          )}
          <ul className="max-h-48 overflow-y-auto" aria-label="Sounds">
            {sounds.length === 0 && <li className="py-2 text-muted-foreground">No sounds yet. Import MP3, M4A, WAV or OGG files in Prepare → Media.</li>}
            {sounds.map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-1">
                <span className={cn("min-w-0 flex-1 truncate", sound.assetId === a.id && "font-medium text-primary")} title={a.name}>{a.name}</span>
                {!a.present && <span className="text-destructive">missing</span>}
                <Button size="xs" variant="outline" disabled={!a.present} onClick={() => void sound.play({ id: a.id, name: a.name })}><PlayIcon /> Play</Button>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">Plays on this computer's sound output; screens and outputs are not changed. One sound at a time.</p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
