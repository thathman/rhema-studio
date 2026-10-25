import { useEffect, useState } from "react"
import { CheckIcon, InfoIcon, TriangleAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { activatedLabel } from "@/lib/live-sources"
import { parseTypedReference } from "@/lib/quick-search"
import { roleLabel } from "@/lib/remote-roles"
import type { LiveStateV1 } from "@/lib/live-state"
import type { SharedReadiness } from "@/lib/desk-consoles"
import { useBibleStore } from "@/stores/bible-store"
import { lookupOnHost, useCanSend, useJoin, type SendResult } from "@/stores/join-store"
import { crewWords, passageFrom, type CrewRow, type HostVerse } from "@/lib/desk-console-words"

/**
 * The desk consoles on a joined computer (#197 P1): Bible (search the host's Bible by reference or
 * words, in a translation chosen here, preview the passage here, activate it; the verses Auto Bible
 * heard there, one click each), Worship (the host's songs and hymns, the song on the screens section
 * by section), Screens (the output map) and the director's board (readiness and who is connected).
 * Every look-up is read only; every command is checked by the host for this desk's role.
 */

const box = "flex flex-col gap-2 rounded-md border border-border p-2.5"
const field = "h-8 min-w-0 rounded-md border border-input bg-transparent px-2"

function Said({ result }: { result: SendResult | null }) {
  if (!result) return null
  if (result.ok) return result.note ? <p role="status" className="font-semibold text-confidence-mid">{result.note}.</p> : null
  return <p role="alert" className="text-destructive">{result.error}</p>
}

interface HostTranslation { id: number; abbreviation: string; name: string; language: string }
/** A passage to preview here: the verse asked for and the two after it, in the chosen translation. */
interface Passage { reference: string; verse: number; verses: HostVerse[] }

/** The Bible desk: search, translation, preview here, Activate; next and previous verse; heard verses. */
export function BibleConsole({ live }: { live: LiveStateV1 }) {
  const ok = useCanSend()
  const books = useBibleStore((s) => s.books)
  const [translations, setTranslations] = useState<HostTranslation[] | null>(null)
  const [translation, setTranslation] = useState<number | null>(null)
  const [text, setText] = useState("")
  const [found, setFound] = useState<HostVerse[] | null>(null)
  const [passage, setPassage] = useState<Passage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SendResult | null>(null)
  const bible = live.sources.find((s) => s.id === "bible")
  useEffect(() => {
    let alive = true
    lookupOnHost<{ active: number; translations: HostTranslation[] }>({ what: "translations" }).then(
      (r) => {
        if (!alive) return
        const list = Array.isArray(r?.translations) ? r.translations : []
        setTranslations(list)
        setTranslation(list.some((t) => t.id === r.active) ? r.active : (list[0]?.id ?? null))
      },
      (e) => alive && setError(String(e)),
    )
    return () => { alive = false }
  }, [])
  const abbreviation = translations?.find((t) => t.id === translation)?.abbreviation
  const preview = async (book: number, bookName: string, chapter: number, verse: number) => {
    if (translation === null) return
    try {
      const r = await lookupOnHost<{ verses: HostVerse[] }>({ what: "chapter", translation, book, chapter })
      const verses = passageFrom(r?.verses ?? [], verse)
      setError(verses.length ? null : `${bookName} ${chapter}:${verse} is not in ${abbreviation ?? "this translation"} on the host`)
      setPassage(verses.length ? { reference: `${bookName} ${chapter}:${verse}`, verse, verses } : null)
    } catch (e) {
      setError(String(e))
    }
  }
  const look = async () => {
    const q = text.trim()
    if (!q || translation === null) return
    setResult(null)
    const ref = parseTypedReference(q, books)
    if (ref) {
      setFound(null)
      return preview(ref.book.book_number, ref.book.name, ref.chapter, ref.verse)
    }
    try {
      const r = await lookupOnHost<{ verses: HostVerse[] }>({ what: "search", query: q, translation })
      const verses = r?.verses ?? []
      setFound(verses)
      setError(verses.length ? null : `No verse with “${q}” in ${abbreviation ?? "this translation"}`)
    } catch (e) {
      setError(String(e))
    }
  }
  const send = async (command: { command: string; value?: string | Record<string, unknown> }) => setResult(await useJoin.getState().send(command))
  const activate = (reference: string) => void send({ command: "bible_activate", value: abbreviation ? { reference, translation: abbreviation } : reference })
  return (
    <section aria-label="Bible desk" className={box}>
      <p className="font-semibold">Bible {bible ? <span className="font-normal text-muted-foreground">· {[bible.reference, activatedLabel(bible)].filter(Boolean).join(" · ")}{bible.on ? "" : " (off)"}</span> : <span className="font-normal text-muted-foreground">· nothing yet</span>}</p>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void look() }}>
        <input aria-label="Reference or words" value={text} onChange={(e) => setText(e.target.value)} placeholder="Romans 8:28, or words: “all things work together”" maxLength={120} className={cn(field, "min-w-48 flex-1")} />
        <select aria-label="Translation" value={translation ?? ""} disabled={!translations?.length} onChange={(e) => { setTranslation(Number(e.target.value)); setPassage(null); setFound(null) }} className="h-8 rounded-md border border-input bg-card px-1.5">
          {translations === null && <option value="">Translations…</option>}
          {translations?.map((t) => <option key={t.id} value={t.id}>{t.abbreviation} · {t.name}</option>)}
        </select>
        <Button size="sm" type="submit" variant="outline" disabled={!text.trim() || translation === null}>Find</Button>
      </form>
      {error && <p role="status" className="text-muted-foreground">{error}</p>}
      {found && found.length > 0 && (
        <ul aria-label="Verses found" className="flex max-h-48 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border">
          {found.map((v) => (
            <li key={`${v.book}-${v.chapter}-${v.verse}`}>
              <button type="button" className="w-full px-2 py-1 text-left hover:bg-muted" onClick={() => void preview(v.book, v.bookName, v.chapter, v.verse)}>
                <b>{v.bookName} {v.chapter}:{v.verse}</b> <span className="text-muted-foreground">{v.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {passage && (
        <div role="group" aria-label="Preview on this desk" className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/40 p-2">
          <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Preview here only · {passage.reference} {abbreviation}</p>
          {passage.verses.map((v) => <p key={v.verse} className={cn(v.verse !== passage.verse && "text-muted-foreground")}><sup className="mr-1 tabular-nums">{v.verse}</sup>{v.text}</p>)}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!ok} onClick={() => activate(passage.reference)}>Activate {passage.reference}</Button>
            <Button size="sm" variant="outline" disabled={!ok} title="Into the main desk's Preview only: nothing goes live" onClick={() => void send({ command: "bible_preview", value: passage.reference })}>Main desk's Preview</Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!ok} onClick={() => void send({ command: "verse_prev" })}>Previous verse</Button>
        <Button size="sm" variant="outline" disabled={!ok} onClick={() => void send({ command: "verse_next" })}>Next verse</Button>
        {bible?.on ? <Button size="sm" variant="ghost" disabled={!ok} onClick={() => void send({ command: "clear_source", value: "bible" })}>Take the Bible off</Button> : bible ? <Button size="sm" variant="ghost" disabled={!ok} onClick={() => void send({ command: "restore_source", value: "bible" })}>Restore the Bible</Button> : null}
      </div>
      {live.heard && (
        <div className="flex flex-col gap-1" role="group" aria-label="Heard at the host">
          <p className="font-semibold">Heard <span className="font-normal text-muted-foreground">· Auto Bible on the host; nothing goes up until you Activate it</span></p>
          {live.heard.length === 0 && <p className="text-muted-foreground">No verse heard yet.</p>}
          <ul className="flex flex-col gap-1">
            {live.heard.map((h) => (
              <li key={h.reference} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate"><b>{h.reference}</b> <span className="text-muted-foreground">{h.text}</span></span>
                <span className="text-muted-foreground tabular-nums" title={h.source === "direct" ? "Said as a reference" : "Matched by meaning"}>{Math.round(h.confidence * 100)}%</span>
                <Button size="xs" disabled={!ok} onClick={() => activate(h.reference)}>Activate</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Said result={result} />
      <p className="text-muted-foreground">The verse reaches every feed that follows Bible; the main screens show it too unless a song, hymn or slide is up there.</p>
    </section>
  )
}

interface HostSong { id: string; title: string; numbers: string[]; firstLine: string; hymn: boolean }

/** The host's songs and hymns (title, words or hymn number), each to Show or to the main desk's Preview. */
export function SongLibrary({ onSend }: { onSend: (command: { command: string; value: string }) => void }) {
  const ok = useCanSend()
  const [query, setQuery] = useState("")
  const [songs, setSongs] = useState<HostSong[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const look = async () => {
    try {
      const r = await lookupOnHost<{ songs: HostSong[] }>({ what: "songs", query: query.trim() })
      const list = r?.songs ?? []
      setSongs(list)
      setError(list.length ? null : `Nothing in the host's library for “${query.trim()}”`)
    } catch (e) {
      setError(String(e))
    }
  }
  return (
    <div className="flex flex-col gap-2" role="group" aria-label="The host's songs and hymns">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void look() }}>
        <input aria-label="Song title, words or hymn number" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title, words or hymn number (CAC 245)" maxLength={120} className={cn(field, "flex-1")} />
        <Button size="sm" type="submit" variant="outline">Find</Button>
      </form>
      {error && <p role="status" className="text-muted-foreground">{error}</p>}
      {songs && songs.length > 0 && (
        <ul aria-label="Songs found" className="flex max-h-56 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border">
          {songs.map((s) => (
            <li key={s.id} className="flex items-center gap-2 px-2 py-1">
              <span className="min-w-0 flex-1 truncate"><b>{s.title}</b>{s.numbers.length > 0 && <span className="text-muted-foreground"> · {s.numbers.join(", ")}</span>}{s.firstLine && <span className="text-muted-foreground"> · {s.firstLine}</span>}</span>
              <Button size="xs" disabled={!ok} onClick={() => onSend({ command: "song_show", value: s.title })}>Show</Button>
              <Button size="xs" variant="outline" disabled={!ok} title="Into the main desk's Preview only: nothing goes live" onClick={() => onSend({ command: "song_preview", value: s.title })}>Preview</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The song or hymn on the screens, section by section: never on to the next item of the service.
 * Repeat chorus goes back to the chorus (the last one sung, else the first), when the host says
 * which sections are a chorus.
 */
export function SectionStepper({ live, onSend }: { live: LiveStateV1; onSend: (command: { command: string; value: number | string }) => void }) {
  const ok = useCanSend()
  const l = live.lyrics
  if (l === undefined) return null
  if (!l) return <p className="text-muted-foreground">No song or hymn on the screens: show one to step through its sections.</p>
  const choruses = l.choruses
  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label="Sections of the song on the screens">
      <p><span className="font-semibold">{l.title}</span>{l.key && <span className="ml-1.5 rounded-sm bg-muted px-1.5 py-0.5 text-[0.6875rem] font-semibold" title="The song's key, for the band">Key {l.key}</span>} <span className="text-muted-foreground">· {l.sections[l.section] ?? ""} ({l.section + 1} of {l.sections.length}){live.program.rehearsal ? " · rehearsal" : ""}</span></p>
      <ol className="flex flex-wrap gap-1">
        {l.sections.map((label, i) => <li key={i} className={cn("rounded-sm px-1.5 py-0.5 text-[0.6875rem]", i === l.section ? "bg-primary/10 font-semibold text-primary-text" : "bg-muted text-muted-foreground")}>{label}</li>)}
      </ol>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={!ok || l.section === 0} onClick={() => onSend({ command: "song_section", value: -1 })}>Previous section</Button>
        <Button size="sm" disabled={!ok || l.section >= l.sections.length - 1} onClick={() => onSend({ command: "song_section", value: 1 })}>Next section</Button>
        {choruses && <Button size="sm" variant="outline" disabled={!ok || choruses.length === 0} title={choruses.length ? "Back to the chorus on the screens" : "This song has no chorus"} onClick={() => onSend({ command: "song_section", value: "chorus" })}>Repeat chorus</Button>}
      </div>
    </div>
  )
}

const KIND = { display: "Screen", ndi: "NDI", browser: "Browser feed" } as const
const ROLE = { congregation: "Congregation", stage: "Stage", signage: "Signage" } as const

/**
 * Which output shows which scene, on or off, as the host's real screens have them, and who took a
 * scene to it last (read only).
 */
export function OutputMap({ live }: { live: LiveStateV1 }) {
  if (!live.outputMap) return null
  return (
    <div role="group" aria-label="Output map" className="flex flex-col gap-1">
      <p className="font-semibold">Output map <span className="font-normal text-muted-foreground">· read only</span></p>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {live.outputMap.length === 0 && <li className="px-2 py-1.5 text-muted-foreground">The host has no outputs.</li>}
        {live.outputMap.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-2 px-2 py-1">
            <span className={cn("size-2 shrink-0 rounded-full", o.on ? "bg-primary" : "bg-muted-foreground/40")} aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium">{o.name}</span>
            <span className="text-muted-foreground">{ROLE[o.role]} · {KIND[o.kind]}</span>
            <span>{o.role === "congregation" ? (o.scene ?? "its own feed") : o.role === "stage" ? "stage display" : "signage loop"}</span>
            {o.at !== undefined && <span className="text-muted-foreground" title="Who took a scene to it, or sent it back to its own feed, last">{activatedLabel({ by: o.by, activatedAt: o.at }) || "taken"}</span>}
            <span className={cn("text-[0.625rem] font-bold uppercase", o.on ? "text-primary-text" : "text-muted-foreground")}>{o.on ? "On" : "Off"}</span>
            {(o.signal ?? []).length > 0 && (
              <ul aria-label={`Cameras on ${o.name}`} className="w-full pl-4 text-muted-foreground">
                {o.signal!.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The sources a Screens desk takes off its screens and back (#197): the ticker and the lower third. */
const SCREEN_SOURCES = [["ticker", "Ticker"], ["lowerThird", "Lower third"]] as const

/** The ticker and the lower third on the host's screens: what each shows, Take off or Put back. */
export function ScreenSources({ live }: { live: LiveStateV1 }) {
  const ok = useCanSend()
  const [result, setResult] = useState<SendResult | null>(null)
  const rows = SCREEN_SOURCES.flatMap(([id, name]) => { const s = live.sources.find((x) => x.id === id); return s ? [{ s, name }] : [] })
  if (rows.length === 0) return null
  return (
    <div role="group" aria-label="Ticker and lower third" className="flex flex-col gap-1">
      <p className="font-semibold">Ticker and lower third</p>
      <ul className="flex flex-col gap-1">
        {rows.map(({ s, name }) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{name} · {s.on ? "on" : "off"}{s.reference ? <span className="text-muted-foreground"> · {s.reference}</span> : null}{activatedLabel(s) ? <span className="text-muted-foreground"> · {activatedLabel(s)}</span> : null}</span>
            <Button size="xs" variant="outline" disabled={!ok} onClick={async () => setResult(await useJoin.getState().send({ command: s.on ? "clear_source" : "restore_source", value: s.id }))}>{s.on ? "Take off" : "Put back"}</Button>
          </li>
        ))}
      </ul>
      <Said result={result} />
    </div>
  )
}

const ICON = {
  ok: <CheckIcon aria-label="Fine" className="size-3.5 shrink-0 text-confidence-high" />,
  warn: <TriangleAlertIcon aria-label="Check" className="size-3.5 shrink-0 text-confidence-mid" />,
  info: <InfoIcon aria-label="Note" className="size-3.5 shrink-0 text-muted-foreground" />,
}

/**
 * The director's board (#197 Director console): the service's readiness checks and who of the
 * team is connected. On the main desk from this computer; on a joined Present or settings desk
 * from the host's Live State. Read only.
 */
export function DirectorBoard({ readiness, crew }: { readiness: SharedReadiness | null | undefined; crew: CrewRow[] | undefined }) {
  // "Seen 4 min ago" moves on by itself, twice a minute.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const warn = readiness?.checks.filter((c) => c.status === "warn").length ?? 0
  return (
    <section aria-label="Director's board" className={box}>
      <p className="font-semibold">Director <span className="font-normal text-muted-foreground">· readiness and the team</span></p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <p className={cn("font-semibold", readiness ? (readiness.ready ? "text-confidence-high" : "text-confidence-mid") : "text-muted-foreground")}>
            {!readiness ? "The host has not shared its checks (it may be an older Rhema Studio)" : readiness.ready ? "Ready" : `${warn} to check`}
          </p>
          {readiness && (
            <ul aria-label="Readiness checks" className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {readiness.checks.map((c) => (
                <li key={c.id} className="flex items-start gap-1.5">
                  {ICON[c.status]}
                  <span className="min-w-0"><span className={cn(c.status === "warn" && "font-semibold")}>{c.label}</span>{c.detail && <span className="block text-muted-foreground">{c.detail}</span>}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-semibold">Team <span className="font-normal text-muted-foreground">· {crew ? `${crew.filter((c) => c.connected).length} of ${crew.length} connected` : "not shared by the host"}</span></p>
          {crew && (
            <ul aria-label="Who is connected" className="flex flex-col divide-y divide-border rounded-md border border-border">
              {crew.length === 0 && <li className="px-2 py-1.5 text-muted-foreground">No one paired yet.</li>}
              {crew.map((c) => (
                <li key={c.name} className="flex items-center gap-2 px-2 py-1">
                  <span className={cn("size-2 shrink-0 rounded-full", c.connected ? "bg-primary" : "bg-muted-foreground/40")} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="text-muted-foreground">{roleLabel(c.role)}</span>
                  {c.paused && <span className="rounded-full bg-muted px-1.5 text-[0.625rem] font-bold text-muted-foreground uppercase">Paused</span>}
                  <span className={cn("text-[0.6875rem]", c.connected ? "text-primary-text" : "text-muted-foreground")}>{crewWords(c, now)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
