import { useId, type ReactNode } from "react"
import { ChevronLeftIcon, ChevronRightIcon, ChevronsLeftIcon, ChevronsRightIcon, MonitorIcon, RotateCcwIcon, SquareIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { outputOnAir } from "@/lib/output-on-air"
import { buildSlides } from "@/lib/lyrics"
import { useBibleStore, useBroadcastStore, useQueueStore } from "@/stores"
import { useSongStore } from "@/stores/song-store"
import { presentActions } from "@/studio/present-actions"
import { isSongItem } from "@/types"

/** "Next: Chorus" while a song is live, else the keyboard hint. */
function useNextHint(): string {
  const liveSlide = useBroadcastStore((s) => s.liveSlide)
  const items = useQueueStore((s) => s.items)
  const saved = useSongStore((s) => (liveSlide ? s.songs[liveSlide.songId] : undefined))
  // The song as it went live: what Next steps through.
  const song = liveSlide?.song ?? saved
  if (!liveSlide || !song) return "→ / PgDn"
  const item = items.find((i) => i.id === liveSlide.itemId)
  if (!item || !isSongItem(item)) return "→ / PgDn"
  // The arrangement the song went live with: the one Next steps through.
  const arrangement = liveSlide.arrangementId !== undefined ? liveSlide.arrangementId : item.song.arrangement_id
  const next = buildSlides(song, arrangement, liveSlide.languages ?? item.song.languages)[liveSlide.index + 1]
  return next ? `Next: ${next.sectionLabel}` : "→ / PgDn"
}

/** What is in Preview, in words: what Take live will put up. Null when Preview is empty. */
function usePreviewLabel(): string | null {
  return useBibleStore((s) => {
    if (s.selectedSlide) {
      const { item, index } = s.selectedSlide
      return isSongItem(item) ? `${item.reference} · slide ${index + 1}` : item.reference
    }
    const v = s.selectedVerse
    return v ? `${v.book_name} ${v.chapter}:${v.verse}`.trim() : null
  })
}

type Tone = "neutral" | "danger" | "take"

const TONE: Record<Tone, string> = {
  neutral: "border-border bg-card text-foreground hover:bg-muted aria-disabled:hover:bg-card",
  // Clear takes the screens down: red words, not a red slab (#215 keeps solid red for LIVE).
  danger: "border-border bg-card text-destructive hover:bg-destructive/10 aria-disabled:hover:bg-card",
  // The one ordinary primary action: deep teal with white words (#215).
  take: "border-transparent bg-primary px-4 text-primary-foreground hover:bg-primary/90 aria-disabled:hover:bg-primary",
}

/**
 * One transport control. A control that cannot act stays focusable and says why (tooltip and
 * screen-reader description) instead of greying out silently; a click on it does nothing.
 */
function TransportButton({
  icon,
  label,
  title,
  reason,
  onClick,
  tone = "neutral",
  text,
  hint,
  describedBy,
  className,
}: {
  icon: ReactNode
  /** The accessible name, always the same whatever the width. */
  label: string
  /** Tooltip when the control can act (put the shortcut here). */
  title: string
  /** Why it cannot act now; null when it can. */
  reason: string | null
  onClick: () => void
  tone?: Tone
  /** Visible words; their class decides the widths that show them. */
  text?: { value: string; className?: string }
  /** Small second line under the words, e.g. "Next: Chorus". */
  hint?: { value: string; className?: string }
  describedBy?: string
  className?: string
}) {
  const reasonId = useId()
  const off = reason !== null
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-disabled={off || undefined}
        aria-describedby={[off ? reasonId : null, describedBy].filter(Boolean).join(" ") || undefined}
        title={reason ?? title}
        onClick={off ? undefined : onClick}
        className={cn(
          "inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg border px-2.5 text-sm font-semibold transition-colors outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:active:translate-y-0 [&_svg]:size-5 [&_svg]:shrink-0",
          TONE[tone],
          className
        )}
      >
        {icon}
        {text && (
          <span aria-hidden className={cn("flex-col items-start leading-tight", text.className)}>
            <span>{text.value}</span>
            {hint && <span className={cn("text-[0.6875rem] font-normal opacity-70", hint.className)}>{hint.value}</span>}
          </span>
        )}
      </button>
      {off && <span id={reasonId} className="sr-only">{reason}</span>}
    </>
  )
}

/**
 * Present's transport (issue #299): step through the service on the left, one Take live in the
 * middle with what it will put up and where, Clear and Restore on the right. Every button runs
 * the same presentActions verb as the keyboard, remotes and cues, so nothing here changes what an
 * action does. The layout follows the bar's own width: on a half-size window Take live gets its
 * own row and the rest become icons with tooltips, never a sideways scroll.
 */
export function TransportBar({ className }: { className?: string }) {
  const isLive = useBroadcastStore((s) => s.isLive)
  const hasLiveItem = useBroadcastStore((s) => s.liveVerse !== null)
  const rehearsal = useBroadcastStore((s) => s.rehearsal)
  const onAir = useBroadcastStore((s) => s.outputs.filter((o) => outputOnAir(o, s.outputStatus[o.id])).length)
  const count = useQueueStore((s) => s.items.length)
  const preview = usePreviewLabel()
  const nextHint = useNextHint()
  const targetId = useId()

  const emptyRundown = count === 0 ? "The running order is empty: add items in Prepare or with Find & cue" : null
  const noLiveItem = hasLiveItem ? null : "Nothing has been live yet: take a verse live first"
  const where = rehearsal ? "this console only (rehearsal)" : onAir === 0 ? "the Live panel only: no screen is on" : `the main screens · ${onAir} ${onAir === 1 ? "output" : "outputs"} on`

  return (
    <div role="toolbar" aria-label="Presentation controls" className={cn("@container", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div role="group" aria-label="Step through the service" className="flex items-center gap-1.5">
          <TransportButton
            icon={<ChevronLeftIcon />}
            label="Previous"
            title="Previous: the slide or item before (← / PgUp)"
            reason={emptyRundown}
            onClick={() => presentActions.prev()}
            text={{ value: "Previous", className: "hidden @min-[58rem]:flex" }}
          />
          <TransportButton
            icon={<ChevronRightIcon />}
            label="Next"
            title={`Next: a song's next slide, then the next item (→ / PgDn)${nextHint.startsWith("Next:") ? ` · ${nextHint}` : ""}`}
            reason={emptyRundown}
            onClick={() => presentActions.next()}
            text={{ value: "Next", className: "hidden @min-[32rem]:flex" }}
            hint={{ value: nextHint, className: "hidden @min-[46rem]:block" }}
          />
          <span role="group" aria-label="Continue the reading" className="ml-1.5 flex items-center gap-1">
            <TransportButton
              icon={<ChevronsLeftIcon />}
              label="Previous verse"
              title="Previous verse: the verse before the live one (Shift+←)"
              reason={noLiveItem}
              onClick={() => presentActions.versePrev()}
              className="w-11 px-0"
            />
            <span aria-hidden className="hidden px-0.5 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase @min-[58rem]:inline">Verse</span>
            <TransportButton
              icon={<ChevronsRightIcon />}
              label="Next verse"
              title="Next verse: the verse after the live one, same translations (Shift+→)"
              reason={noLiveItem}
              onClick={() => presentActions.verseNext()}
              className="w-11 px-0"
            />
          </span>
        </div>

        <span aria-hidden className="hidden h-7 w-px bg-border @min-[32rem]:block" />

        {/* The one go-live action, with what it puts up and where; on a narrow bar it gets its own row. */}
        <div role="group" aria-label="Take live" className="flex min-w-0 flex-1 items-center gap-3 @max-[32rem]:order-first @max-[32rem]:basis-full">
          <TransportButton
            icon={<MonitorIcon />}
            label="Take live"
            title={preview ? `Take live: put ${preview} on ${where}` : "Take live"}
            reason={preview ? null : "Nothing in Preview: click a running-order item or find a verse first"}
            onClick={() => presentActions.showLive()}
            tone="take"
            text={{ value: "Take live", className: "flex" }}
            describedBy={targetId}
          />
          <p id={targetId} className="min-w-0 flex-1 text-xs leading-tight">
            <span className="block truncate font-medium text-foreground">{preview ?? "Nothing in Preview"}</span>
            <span className="block truncate text-muted-foreground">→ {where}</span>
          </p>
        </div>

        <span aria-hidden className="hidden h-7 w-px bg-border @min-[32rem]:block" />

        <div role="group" aria-label="Off and back on the screens" className="ml-auto flex items-center gap-1.5">
          <TransportButton
            icon={<SquareIcon />}
            label="Clear"
            title="Clear: take it off the screens; Restore brings it back (Esc)"
            reason={isLive ? null : hasLiveItem ? "Already cleared: Restore brings it back" : "Nothing is on the screens"}
            onClick={() => presentActions.clear()}
            tone="danger"
            text={{ value: "Clear", className: "hidden @min-[32rem]:flex" }}
          />
          <TransportButton
            icon={<RotateCcwIcon />}
            label="Restore"
            title="Restore: put back what was cleared (Shift+Esc)"
            reason={isLive ? "Already on the screens" : hasLiveItem ? null : "Nothing was cleared to bring back"}
            onClick={() => presentActions.restore()}
            text={{ value: "Restore", className: "hidden @min-[32rem]:flex" }}
          />
        </div>
      </div>
    </div>
  )
}
