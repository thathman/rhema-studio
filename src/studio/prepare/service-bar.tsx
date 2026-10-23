import { useChurchFolderStore } from "@/stores/church-folder-store"
import { NewerVersionNotice } from "@/studio/prepare/newer-version-notice"
import { UnreadComments } from "@/studio/prepare/unread-comments"
import { useSettingsStore } from "@/stores/settings-store"
import { publishLineage, publishToChurchFolder, unchangedCopy } from "@/lib/church-folder"
import { useState } from "react"
import { toast } from "sonner"
import { BadgeCheckIcon, CalendarIcon, CopyIcon, FolderUpIcon, PencilIcon, PlusIcon, RefreshCwIcon, SaveIcon, Trash2Icon, TriangleAlertIcon, XIcon } from "lucide-react"
import { approvalBlockers, approvalLabel, approvalState } from "@/lib/approval"
import { useMediaStore } from "@/stores/media-store"
import { useSongStore } from "@/stores/song-store"
import { isImageItem, isSongItem } from "@/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useServiceStore } from "@/stores/service-store"
import { useQueueStore } from "@/stores"
import { isVerseItem } from "@/types"
import { ServiceHistory } from "@/studio/prepare/service-history"
import { useShellStore } from "@/studio/shell-store"
import { useBibleStore } from "@/stores/bible-store"
import { StatusChip } from "@/studio/ui/status-chip"
import { saveStateOf } from "@/studio/prepare/save-state"

/** The saved / unsaved line beside the service's name. */
export function SaveState() {
  const current = useServiceStore((s) => s.current)
  const dirty = useServiceStore((s) => s.dirty)
  const saving = useServiceStore((s) => s.saving)
  const count = useQueueStore((s) => s.items.length)
  const state = saveStateOf({ current, dirty, saving, count })
  return (
    <span role="status" aria-live="polite" className="shrink-0">
      <StatusChip tone={state.tone} label={state.label} title={state.title} className="h-7" />
    </span>
  )
}

/**
 * Pick, create, save, close and delete the service the rundown belongs to.
 * The store refuses anything that would lose unsaved work; this bar only
 * decides how to ask before passing `discard`.
 */
export function ServiceBar() {
  const programs = useServiceStore((s) => s.programs)
  const current = useServiceStore((s) => s.current)
  const dirty = useServiceStore((s) => s.dirty)
  const approval = approvalState(useServiceStore((s) => s.current))
  const approve = async () => {
    const items = useQueueStore.getState().items
    // Fresh answers, not cached ones: a song imported since, or a file removed since.
    await Promise.all(items.filter(isSongItem).map((i) => useSongStore.getState().load(i.song.song_id, { refresh: true }).catch(() => null)))
    if (items.some(isImageItem) || items.some((i) => i.background)) await useMediaStore.getState().list().catch(() => {})
    const blockers = approvalBlockers(items, useSongStore.getState().missing, useMediaStore.getState().assets)
    if (blockers.length) {
      toast.error("Not approved", { description: blockers.join(" ") + " Fix that first, or remove the item." })
      return
    }
    const r = await useServiceStore.getState().approve()
    if (r === "ok") toast.success("Approved", { description: "This saved version is kept in History whatever is saved later." })
    else if (r === "unsaved") toast.warning("Save first")
    else if (r === "conflict") toast.error("This service changed elsewhere", { description: "Reload it, then approve again." })
    else toast.error("Could not approve", { description: useServiceStore.getState().error ?? undefined })
  }
  const saving = useServiceStore((s) => s.saving)
  const loading = useServiceStore((s) => s.loading)
  const error = useServiceStore((s) => s.error)
  const conflict = useServiceStore((s) => s.conflict)
  const unsupported = useServiceStore((s) => s.unsupportedItems)
  const missing = useServiceStore((s) => s.missingTranslations)
  const count = useQueueStore((s) => s.items.length)
  const items = useQueueStore((s) => s.items)
  const activeId = useBibleStore((s) => s.activeTranslationId)
  const translations = useBibleStore((s) => s.translations)
  const override = useBibleStore((s) => s.overrideServiceTranslations)
  // Saved items go live in the translation they were saved with (unless the
  // operator overrides in Present). Say so when that differs from the active one.
  const activeAbbrev = translations.find((t) => t.id === activeId)?.abbreviation ?? null
  const pinnedElsewhere = current
    ? [...new Set(items.filter(isVerseItem).map((i) => i.translation).filter((t): t is string => typeof t === "string" && t !== activeAbbrev && !missing.includes(t)))]
    : []

  const newOpen = useShellStore((s) => s.newServiceOpen)
  const setNewOpen = useShellStore((s) => s.setNewServiceOpen)
  const [title, setTitle] = useState("")
  const [date, setDate] = useState("")
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [dupOpen, setDupOpen] = useState(false)
  const [dupTitle, setDupTitle] = useState("")
  const [dupDate, setDupDate] = useState("")
  const [editOpen, setEditOpen] = useState(false)
  const [editTitle, setEditTitle] = useState("")
  const [editDate, setEditDate] = useState("")
  const [showArchived, setShowArchived] = useState(false)
  const churchFolder = useSettingsStore((s) => s.churchFolder)
  const [publishing, setPublishing] = useState(false)
  // Owner decision #72: the saved service goes to the shared folder as a new versioned file.
  const publish = async () => {
    if (!current) return
    setPublishing(true)
    try {
      const settings = useSettingsStore.getState()
      if (unchangedCopy(settings.openedFrom[current.id], current.id, current.revision, current.approved_revision ?? null)) {
        toast.info("Nothing to publish", { description: "This copy has not changed since it was opened from the church folder." })
        return
      }
      const r = await publishToChurchFolder(churchFolder, current.id, publishLineage(settings.openedFrom[current.id], current.id, current.revision))
      // What this computer last put in the folder: a newer version from elsewhere is then pointed out here too.
      settings.noteOpenedFrom(current.id, { sha256: r.sha256, source_id: r.source_id, title: current.title, service_date: current.service_date ?? null, revision: r.revision, local_revision: current.revision })
      // The folder lists (Home card, newer-version notice) see the new file at once.
      void useChurchFolderStore.getState().refresh(churchFolder)
      if (r.numbered_after) toast.warning(`Published as v${r.revision}: v${r.numbered_after} from another computer was already there`, { description: "Its changes are not in this version. Open it from the church folder to compare.", duration: 20_000 })
      else if (r.already) toast.info("This version is already in the church folder", { description: r.file_name })
      else toast.success("Published to the church folder", { description: `${r.file_name}${approval === "approved" ? "" : " (not approved yet)"}` })
    } catch (e) {
      toast.error("Not published", { description: typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : String(e) })
    } finally {
      setPublishing(false)
    }
  }
  const [fromTemplate, setFromTemplate] = useState("")
  const templates = programs.filter((p) => p.is_template && !p.archived_at)
  const archivedCount = programs.filter((p) => p.archived_at).length
  const listed = programs.filter((p) => !p.archived_at || showArchived || p.id === current?.id)

  const fail = (what: string) =>
    toast.error(what, { description: useServiceStore.getState().error ?? undefined })

  const open = async (id: string) => {
    const r = await useServiceStore.getState().openProgram(id)
    if (r === "unsaved") toast.warning("Save or discard your changes first")
    else if (r !== "ok") fail("Could not open service")
  }

  const create = async () => {
    const usedTemplate = fromTemplate !== ""
    const r = fromTemplate
      ? await useServiceStore.getState().newFromTemplate(fromTemplate, title, date || null)
      : await useServiceStore.getState().createFromRundown(title, date || null)
    setFromTemplate("")
    setNewOpen(false)
    if (r === "created") {
      toast.success(usedTemplate ? `Service "${title}" created from the template` : count > 0 ? `Service "${title}" created and saved` : `Service "${title}" created`)
      setTitle("")
      setDate("")
    } else if (r === "created_unsaved") {
      toast.error(`Service "${title}" was created but the rundown could not be saved`, {
        description: `${useServiceStore.getState().error ?? ""} Your items are still on screen; use Save to retry.`,
      })
      setTitle("")
      setDate("")
    } else if (r === "unsaved") {
      toast.warning("Save or discard your changes first")
    } else {
      fail("Could not create service")
    }
  }

  const updateDetails = async () => {
    const r = await useServiceStore.getState().updateDetails(editTitle, editDate || null)
    setEditOpen(false)
    if (r === "ok") toast.success("Service renamed")
    else if (r === "conflict") toast.error("Not renamed: this service changed elsewhere", { description: "Reload it first." })
    else fail("Could not rename service")
  }

  const duplicate = async () => {
    const r = await useServiceStore.getState().duplicateCurrent(dupTitle, dupDate || null)
    setDupOpen(false)
    if (r === "created") toast.success(`Copied to "${dupTitle}"`, { description: "You are now editing the copy. The original is unchanged." })
    else if (r === "created_unsaved") toast.error(`"${dupTitle}" was created but its items could not be saved`, { description: useServiceStore.getState().error ?? undefined })
    else if (r === "unsaved") toast.warning("Save or discard your changes first")
    else fail("Could not copy service")
  }

  const save = async () => {
    const r = await useServiceStore.getState().saveCurrent()
    if (r === "saved") toast.success("Service saved")
    else if (r === "conflict") toast.error("Not saved: this service changed elsewhere", { description: "Reload to see the latest version, or keep editing and reload later." })
    else if (r === "unsupported") toast.error("Not saved", { description: useServiceStore.getState().error ?? undefined })
    else if (r === "failed") fail("Could not save service")
  }

  const reload = async () => {
    if (!current) return
    const r = await useServiceStore.getState().openProgram(current.id, { discard: true })
    if (r === "ok") toast.success("Reloaded the saved version")
    else fail("Could not reload service")
  }

  const remove = async () => {
    if (!current) return
    const r = await useServiceStore.getState().deleteProgram(current.id, { discard: true })
    setDeleteOpen(false)
    if (r === "deleted") toast.success("Service deleted")
    else if (r === "conflict") toast.error("Not deleted: this service changed elsewhere", { description: "Reload it first." })
    else fail("Could not delete service")
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="This service" data-tour="service-bar">
      <Select value={current?.id ?? ""} onValueChange={(id) => void open(id)} disabled={loading || dirty}>
        <SelectTrigger className="h-9 w-64" aria-label="Service" title={dirty ? "Save or discard changes before switching" : undefined}>
          <SelectValue placeholder={programs.length ? "Open a service…" : "No saved services yet"} />
        </SelectTrigger>
        <SelectContent>
          {listed.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.title}
              {p.service_date ? ` · ${p.service_date}` : ""}
              {p.is_template ? " · template" : ""}
              {p.archived_at ? " · archived" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {archivedCount > 0 && (
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived ({archivedCount})
        </label>
      )}

      <ServiceHistory />
      <NewerVersionNotice />
      <UnreadComments />
      {current && churchFolder && (
        <Button
          variant="outline"
          size="sm"
          disabled={dirty || publishing}
          title={dirty ? "Save first; the saved version is what is published" : `Put this saved version in the church folder (${churchFolder})`}
          onClick={() => void publish()}
        >
          <FolderUpIcon /> Publish
        </Button>
      )}
      {current && (
        <Popover
          open={editOpen}
          onOpenChange={(o) => {
            setEditOpen(o)
            if (o) {
              setEditTitle(current.title)
              setEditDate(current.service_date ?? "")
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" aria-label="Rename or change the date" title="Rename or change the date">
              <PencilIcon />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72">
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void updateDetails()
              }}
            >
              <label className="text-xs text-muted-foreground" htmlFor="edit-title">Title</label>
              <Input id="edit-title" autoFocus value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required maxLength={200} />
              <label className="text-xs text-muted-foreground" htmlFor="edit-date">Date (optional)</label>
              <Input id="edit-date" type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
              <p className="text-xs text-muted-foreground">The items are not touched; unsaved changes stay unsaved.</p>
              <Button type="submit" size="sm" disabled={!editTitle.trim()}>Save title and date</Button>
            </form>
            <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 text-xs">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={current.is_template === true}
                  onChange={(e) => void useServiceStore.getState().setTemplate(current.id, e.target.checked).then((ok) => { if (!ok) fail("Could not change the template mark") })}
                />
                <span>Template<span className="block text-muted-foreground">Offered under New service → Start from (9 am, communion, youth…). Not shown on Home.</span></span>
              </label>
              <Button
                size="sm"
                variant="outline"
                className="w-fit"
                onClick={() => {
                  const archive = !current.archived_at
                  void useServiceStore.getState().setArchived(current.id, archive).then((ok) => {
                    setEditOpen(false)
                    if (ok) toast.success(archive ? "Service archived" : "Service brought back", { description: archive ? "Hidden from the list; its history and logs are kept. Tick Show archived to find it." : undefined })
                    else fail("Could not change the archive state")
                  })
                }}
              >
                {current.archived_at ? "Bring back from the archive" : "Archive this service"}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
      {current && (
        <Popover
          open={dupOpen}
          onOpenChange={(o) => {
            setDupOpen(o)
            if (o) {
              setDupTitle(`${current.title} (copy)`)
              setDupDate(current.service_date ?? "")
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" disabled={dirty} title={dirty ? "Save or discard changes first" : "Make a copy of this service, e.g. for the 9 am and 11 am"}>
              <CopyIcon /> Copy
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72">
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void duplicate()
              }}
            >
              <p className="text-xs text-muted-foreground">Every item is copied. Changes to the copy never touch the original.</p>
              <label className="text-xs text-muted-foreground" htmlFor="dup-title">Title</label>
              <Input id="dup-title" autoFocus value={dupTitle} onChange={(e) => setDupTitle(e.target.value)} required maxLength={200} />
              <label className="text-xs text-muted-foreground" htmlFor="dup-date">Date (optional)</label>
              <Input id="dup-date" type="date" value={dupDate} onChange={(e) => setDupDate(e.target.value)} />
              <Button type="submit" size="sm" disabled={!dupTitle.trim()}>Make the copy</Button>
            </form>
          </PopoverContent>
        </Popover>
      )}

      <Popover open={newOpen} onOpenChange={setNewOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" disabled={!!current && dirty} title={current && dirty ? "Save or discard changes first" : !current ? (count > 0 ? "Save the items on screen as a new service" : "Start a new service") : count > 0 ? `Start another service from the items on screen, or from a template; "${current.title}" stays as saved` : `Start another service; "${current.title}" stays as saved`}>
            <PlusIcon /> New service
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72">
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void create()
            }}
          >
            <label className="text-xs text-muted-foreground" htmlFor="svc-title">Title</label>
            <Input id="svc-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sunday service" required maxLength={200} />
            <label className="text-xs text-muted-foreground" htmlFor="svc-date">Date (optional)</label>
            <div className="relative">
              <CalendarIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input id="svc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="pl-8" />
            </div>
            {templates.length > 0 && (
              <>
                <label className="text-xs text-muted-foreground" htmlFor="svc-from">Start from</label>
                <select id="svc-from" value={fromTemplate} onChange={(e) => setFromTemplate(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
                  <option value="">{count > 0 ? "The items on screen" : "Nothing (empty)"}</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>Template: {t.title}</option>)}
                </select>
              </>
            )}
            <p className="text-[0.6875rem] text-muted-foreground">
              {fromTemplate ? `A copy of the template's items (the template is not changed).${!current && count > 0 ? ` The ${count} unsaved item${count === 1 ? "" : "s"} on screen will be replaced.` : ""}` : count > 0 ? `The ${count} item${count === 1 ? "" : "s"} on screen become this service and are saved.` : "Starts empty."}
            </p>
            <div className="mt-1 flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setNewOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={!title.trim()}>Create</Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>

      {current && (
        <>
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={!dirty || saving || unsupported.length > 0}
            title={unsupported.length > 0 ? "Contains items this version cannot edit" : dirty ? "Save changes" : "No unsaved changes"}
          >
            <SaveIcon /> {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </Button>

          <Button
            size="sm"
            variant={approval === "approved" ? "outline" : "secondary"}
            disabled={dirty || saving || approval === "approved"}
            title={dirty ? "Save first; approval covers what is saved" : approvalLabel(current)}
            onClick={() => void approve()}
          >
            <BadgeCheckIcon /> {approval === "approved" ? "Approved" : approval === "changed" ? "Approve again" : "Approve"}
          </Button>

          {conflict && (
            <Button size="sm" variant="outline" className="border-confidence-mid text-confidence-mid" onClick={() => void reload()} title={`Saved elsewhere as revision ${conflict.actual}; you opened revision ${conflict.expected}`}>
              <RefreshCwIcon /> Changed elsewhere · Reload
            </Button>
          )}

          {dirty ? (
            <Popover open={discardOpen} onOpenChange={setDiscardOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Close service" title="Close service">
                  <XIcon />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72">
                <p className="mb-3 text-sm">Discard unsaved changes to "{current.title}"? The rundown stays on screen but is no longer linked to the saved service.</p>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setDiscardOpen(false)}>Keep editing</Button>
                  <Button variant="destructive" size="sm" onClick={() => { useServiceStore.getState().closeProgram({ discard: true }); setDiscardOpen(false) }}>
                    Discard changes
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          ) : (
            <Button variant="ghost" size="icon-sm" aria-label="Close service" title="Close service (keeps the rundown)" onClick={() => useServiceStore.getState().closeProgram()}>
              <XIcon />
            </Button>
          )}

          <Popover open={deleteOpen} onOpenChange={setDeleteOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Delete service" title="Delete service">
                <Trash2Icon />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64">
              <p className="mb-3 text-sm">
                Delete "{current.title}"?{dirty ? " Unsaved changes are lost too." : ""} The rundown on screen stays until you clear it.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(false)}>Keep</Button>
                <Button variant="destructive" size="sm" onClick={() => void remove()}>Delete</Button>
              </div>
            </PopoverContent>
          </Popover>
        </>
      )}

      {unsupported.length > 0 && (
        <span className="flex items-center gap-1 text-xs text-confidence-mid" role="status" title={unsupported.map((u) => `${u.kind}: ${u.reference}`).join("\n")}>
          <TriangleAlertIcon className="size-3.5" /> {unsupported.length} item{unsupported.length === 1 ? "" : "s"} this version cannot edit
        </span>
      )}
      {missing.length > 0 && (
        <span className="flex items-center gap-1 text-xs text-confidence-mid" role="status" title={`This service names ${missing.join(", ")}, which is not installed. Text is shown from ${activeAbbrev ?? "the active translation"} instead. Saving keeps ${missing.join(", ")} on the items.`}>
          <TriangleAlertIcon className="size-3.5" /> {missing.join(", ")} not installed
        </span>
      )}
      {pinnedElsewhere.length > 0 && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status" title={override ? `Items saved with ${pinnedElsewhere.join(", ")} are shown in ${activeAbbrev ?? "the active translation"} because the override is on in Present. Saving keeps ${pinnedElsewhere.join(", ")}.` : `Items saved with ${pinnedElsewhere.join(", ")} go live in ${pinnedElsewhere.join(", ")}, not in ${activeAbbrev ?? "the active translation"}. Turn on the override in Present to use ${activeAbbrev ?? "the active translation"} instead.`}>
          <TriangleAlertIcon className="size-3.5" /> Saved as {pinnedElsewhere.join(", ")}{override ? ` · override: shows in ${activeAbbrev ?? "active"}` : ` · shows in ${pinnedElsewhere.join(", ")}`}
        </span>
      )}
      {error && !current && (
        <span className="text-xs text-destructive" role="status">{error}</span>
      )}
    </div>
  )
}
