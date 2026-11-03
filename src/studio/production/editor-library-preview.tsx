import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { lookupOnHost, useCanSend, useJoin } from "@/stores/join-store"
import { useBibleStore } from "@/stores/bible-store"
import { parseTypedReference } from "@/lib/quick-search"
import { passageFrom, type HostVerse } from "@/lib/desk-console-words"
import type { HostSong } from "@/studio/production/desk-consoles"

interface HostTranslation {
  id: number
  abbreviation: string
  name: string
  language: string
}

const field = "h-8 min-w-0 rounded-md border border-input bg-transparent px-2"

/** Host Library preview and explicit rundown requests for the joined Editor role; neither changes Live. */
export function EditorLibraryPreview() {
  const canSend = useCanSend()
  const books = useBibleStore((state) => state.books)
  const [translations, setTranslations] = useState<HostTranslation[]>([])
  const [translation, setTranslation] = useState<number | null>(null)
  const [scriptureQuery, setScriptureQuery] = useState("")
  const [scriptureResults, setScriptureResults] = useState<HostVerse[] | null>(null)
  const [passage, setPassage] = useState<HostVerse[] | null>(null)
  const [songQuery, setSongQuery] = useState("")
  const [songs, setSongs] = useState<HostSong[] | null>(null)
  const [selectedSong, setSelectedSong] = useState<HostSong | null>(null)
  const [scriptureError, setScriptureError] = useState<string | null>(null)
  const [songError, setSongError] = useState<string | null>(null)
  const [loadingTranslations, setLoadingTranslations] = useState(true)
  const [searchingScripture, setSearchingScripture] = useState(false)
  const [searchingSongs, setSearchingSongs] = useState(false)
  const scriptureRequest = useRef(0)
  const songRequest = useRef(0)
  const queueRequest = useRef(0)
  const [queueing, setQueueing] = useState(false)
  const [queueOutcome, setQueueOutcome] = useState<{ key: string; state: "sending" | "sent" | "error"; message: string } | null>(null)

  useEffect(() => {
    let mounted = true
    void lookupOnHost<{ active: number; translations: HostTranslation[] }>({ what: "translations" }).then((result) => {
      if (!mounted) return
      const list = Array.isArray(result?.translations) ? result.translations : []
      setTranslations(list)
      setTranslation(list.some((item) => item.id === result.active) ? result.active : (list[0]?.id ?? null))
      setScriptureError(list.length ? null : "The host has no Bible translations available.")
    }).catch((error: unknown) => {
      if (mounted) setScriptureError(`Could not load the host's Bible translations: ${String(error)}`)
    }).finally(() => {
      if (mounted) setLoadingTranslations(false)
    })
    return () => { mounted = false }
  }, [])

  useEffect(() => () => {
    scriptureRequest.current++
    songRequest.current++
    queueRequest.current++
  }, [])

  const previewChapter = async (book: number, bookName: string, chapter: number, verse: number) => {
    const request = ++scriptureRequest.current
    songRequest.current++
    setSearchingSongs(false)
    setSearchingScripture(true)
    setScriptureError(null)
    setScriptureResults(null)
    setPassage(null)
    setSelectedSong(null)
    try {
      if (translation === null) throw new Error("Choose a host Bible translation first.")
      const result = await lookupOnHost<{ verses: HostVerse[] }>({ what: "chapter", translation, book, chapter })
      if (request !== scriptureRequest.current) return
      const excerpt = passageFrom(result?.verses ?? [], verse)
      setPassage(excerpt.length ? excerpt : null)
      if (!excerpt.length) setScriptureError(`${bookName} ${chapter}:${verse} is not available in this host translation.`)
    } catch (error) {
      if (request === scriptureRequest.current) setScriptureError(String(error))
    } finally {
      if (request === scriptureRequest.current) setSearchingScripture(false)
    }
  }

  const findScripture = async () => {
    const query = scriptureQuery.trim()
    if (!query || translation === null) return
    const request = ++scriptureRequest.current
    songRequest.current++
    setSearchingSongs(false)
    setSearchingScripture(true)
    setScriptureError(null)
    setScriptureResults(null)
    setPassage(null)
    setSelectedSong(null)
    const reference = parseTypedReference(query, books)
    try {
      if (reference) {
        const result = await lookupOnHost<{ verses: HostVerse[] }>({
          what: "chapter",
          translation,
          book: reference.book.book_number,
          chapter: reference.chapter,
        })
        if (request !== scriptureRequest.current) return
        const excerpt = passageFrom(result?.verses ?? [], reference.verse)
        setPassage(excerpt.length ? excerpt : null)
        if (!excerpt.length) setScriptureError(`${reference.book.name} ${reference.chapter}:${reference.verse} is not available in this host translation.`)
      } else if (/\b\d{1,3}:\d{1,3}\b/.test(query)) {
        setScriptureError("This computer could not match that reference to a Bible book. Check the local book index or search by verse words.")
      } else {
        const result = await lookupOnHost<{ verses: HostVerse[] }>({ what: "search", query, translation })
        if (request !== scriptureRequest.current) return
        const found = Array.isArray(result?.verses) ? result.verses : []
        setScriptureResults(found)
        if (!found.length) setScriptureError(`No matching verses in ${translations.find((item) => item.id === translation)?.abbreviation ?? "this translation"}.`)
      }
    } catch (error) {
      if (request === scriptureRequest.current) setScriptureError(String(error))
    } finally {
      if (request === scriptureRequest.current) setSearchingScripture(false)
    }
  }

  const findSongs = async () => {
    const query = songQuery.trim()
    const request = ++songRequest.current
    scriptureRequest.current++
    setSearchingScripture(false)
    setSearchingSongs(true)
    setSongError(null)
    setSongs(null)
    setSelectedSong(null)
    setPassage(null)
    try {
      const result = await lookupOnHost<{ songs: HostSong[] }>({ what: "songs", query })
      if (request !== songRequest.current) return
      const found = Array.isArray(result?.songs) ? result.songs : []
      setSongs(found)
      if (!found.length) setSongError(query ? `Nothing in the host's song library for “${query}”.` : "The host's song library is empty.")
    } catch (error) {
      if (request === songRequest.current) setSongError(String(error))
    } finally {
      if (request === songRequest.current) setSearchingSongs(false)
    }
  }

  const abbreviation = translations.find((item) => item.id === translation)?.abbreviation
  const queueSelection = passage?.length
    ? { kind: "bible" as const, value: `${passage[0].bookName} ${passage[0].chapter}:${passage[0].verse}`, label: `${passage[0].bookName} ${passage[0].chapter}:${passage[0].verse}` }
    : selectedSong
      ? { kind: "song" as const, value: selectedSong.title, label: selectedSong.title }
      : null
  const queueKey = queueSelection ? `${queueSelection.kind}\u0000${queueSelection.value}` : ""
  const visibleQueueOutcome = queueOutcome?.key === queueKey ? queueOutcome : null
  const previousQueueOutcome = queueOutcome && queueOutcome.key !== queueKey ? queueOutcome : null

  const requestRundown = async () => {
    if (!queueSelection) return
    if (!canSend) {
      setQueueOutcome({ key: queueKey, state: "error", message: "The host is not currently accepting actions from this desk." })
      return
    }
    const request = ++queueRequest.current
    const selected = queueSelection
    const key = queueKey
    setQueueing(true)
    setQueueOutcome({ key, state: "sending", message: `Sending a request for ${selected.label} to the host…` })
    try {
      const result = await useJoin.getState().send({ command: "queue_request", value: { kind: selected.kind, value: selected.value } })
      if (request !== queueRequest.current) return
      if (result.ok) {
        setQueueOutcome({ key, state: "sent", message: `Request sent for ${selected.label}. Check the host rundown; nothing changed on a screen.` })
      } else {
        setQueueOutcome({ key, state: "error", message: result.error })
      }
    } catch (error) {
      if (request === queueRequest.current) setQueueOutcome({ key, state: "error", message: String(error) })
    } finally {
      if (request === queueRequest.current) setQueueing(false)
    }
  }

  return (
    <section aria-label="Prepare desk" className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div>
        <h2 className="font-semibold">Prepare from the host Library</h2>
        <p className="mt-1 text-sm text-muted-foreground">Find Scripture and songs, then inspect them in this private text preview. Searching and selecting never changes the service, host Preview, Program, or outputs.</p>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <section aria-label="Host Bible Library" className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-2.5">
          <h3 className="font-semibold">Scripture</h3>
          <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void findScripture() }}>
            <input aria-label="Editor Scripture reference or words" value={scriptureQuery} onChange={(event) => setScriptureQuery(event.currentTarget.value)} placeholder="Romans 8:28 or words to find" maxLength={120} className={`${field} min-w-40 flex-1`} />
            <select aria-label="Editor Bible translation" value={translation ?? ""} disabled={loadingTranslations || !translations.length} onChange={(event) => { scriptureRequest.current++; setSearchingScripture(false); setTranslation(Number(event.currentTarget.value)); setScriptureResults(null); setPassage(null); setScriptureError(null) }} className="h-8 max-w-48 rounded-md border border-input bg-card px-1.5">
              {loadingTranslations && <option value="">Loading host editions…</option>}
              {!loadingTranslations && translations.length === 0 && <option value="">No host editions</option>}
              {translations.map((item) => <option key={item.id} value={item.id}>{item.abbreviation} · {item.name}</option>)}
            </select>
            <Button size="sm" type="submit" variant="outline" aria-label="Find in host Bible" disabled={!scriptureQuery.trim() || translation === null || searchingScripture}>{searchingScripture ? "Searching…" : "Find"}</Button>
          </form>
          {scriptureError && <p role="alert" className="text-sm text-destructive">{scriptureError}</p>}
          {scriptureResults && scriptureResults.length > 0 && (
            <ul aria-label="Editor Scripture results" className="flex max-h-52 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border">
              {scriptureResults.map((verse) => (
                <li key={`${verse.book}-${verse.chapter}-${verse.verse}`}>
                  <button type="button" className="w-full px-2 py-1.5 text-left hover:bg-muted" onClick={() => void previewChapter(verse.book, verse.bookName, verse.chapter, verse.verse)}>
                    <b>{verse.bookName} {verse.chapter}:{verse.verse}</b> <span className="text-muted-foreground">{verse.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Host song Library" className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-2.5">
          <h3 className="font-semibold">Songs and hymns</h3>
          <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void findSongs() }}>
            <input aria-label="Editor song title, words or hymn number" value={songQuery} onChange={(event) => setSongQuery(event.currentTarget.value)} placeholder="Title, words or hymn number" maxLength={120} className={`${field} flex-1`} />
            <Button size="sm" type="submit" variant="outline" aria-label="Find in host songs" disabled={searchingSongs}>{searchingSongs ? "Searching…" : "Find"}</Button>
          </form>
          {songError && <p role="alert" className="text-sm text-destructive">{songError}</p>}
          {songs && songs.length > 0 && (
            <ul aria-label="Editor song results" className="flex max-h-52 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border">
              {songs.map((song) => (
                <li key={song.id}>
                  <button type="button" aria-pressed={selectedSong?.id === song.id} className="w-full px-2 py-1.5 text-left hover:bg-muted aria-pressed:bg-primary/10" onClick={() => { scriptureRequest.current++; setSearchingScripture(false); setSelectedSong(song); setPassage(null) }}>
                    <b>{song.title}</b>{song.numbers.length > 0 && <span className="text-muted-foreground"> · {song.numbers.join(", ")}</span>}{song.firstLine && <span className="block text-muted-foreground">{song.firstLine}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {(passage || selectedSong) && (
        <section aria-label="Editor private preview" className="rounded-md border border-primary/30 bg-primary/5 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-primary-text">Private Library preview · not on a screen</p>
          {passage && <div className="mt-2" aria-label="Selected Scripture preview"><h3 className="font-semibold">{passage[0]?.bookName} {passage[0]?.chapter}:{passage[0]?.verse} · {abbreviation}</h3>{passage.map((verse) => <p key={verse.verse} className="mt-1"><sup className="mr-1 tabular-nums">{verse.verse}</sup>{verse.text}</p>)}</div>}
          {selectedSong && <div className="mt-2" aria-label="Selected song preview"><h3 className="font-semibold">{selectedSong.title}</h3>{selectedSong.numbers.length > 0 && <p className="text-sm text-muted-foreground">{selectedSong.numbers.join(", ")}</p>}{selectedSong.firstLine && <p className="mt-1">{selectedSong.firstLine}</p>}<p className="mt-2 text-xs text-muted-foreground">The host lookup supplies this song summary. Full arrangement preview and service draft submission are not part of this joined Editor view yet.</p></div>}
          {queueSelection && <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" aria-label={`Request ${queueSelection.label} in host rundown`} disabled={!canSend || queueing || visibleQueueOutcome?.state === "sent"} onClick={() => void requestRundown()}>
              {queueing ? "Sending request…" : visibleQueueOutcome?.state === "sent" ? "Request sent" : `Request ${queueSelection.kind === "bible" ? "Scripture" : "song"} in host rundown`}
            </Button>
            {!canSend && <p role="status" className="text-xs text-muted-foreground">The host is not currently accepting actions from this desk.</p>}
            {visibleQueueOutcome && <p aria-label="Editor add-to-rundown result" role={visibleQueueOutcome.state === "error" ? "alert" : "status"} aria-live="polite" className="text-xs text-muted-foreground">{visibleQueueOutcome.message}</p>}
            <p className="basis-full text-xs text-muted-foreground">This sends a request for the host rundown. The host checks the item; nothing is sent to a screen.</p>
          </div>}
        </section>
      )}
      {previousQueueOutcome && <p aria-label="Editor add-to-rundown result" role={previousQueueOutcome.state === "error" ? "alert" : "status"} aria-live="polite" className="text-sm text-muted-foreground">{previousQueueOutcome.message}</p>}
    </section>
  )
}
