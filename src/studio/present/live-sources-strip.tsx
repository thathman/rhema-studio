import { RotateCcwIcon, XIcon } from "lucide-react"
import { CONTENT_NAMES } from "@/lib/content-names"
import type { SourceId } from "@/lib/live-sources"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { CONTENT_TYPES } from "@/types/broadcast"

/**
 * What each live source holds (ADR 0001), for the feeds that follow chosen sources: Romans 8:28 can
 * stay on the Bible feeds while a hymn is on the projector. Shown only when an output follows
 * chosen sources; each can be taken off or brought back on its own.
 */
export function LiveSourcesStrip() {
  const sources = useBroadcastStore((s) => s.sources)
  const outputs = useBroadcastStore((s) => s.outputs)
  const rehearsal = useBroadcastStore((s) => s.rehearsal)
  const followed = new Set(outputs.flatMap((o) => o.shows ?? []))
  if (followed.size === 0) return null
  const rows = CONTENT_TYPES.filter((k) => followed.has(k) && sources[k])
  return (
    <div role="group" aria-label="Live sources" className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border px-3 py-2">
      <span className="text-[0.625rem] font-bold tracking-[0.08em] text-muted-foreground uppercase">Sources</span>
      {rows.length === 0 && <span className="text-[0.6875rem] text-muted-foreground">Nothing live for the feeds yet</span>}
      {rows.map((k) => {
        const src = sources[k]!
        const feeds = outputs.filter((o) => o.shows?.includes(k)).length
        return (
          <span key={k} className={src.on ? "flex items-center gap-1 rounded-full border border-live-pulse/40 bg-live-pulse/10 py-0.5 pr-0.5 pl-2.5 text-[0.6875rem]" : "flex items-center gap-1 rounded-full border border-border py-0.5 pr-0.5 pl-2.5 text-[0.6875rem] text-muted-foreground"}>
            <span className="font-semibold">{CONTENT_NAMES[k]}</span>
            <span className="max-w-40 truncate">{src.value.reference}</span>
            <span className="text-muted-foreground">· {feeds} {feeds === 1 ? "feed" : "feeds"}</span>
            <SourceButton id={k} on={src.on} disabled={rehearsal} label={`${CONTENT_NAMES[k]}: ${src.value.reference}`} />
          </span>
        )
      })}
    </div>
  )
}

function SourceButton({ id, on, disabled, label }: { id: SourceId; on: boolean; disabled: boolean; label: string }) {
  const b = useBroadcastStore.getState()
  return on ? (
    <button type="button" disabled={disabled} onClick={() => b.clearSource(id)} aria-label={`Take ${label} off its feeds`} title="Take it off the feeds that follow it (Restore brings it back)" className="flex size-5 items-center justify-center rounded-full hover:bg-muted disabled:opacity-40 [&_svg]:size-3">
      <XIcon />
    </button>
  ) : (
    <button type="button" disabled={disabled} onClick={() => b.restoreSource(id)} aria-label={`Restore ${label} on its feeds`} title="Put it back on the feeds that follow it" className="flex size-5 items-center justify-center rounded-full hover:bg-muted disabled:opacity-40 [&_svg]:size-3">
      <RotateCcwIcon />
    </button>
  )
}
