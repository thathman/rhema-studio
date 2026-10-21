import { useUnsavedStore } from "@/stores/unsaved-store"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { ArrowDownIcon, ArrowUpIcon, DownloadIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react"
import { exportOpenLyricsToFile, exportSongTextToFile } from "@/lib/song-files"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useSongStore } from "@/stores/song-store"
import { useMediaStore } from "@/stores/media-store"
import { invoke } from "@tauri-apps/api/core"
import { openPath } from "@tauri-apps/plugin-opener"
import { isContentCommandError, LICENCES, SECTION_KINDS } from "@/types/content"
import type { Licence, MediaAsset, SectionKind, SongWithSections } from "@/types"
import {
  addArrangement, addSection, applyPaste, emptyForm, formFromSong, formLanguages, inputFromForm, moveSection,
  removeArrangement, removeSection, updateArrangement, validateForm, type SongForm,
} from "@/lib/song-form"
import { ArrangementStrip } from "@/studio/prepare/arrangement-strip"

const LANGUAGES: Array<[string, string]> = [["en", "English"], ["yo", "Yorùbá"]]
const LICENCE_LABEL: Record<Licence, string> = { public_domain: "Public domain", ccli: "CCLI", custom: "Custom permission", unknown: "Unknown" }
const KIND_LABEL: Record<SectionKind, string> = {
  verse: "Verse", chorus: "Chorus", bridge: "Bridge", prechorus: "Pre-chorus", tag: "Tag", ending: "Ending", intro: "Intro", other: "Other",
}
const langName = (tag: string) => LANGUAGES.find(([t]) => t === tag)?.[1] ?? tag.toUpperCase()

/**
 * Paste-first song editor. A new song starts with one big box for the words;
 * sections appear as cards the volunteer can relabel. Saving goes through the
 * content database with revision checks; nothing here can present.
 */
export function SongEditor({
  songId,
  open,
  onClose,
  onSaved,
}: {
  /** null = new song */
  songId: string | null
  open: boolean
  onClose: () => void
  onSaved?: (song: SongWithSections) => void
}) {
  // Remount per open so every field starts fresh for the song being edited.
  return open ? <EditorDialog key={songId ?? "new"} songId={songId} onClose={onClose} onSaved={onSaved} /> : null
}

function EditorDialog({
  songId,
  onClose,
  onSaved,
}: {
  songId: string | null
  onClose: () => void
  onSaved?: (song: SongWithSections) => void
}) {
  const [form, setForm] = useState<SongForm>(() => emptyForm())
  const [initial, setInitial] = useState(() => JSON.stringify(emptyForm()))
  const [revision, setRevision] = useState<number | null>(null)
  const [loading, setLoading] = useState(!!songId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paste, setPaste] = useState("")
  const [pasteLang, setPasteLang] = useState("en")
  const [secondLang, setSecondLang] = useState<string | null>(null)
  const [arrangementId, setArrangementId] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)

  // Hymnbooks for the number rows; the song itself when editing.
  useEffect(() => {
    void useSongStore.getState().loadHymnbooks().catch(() => {})
    if (!songId) return
    let cancelled = false
    useSongStore
      .getState()
      .load(songId, { refresh: true })
      .then((song) => {
        if (cancelled) return
        if (!song) {
          setError("This song is no longer in the library.")
          return
        }
        const f = formFromSong(song)
        setForm(f)
        setInitial(JSON.stringify(f))
        setRevision(song.song.revision)
        setPasteLang(f.primary_language)
        setSecondLang(formLanguages(f)[1] ?? null)
        setArrangementId(f.arrangements.find((a) => a.is_default)?.id ?? f.arrangements[0]?.id ?? null)
      })
      .catch((e: unknown) => { if (!cancelled) setError(describe(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [songId])

  const dirty = JSON.stringify(form) !== initial
  // The close question knows about this song while its changes are unsaved.
  const unsavedTitle = dirty ? form.title.trim() || "Untitled song" : null
  useEffect(() => {
    useUnsavedStore.getState().setSongEditor(unsavedTitle)
  }, [unsavedTitle])
  useEffect(() => () => useUnsavedStore.getState().setSongEditor(null), [])
  const [conflicted, setConflicted] = useState(false)
  // A save conflict: keep these edits as a new song rather than lose them (RG-05).
  const saveAsNew = async () => {
    setSaving(true)
    try {
      const saved = await useSongStore.getState().create({ ...inputFromForm(form), title: `${form.title.trim() || "Untitled song"} (my version)` })
      toast.success(`${saved.song.title} saved as a new song`)
      onSaved?.(saved)
      onClose()
    } catch (e) {
      setError(describe(e))
    } finally {
      setSaving(false)
    }
  }
  const problems = useMemo(() => validateForm(form), [form])
  const primary = form.primary_language
  const arrangement = form.arrangements.find((a) => a.id === arrangementId) ?? form.arrangements[0] ?? null

  const requestClose = () => {
    if (dirty && !saving) setConfirmClose(true)
    else onClose()
  }

  const save = async () => {
    if (problems.length > 0 || saving) return
    setSaving(true)
    setError(null)
    try {
      const store = useSongStore.getState()
      const input = inputFromForm(form)
      const saved = songId && revision !== null ? await store.update(songId, revision, input) : await store.create(input)
      toast.success(`${saved.song.title} saved`)
      onSaved?.(saved)
      onClose()
    } catch (e) {
      if (isContentCommandError(e) && e.kind === "conflict") {
        setConflicted(true)
        setError("Someone else saved this song since you opened it. Your edits here are not saved: keep them as a new song, or close and reopen to see their changes.")
      } else {
        setError(describe(e))
      }
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!songId || revision === null) return
    try {
      await useSongStore.getState().remove(songId, revision)
      toast.success("Song deleted")
      onClose()
    } catch (e) {
      if (isContentCommandError(e) && e.kind === "in_use") {
        setError(`This song is used in: ${(e.titles ?? []).join(", ")}. Remove it from those services first.`)
      } else {
        setError(describe(e))
      }
    }
  }

  const set = (patch: Partial<SongForm>) => setForm((f) => ({ ...f, ...patch }))
  const exportOne = async (as: "openlyrics" | "text" = "openlyrics") => {
    const song = songId ? useSongStore.getState().songs[songId] : undefined
    if (!song) return
    try {
      const path = as === "text" ? await exportSongTextToFile(song) : await exportOpenLyricsToFile(song)
      if (path) toast.success(`Saved to ${path}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) requestClose() }}>
      <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-[64rem] flex-col gap-0 p-0 sm:max-w-[64rem]" showCloseButton={false}>
        <DialogHeader className="border-b border-border px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <DialogTitle>{songId ? "Edit song" : "New song"}</DialogTitle>
              <DialogDescription>Words, sections and the order they are sung in. Nothing here goes live.</DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              {songId && (
                <Button variant="ghost" size="sm" disabled={dirty || loading} title={dirty ? "Save first; the file is made from the saved song" : "Save this song as an OpenLyrics .xml for OpenLP"} onClick={() => void exportOne()}>
                  <DownloadIcon /> OpenLyrics…
                </Button>
              )}
              {songId && (
                <Button variant="ghost" size="sm" disabled={dirty || loading} title={dirty ? "Save first; the file is made from the saved song" : "Save this song as text (Markdown) to print, share or paste back in"} onClick={() => void exportOne("text")}>
                  <DownloadIcon /> Text…
                </Button>
              )}
              {songId && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-destructive"><Trash2Icon /> Delete</Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-64">
                    <p className="mb-3 text-sm">Delete “{form.title || "this song"}” from the library? Services that use it keep you from deleting it.</p>
                    <div className="flex justify-end gap-2">
                      <Button variant="destructive" size="sm" onClick={() => void remove()}>Delete</Button>
                    </div>
                  </PopoverContent>
                </Popover>
              )}
              <Popover open={confirmClose} onOpenChange={setConfirmClose}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" onClick={requestClose}><XIcon /> Close</Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64">
                  <p className="mb-3 text-sm">Discard your unsaved changes?</p>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setConfirmClose(false)}>Keep editing</Button>
                    <Button variant="destructive" size="sm" onClick={() => { setConfirmClose(false); onClose() }}>Discard</Button>
                  </div>
                </PopoverContent>
              </Popover>
              <Button size="sm" disabled={problems.length > 0 || saving || loading || (!dirty && !!songId)} onClick={() => void save()} title={problems[0]}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[18rem_minmax(0,1fr)] gap-0 overflow-hidden max-[900px]:grid-cols-1">
          {/* Metadata */}
          <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-r border-border p-4 text-sm">
            <Field label="Title">
              <Input value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Amazing Grace" autoFocus={!songId} />
            </Field>
            <Field label="Authors" hint="Separate with semicolons">
              <Input value={form.authors} onChange={(e) => set({ authors: e.target.value })} placeholder="John Newton" />
            </Field>
            <Field label="Main language">
              <Select value={primary} onValueChange={(v) => set({ primary_language: v })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{LANGUAGES.map(([t, n]) => <SelectItem key={t} value={t}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <HymnNumbers form={form} set={set} />
            {songId && <Attachments songId={songId} />}
            <Field label="Copyright" hint="As printed in the hymnal">
              <Input value={form.copyright} onChange={(e) => set({ copyright: e.target.value })} />
            </Field>
            <Field label="Licence">
              <Select value={form.licence} onValueChange={(v) => set({ licence: v as Licence })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{LICENCES.map((l) => <SelectItem key={l} value={l}>{LICENCE_LABEL[l]}</SelectItem>)}</SelectContent>
              </Select>
              {form.licence === "unknown" && <p className="mt-1 text-xs text-muted-foreground">Fine to leave for now. Home will remind you which songs still need a licence.</p>}
            </Field>
            {form.licence === "ccli" && (
              <Field label="CCLI song number">
                <Input value={form.ccli_number} onChange={(e) => set({ ccli_number: e.target.value })} inputMode="numeric" placeholder="22324" />
              </Field>
            )}
            {form.licence !== "public_domain" && (
              <Field label="Licence note" hint="Shown under the words on screen">
                <Input value={form.licence_note} onChange={(e) => set({ licence_note: e.target.value })} placeholder="Used by permission, CCLI licence 123456" />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Field label="Key" hint="For the band">
                <Input value={form.key} onChange={(e) => set({ key: e.target.value })} placeholder="G" maxLength={12} />
              </Field>
              <Field label="Tempo (bpm)">
                <Input value={form.tempo} onChange={(e) => set({ tempo: e.target.value })} inputMode="numeric" placeholder="72" />
              </Field>
            </div>
            <Field label="Notes" hint="For the team, never on screen">
              <Textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} />
            </Field>
          </aside>

          {/* Words */}
          <section className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
            {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p>}
            {conflicted && <Button variant="outline" size="sm" className="w-fit" disabled={saving} onClick={() => void saveAsNew()}>Save mine as a new song</Button>}

            {form.sections.length === 0 ? (
              <PasteBox paste={paste} setPaste={setPaste} lang={pasteLang} setLang={setPasteLang} onApply={() => { set(applyPaste(form, paste, pasteLang)); setPaste("") }} big />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">Sections</h3>
                  <span className="text-xs text-muted-foreground">{form.sections.length}</span>
                  <span className="ml-auto flex items-center gap-2">
                    {!secondLang ? (
                      <Button variant="outline" size="sm" onClick={() => setSecondLang(primary === "yo" ? "en" : "yo")}>
                        <PlusIcon /> Add {langName(primary === "yo" ? "en" : "yo")} words
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">{langName(primary)} · {langName(secondLang)}</span>
                    )}
                    <Button variant="outline" size="sm" onClick={() => set(addSection(form))}><PlusIcon /> Section</Button>
                  </span>
                </div>
                <ol className="flex flex-col gap-3">
                  {form.sections.map((s, i) => (
                    <li key={s.id} className="rounded-lg border border-border bg-card p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <Select value={s.kind} onValueChange={(v) => set({ sections: form.sections.map((x) => (x.id === s.id ? { ...x, kind: v as SectionKind, label: "" } : x)) })}>
                          <SelectTrigger className="h-7 w-32 text-xs" aria-label="Section type"><SelectValue /></SelectTrigger>
                          <SelectContent>{SECTION_KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}</SelectContent>
                        </Select>
                        <Input
                          value={s.label}
                          aria-label="Section label"
                          onChange={(e) => set({ sections: form.sections.map((x) => (x.id === s.id ? { ...x, label: e.target.value } : x)) })}
                          onBlur={() => { if (!s.label.trim()) set({ sections: form.sections.map((x) => (x.id === s.id ? { ...x, label: "" } : x)) }) }}
                          className="h-7 w-36 text-xs"
                        />
                        <span className="ml-auto flex items-center">
                          <Button variant="ghost" size="icon-xs" aria-label="Move section up" disabled={i === 0} onClick={() => set(moveSection(form, i, i - 1))}><ArrowUpIcon /></Button>
                          <Button variant="ghost" size="icon-xs" aria-label="Move section down" disabled={i === form.sections.length - 1} onClick={() => set(moveSection(form, i, i + 1))}><ArrowDownIcon /></Button>
                          <Button variant="ghost" size="icon-xs" aria-label={`Remove ${s.label}`} onClick={() => set(removeSection(form, s.id))}><XIcon /></Button>
                        </span>
                      </div>
                      <div className={secondLang ? "grid grid-cols-2 gap-2" : ""}>
                        {[primary, ...(secondLang ? [secondLang] : [])].map((lang) => (
                          <Textarea
                            key={lang}
                            aria-label={`${s.label} in ${langName(lang)}`}
                            placeholder={`${langName(lang)} words…`}
                            value={s.texts[lang] ?? ""}
                            rows={Math.max(3, (s.texts[lang] ?? "").split("\n").length)}
                            className="font-serif text-sm"
                            onChange={(e) => set({ sections: form.sections.map((x) => (x.id === s.id ? { ...x, texts: { ...x.texts, [lang]: e.target.value } } : x)) })}
                          />
                        ))}
                      </div>
                    </li>
                  ))}
                </ol>
                <details className="rounded-lg border border-border p-3">
                  <summary className="cursor-pointer text-sm font-medium">Paste more words</summary>
                  <div className="mt-2">
                    <PasteBox paste={paste} setPaste={setPaste} lang={pasteLang} setLang={setPasteLang} onApply={() => { set(applyPaste(form, paste, pasteLang)); setPaste("") }} />
                  </div>
                </details>

                <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">Order</h3>
                    {form.arrangements.length === 0 ? (
                      <>
                        <span className="text-xs text-muted-foreground">Sections in the order above; one chorus repeats after every verse.</span>
                        <Button variant="outline" size="sm" className="ml-auto" onClick={() => { const f = addArrangement(form, "Default"); set(f); setArrangementId(f.arrangements[0].id) }}>
                          Change the order
                        </Button>
                      </>
                    ) : (
                      <>
                        <Select value={arrangement?.id} onValueChange={setArrangementId}>
                          <SelectTrigger className="h-7 w-44 text-xs" aria-label="Arrangement"><SelectValue /></SelectTrigger>
                          <SelectContent>{form.arrangements.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}{a.is_default ? " (default)" : ""}</SelectItem>)}</SelectContent>
                        </Select>
                        {arrangement && (
                          <Input
                            aria-label="Arrangement name"
                            value={arrangement.name}
                            onChange={(e) => set(updateArrangement(form, arrangement.id, { name: e.target.value }))}
                            className="h-7 w-36 text-xs"
                          />
                        )}
                        <span className="ml-auto flex items-center gap-1">
                          {arrangement && !arrangement.is_default && (
                            <Button variant="ghost" size="sm" onClick={() => set(updateArrangement(form, arrangement.id, { is_default: true }))}>Make default</Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => { const f = addArrangement(form, `Order ${form.arrangements.length + 1}`); set(f); setArrangementId(f.arrangements[f.arrangements.length - 1].id) }}>
                            <PlusIcon /> New order
                          </Button>
                          {arrangement && (
                            <Button variant="ghost" size="icon-xs" aria-label="Delete this order" onClick={() => { set(removeArrangement(form, arrangement.id)); setArrangementId(null) }}><Trash2Icon /></Button>
                          )}
                        </span>
                      </>
                    )}
                  </div>
                  {arrangement && (
                    <ArrangementStrip steps={arrangement.steps} sections={form.sections} onChange={(steps) => set(updateArrangement(form, arrangement.id, { steps }))} />
                  )}
                </div>
              </>
            )}
            {problems.length > 0 && form.sections.length > 0 && (
              <ul className="text-xs text-confidence-mid">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[0.6875rem] text-muted-foreground">{hint}</span>}
    </label>
  )
}

function PasteBox({
  paste, setPaste, lang, setLang, onApply, big,
}: { paste: string; setPaste: (v: string) => void; lang: string; setLang: (v: string) => void; onApply: () => void; big?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      {big && (
        <p className="text-sm text-muted-foreground">
          Paste the words. Put a blank line between verses. Write <strong>Chorus</strong> (or <strong>Ẹgbẹ́ orin</strong>) on its own line above the chorus.
        </p>
      )}
      <Textarea
        aria-label="Paste the words"
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
        rows={big ? 14 : 6}
        className="font-serif text-sm"
        placeholder={"Amazing grace, how sweet the sound\nthat saved a wretch like me\n\nChorus\nPraise God, praise God…"}
      />
      <div className="flex items-center gap-2">
        <Select value={lang} onValueChange={setLang}>
          <SelectTrigger className="h-8 w-36 text-xs" aria-label="Language of the pasted words"><SelectValue /></SelectTrigger>
          <SelectContent>{LANGUAGES.map(([t, n]) => <SelectItem key={t} value={t}>{n}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" disabled={!paste.trim()} onClick={onApply}>Make sections</Button>
      </div>
    </div>
  )
}

function HymnNumbers({ form, set }: { form: SongForm; set: (patch: Partial<SongForm>) => void }) {
  const hymnbooks = useSongStore((s) => s.hymnbooks)
  const [newOpen, setNewOpen] = useState(false)
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const createBook = async () => {
    setBusy(true)
    try {
      const book = await useSongStore.getState().upsertHymnbook({ code: code.trim(), name: name.trim(), language: form.primary_language })
      set({ numbers: [...form.numbers, { hymnbook_id: book.id, number: "" }] })
      setNewOpen(false)
      setCode("")
      setName("")
    } catch (e) {
      toast.error(describe(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">Hymnbook numbers</span>
      {form.numbers.map((n, i) => (
        <div key={i} className="flex items-center gap-1">
          <Select value={n.hymnbook_id} onValueChange={(v) => set({ numbers: form.numbers.map((x, j) => (j === i ? { ...x, hymnbook_id: v } : x)) })}>
            <SelectTrigger className="h-8 flex-1 text-xs" aria-label="Hymnbook"><SelectValue placeholder="Hymnbook" /></SelectTrigger>
            <SelectContent>{hymnbooks.map((b) => <SelectItem key={b.id} value={b.id}>{b.code} · {b.name}</SelectItem>)}</SelectContent>
          </Select>
          <Input
            aria-label="Hymn number"
            value={n.number}
            onChange={(e) => set({ numbers: form.numbers.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)) })}
            className="h-8 w-16 text-xs"
            placeholder="245"
          />
          <Button variant="ghost" size="icon-xs" aria-label="Remove number" onClick={() => set({ numbers: form.numbers.filter((_, j) => j !== i) })}><XIcon /></Button>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <Button variant="outline" size="xs" disabled={hymnbooks.length === 0} onClick={() => set({ numbers: [...form.numbers, { hymnbook_id: hymnbooks[0]?.id ?? "", number: "" }] })}>
          <PlusIcon /> Number
        </Button>
        <Popover open={newOpen} onOpenChange={setNewOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="xs">New hymnbook…</Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="flex w-72 flex-col gap-2">
            <Field label="Short code" hint="Letters only, e.g. SSS or YBH"><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} /></Field>
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sacred Songs and Solos" /></Field>
            <Button size="sm" disabled={busy || !/^[A-Za-z]{1,6}$/.test(code) || !name.trim()} onClick={() => void createBook()}>Add hymnbook</Button>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

/** Chord charts and sheet music for a saved song: files in the media folder, opened with the computer's own viewer. */
function Attachments({ songId }: { songId: string }) {
  const [files, setFiles] = useState<MediaAsset[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let cancelled = false
    invoke<MediaAsset[]>("content_list_song_attachments", { songId }).then((f) => { if (!cancelled) setFiles(f) }).catch(() => {})
    return () => { cancelled = true }
  }, [songId])
  const add = async () => {
    setBusy(true)
    try {
      const results = await useMediaStore.getState().importFiles([{ name: "Chord charts, sheets and backing tracks", extensions: ["pdf", "png", "jpg", "jpeg", "mp3", "m4a", "aac", "wav", "ogg"] }])
      if (!results) return
      let latest = files
      for (const r of results) {
        if (r.status === "imported") latest = await invoke<MediaAsset[]>("content_add_song_attachment", { songId, mediaId: r.asset.id })
        else toast.error(`${r.path.split(/[\\/]/).pop()}: ${r.message}`)
      }
      setFiles(latest)
    } catch (e) {
      toast.error(describe(e))
    } finally {
      setBusy(false)
    }
  }
  const openFile = async (m: MediaAsset) => {
    try {
      const assets = useMediaStore.getState().assets.length ? useMediaStore.getState().assets : await useMediaStore.getState().list()
      const path = assets.find((a) => a.id === m.id)?.path
      if (!path) throw new Error("The file is missing from the media folder.")
      await openPath(path)
    } catch (e) {
      toast.error(describe(e))
    }
  }
  const remove = async (m: MediaAsset) => {
    try {
      setFiles(await invoke<MediaAsset[]>("content_remove_song_attachment", { songId, mediaId: m.id }))
    } catch (e) {
      toast.error(describe(e))
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">Chord charts, sheets and backing tracks</span>
      {files.length === 0 && <p className="text-xs text-muted-foreground">None yet. A PDF or picture opens in the computer's own viewer, never on screen. A sound (MP3, M4A, WAV, OGG) is offered under the Sound button in Present while this song is up.</p>}
      <ul className="flex flex-col gap-1">
        {files.map((m) => (
          <li key={m.id} className="flex items-center gap-2 text-xs">
            <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => void openFile(m)} title="Open">{m.name}</button>
            <Button size="icon-xs" variant="ghost" aria-label={`Remove ${m.name}`} onClick={() => void remove(m)}><XIcon /></Button>
          </li>
        ))}
      </ul>
      <Button variant="outline" size="sm" className="w-fit" disabled={busy} onClick={() => void add()}><PlusIcon /> Add a file…</Button>
    </div>
  )
}

function describe(e: unknown): string {
  if (isContentCommandError(e)) return e.message
  return e instanceof Error ? e.message : String(e)
}
