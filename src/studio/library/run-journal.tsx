import { useDeferredValue, useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import type { JournalEntry } from "@/lib/journal"
import { matchesSearch, searchWords } from "@/lib/settings-search"
import { useBroadcastStore } from "@/stores/broadcast-store"

/**
 * A saved run's whole service log in History (#447: "execution journal, actors/affected outputs"):
 * every entry, not the last hundred, so a rehearsal's opening is still there; outputs by their
 * names; and one filter over the words, the person, the output and the kind. Review only.
 */
export function RunJournal({ entries, timeZone }: { entries: JournalEntry[]; timeZone?: string | null }) {
  const outputs = useBroadcastStore((s) => s.outputs)
  const [query, setQuery] = useState("")
  // Up to 2000 lines: built once per log (one time formatter), filtered behind the typing.
  const rows = useMemo(() => {
    const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", ...(timeZone ? { timeZone } : {}) })
    const outputName = (id: string) => outputs.find((o) => o.id === id)?.name ?? `removed output (${id})`
    return entries.map((entry, index) => ({
      entry,
      index,
      time: time.format(entry.at),
      text: [entry.kind.toUpperCase(), entry.label, entry.outputId ? `· ${outputName(entry.outputId)}` : "", entry.by && !entry.label.includes(entry.by) ? `· by ${entry.by}` : ""].filter(Boolean).join(" "),
    }))
  }, [entries, outputs, timeZone])
  const words = searchWords(useDeferredValue(query))
  const shown = words.length ? rows.filter((row) => matchesSearch(row.text, words)) : rows
  if (entries.length === 0) return <p className="text-muted-foreground">No journal entries were captured.</p>
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter: words, a person, an output or a kind (live, take, source…)" aria-label="Filter this run's log" className="h-7 text-xs" />
        <span className="shrink-0 text-muted-foreground" role="status">{words.length ? `${shown.length} of ${entries.length}` : `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}</span>
      </div>
      {shown.length === 0
        ? <p className="text-muted-foreground">Nothing in this run's log matches.</p>
        : <ol className="max-h-44 list-inside list-decimal overflow-y-auto" aria-label="This run's log">
          {shown.map(({ entry, index, time, text }) => <li key={`${entry.at}:${index}`} value={index + 1} className="truncate" title={text}>
            <span className="text-muted-foreground">{time}</span> · {text}
          </li>)}
        </ol>}
    </div>
  )
}
