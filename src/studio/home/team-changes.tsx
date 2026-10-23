import { useEffect, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { BadgeCheckIcon, ChevronRightIcon, MessageSquareIcon, SaveIcon } from "lucide-react"
import { commentAuthor } from "@/lib/comments"
import { changeTime, teamChanges, type TeamChange } from "@/lib/team-changes"
import { localDate, todaysService } from "@/lib/todays-service"
import { useQueueStore } from "@/stores"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"
import { presentActions } from "@/studio/present-actions"
import { useShellStore } from "@/studio/shell-store"
import type { RevisionSummary } from "@/types"

function when(iso: string): string {
  const t = changeTime(iso)
  return t ? new Date(t).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""
}

/**
 * Home's "Team changes" (#215): the latest comments, saves and approval for the open service, or
 * today's suggested one. A click opens Prepare on that item, or on the service's History.
 */
export function TeamChanges() {
  const current = useServiceStore((s) => s.current)
  const programs = useServiceStore((s) => s.programs)
  const dirty = useServiceStore((s) => s.dirty)
  const items = useQueueStore((s) => s.items)
  const seenList = useSettingsStore((s) => s.commentsSeen)
  const seen = useMemo(() => new Set(seenList), [seenList])
  const me = useSettingsStore((s) => s.operatorName)
  // The open service, else today's (or the next approved) one Home suggests opening.
  const service = current ?? todaysService(programs, localDate())?.program ?? null
  const [revisions, setRevisions] = useState<RevisionSummary[]>([])
  const id = service?.id
  const revision = service?.revision
  useEffect(() => {
    if (!id) return
    let cancelled = false
    invoke<RevisionSummary[]>("content_list_revisions", { programId: id })
      .then((list) => { if (!cancelled) setRevisions(Array.isArray(list) ? list : []) })
      .catch(() => { if (!cancelled) setRevisions([]) })
    return () => { cancelled = true }
  }, [id, revision])

  if (!service) return null
  const isOpen = current?.id === service.id
  const changes = teamChanges(service, isOpen ? items : null, revisions, seen, me)
  if (changes.length === 0) return null

  // A service that is not open has to be opened first; unsaved changes elsewhere stop that, as Home's Open does.
  const openService = async () => {
    if (isOpen) return true
    const r = await useServiceStore.getState().openProgram(service.id)
    if (r !== "ok") toast.error("Could not open service", { description: useServiceStore.getState().error ?? undefined })
    return r === "ok"
  }
  const go = async (c: TeamChange) => {
    if (c.kind === "comment") {
      const item = useQueueStore.getState().items.find((i) => i.id === c.itemId)
      if (item) presentActions.previewItem(item)
      useShellStore.getState().goTo("prepare")
      return
    }
    if (await openService()) useShellStore.getState().openHistory()
  }
  const blocked = !isOpen && dirty

  return (
    <section aria-labelledby="team-changes" className="rounded-lg border border-border bg-card p-4 shadow-panel">
      <h2 id="team-changes" className="mb-1 flex min-w-0 items-baseline gap-2 text-sm font-semibold">
        Team changes
        <span className="min-w-0 truncate text-xs font-normal text-muted-foreground">{service.title}</span>
      </h2>
      <ul className="divide-y divide-border">
        {changes.map((c, k) => (
          <li key={c.kind === "comment" ? `${c.itemId}-${c.at}-${c.by}-${k}` : c.kind}>
            <button
              type="button"
              disabled={blocked}
              title={blocked ? "Save or close the current service first" : c.kind === "comment" ? `Open ${c.reference} in Prepare` : "Open this service's history in Prepare"}
              onClick={() => void go(c)}
              className="flex min-h-11 w-full items-start gap-3 rounded-md px-1 py-2 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 disabled:hover:bg-transparent"
            >
              <span aria-hidden className="mt-0.5 text-muted-foreground [&_svg]:size-4">
                {c.kind === "comment" ? <MessageSquareIcon /> : c.kind === "saved" ? <SaveIcon /> : <BadgeCheckIcon />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{headline(c, me)}</span>
                <span className="block truncate text-xs text-muted-foreground">{detail(c)}</span>
              </span>
              {c.kind === "comment" && c.unread && <span className="mt-0.5 shrink-0 rounded-sm bg-accent px-1.5 text-[0.6875rem] font-semibold text-accent-foreground">New</span>}
              <ChevronRightIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function headline(c: TeamChange, me: string): string {
  const you = (by: string | null) => (by && me.trim() && by.toLowerCase() === commentAuthor(me).toLowerCase() ? "You" : by)
  if (c.kind === "comment") return `${c.by} on ${c.reference}`
  const who = you(c.by)
  if (c.kind === "saved") return who ? `${who} saved version ${c.revision}` : `Version ${c.revision} saved`
  return who ? `${who} approved version ${c.revision}` : `Version ${c.revision} approved`
}

function detail(c: TeamChange): string {
  const at = when(c.at)
  if (c.kind === "comment") return `“${c.text.replace(/\s+/g, " ")}”${at ? ` · ${at}` : ""}`
  if (c.kind === "approved" && c.changedSince) return `${at} · saved again since`
  return at
}
