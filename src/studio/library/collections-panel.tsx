import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckIcon, FolderPlusIcon, PencilIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDelete } from "@/studio/ui/confirm-delete"
import { useSongStore } from "@/stores/song-store"
import { useSlideStore } from "@/stores/slide-store"
import { useMediaStore } from "@/stores/media-store"
import { designStore } from "@/design-engine/design-store"
import { songQueueItem } from "@/lib/lyrics"
import { mediaQueueItem } from "@/lib/media-items"
import { describeError } from "@/studio/library/content-actions"
import { LoadFailedRow } from "@/studio/library/load-failed-row"
import { reusableSlideQueueItem } from "@/studio/library/slide-items"
import { captureLibraryUseInvocation, type LibraryItemUseHandler } from "@/studio/library/library-target-store"
import { collectionItemLabel, collectionsApi, type Collection, type CollectionItem, type CollectionItemKind, type CollectionSummary } from "@/studio/library/collections"

const KIND_LABEL: Record<CollectionItemKind, string> = { song: "Songs and hymns", slide: "Slides", media: "Pictures, videos and sounds", design: "Visual designs" }

interface Candidate { kind: CollectionItemKind; id: string; title: string }

/**
 * Library → Collections (#853 G9): the church's own groups of library items ("Christmas",
 * "Communion"). A collection holds references, so removing a collection or an item from one never
 * removes anything from the library. Use adds a copy to the service, like every Library section.
 */
export function CollectionsPanel({ onUseItem }: { onUseItem?: LibraryItemUseHandler }) {
  const [collections, setCollections] = useState<CollectionSummary[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Collection | null>(null)
  const [newName, setNewName] = useState("")
  const [renaming, setRenaming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const list = await collectionsApi.list()
      setCollections(list)
      setListError(null)
      return list
    } catch (e) {
      setCollections([])
      setListError(describeError(e))
      return []
    }
  }, [])
  useEffect(() => {
    let cancelled = false
    collectionsApi.list()
      .then((list) => { if (!cancelled) { setCollections(list); setListError(null) } })
      .catch((e: unknown) => { if (!cancelled) { setCollections([]); setListError(describeError(e)) } })
    return () => { cancelled = true }
  }, [])

  const open = async (id: string) => {
    try {
      setSelected(await collectionsApi.get(id))
    } catch (e) {
      toast.error("Could not open the collection", { description: describeError(e) })
    }
  }
  const create = async () => {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    try {
      const made = await collectionsApi.create(name)
      setNewName("")
      await load()
      await open(made.id)
    } catch (e) {
      toast.error("Could not make the collection", { description: describeError(e) })
    } finally {
      setBusy(false)
    }
  }
  const rename = async (id: string) => {
    if (renaming === null) return
    try {
      await collectionsApi.rename(id, renaming)
      setRenaming(null)
      await load()
      if (selected?.summary.id === id) await open(id)
    } catch (e) {
      toast.error("Could not rename the collection", { description: describeError(e) })
    }
  }
  const remove = async (id: string) => {
    try {
      await collectionsApi.remove(id)
      if (selected?.summary.id === id) setSelected(null)
      await load()
      toast.success("Collection removed", { description: "Its songs, slides and pictures are still in the library." })
    } catch (e) {
      toast.error("Could not remove the collection", { description: describeError(e) })
    }
  }
  const changed = async (next: Collection) => {
    setSelected(next)
    await load()
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(14rem,0.7fr)_minmax(20rem,1.3fr)] gap-4 max-[680px]:grid-cols-1">
      <section className="flex min-h-0 flex-col rounded-lg border border-border bg-background" aria-label="Collections">
        <form className="flex items-center gap-2 border-b border-border p-3" onSubmit={(e) => { e.preventDefault(); void create() }}>
          <Input aria-label="New collection name" value={newName} maxLength={120} onChange={(e) => setNewName(e.target.value)} placeholder="New collection, e.g. Christmas" className="h-8 text-xs" />
          <Button type="submit" size="sm" disabled={busy || !newName.trim()}><FolderPlusIcon /> Make</Button>
        </form>
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {listError && <LoadFailedRow as="li" what="collections" error={listError} onRetry={() => void load()} />}
          {!listError && collections.length === 0 && <li className="px-2 py-3 text-xs text-muted-foreground">No collections yet. Make one to group songs, slides and pictures you use together.</li>}
          {collections.map((c) => (
            <li key={c.id} className={`mb-1 flex items-center gap-1 rounded-md border px-2 py-1.5 ${selected?.summary.id === c.id ? "border-foreground/30 bg-muted/70" : "border-transparent hover:bg-muted/50"}`}>
              {renaming !== null && selected?.summary.id === c.id ? (
                <form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={(e) => { e.preventDefault(); void rename(c.id) }}>
                  <Input aria-label="Collection name" autoFocus value={renaming} maxLength={120} onChange={(e) => setRenaming(e.target.value)} className="h-7 text-xs" />
                  <Button type="submit" size="icon-xs" aria-label="Save name" disabled={!renaming.trim()}><CheckIcon /></Button>
                  <Button type="button" size="icon-xs" variant="ghost" aria-label="Cancel rename" onClick={() => setRenaming(null)}><XIcon /></Button>
                </form>
              ) : (
                <>
                  <button type="button" aria-pressed={selected?.summary.id === c.id} className="min-w-0 flex-1 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50" onClick={() => { setRenaming(null); void open(c.id) }}>
                    <span className="block truncate font-semibold">{c.name}</span>
                    <span className="block text-[0.6875rem] text-muted-foreground">{c.item_count} item{c.item_count === 1 ? "" : "s"}</span>
                  </button>
                  {selected?.summary.id === c.id && <Button size="icon-xs" variant="ghost" aria-label={`Rename ${c.name}`} onClick={() => setRenaming(c.name)}><PencilIcon /></Button>}
                  <ConfirmDelete label={`Remove collection ${c.name}`} verb="Remove" onConfirm={() => void remove(c.id)} />
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex min-h-0 flex-col overflow-y-auto rounded-lg border border-border bg-background p-4" aria-label="Collection items">
        {selected ? (
          <CollectionDetail collection={selected} onChanged={(next) => void changed(next)} onUseItem={onUseItem} />
        ) : (
          <p className="text-xs text-muted-foreground">Choose a collection to see its items, or make a new one. A collection only groups library items: removing it never removes a song, slide or picture.</p>
        )}
      </section>
    </div>
  )
}

function CollectionDetail({ collection, onChanged, onUseItem }: { collection: Collection; onChanged: (next: Collection) => void; onUseItem?: LibraryItemUseHandler }) {
  const id = collection.summary.id
  const take = async (item: CollectionItem) => {
    try {
      onChanged(await collectionsApi.take(id, item.kind, item.item_id))
    } catch (e) {
      toast.error("Could not take it out of the collection", { description: describeError(e) })
    }
  }
  const use = async (item: CollectionItem) => {
    if (!onUseItem) return
    const invocation = captureLibraryUseInvocation()
    try {
      if (item.kind === "song") {
        const song = (await useSongStore.getState().all()).find((s) => s.id === item.item_id)
        if (!song) throw new Error("This song is no longer in the library.")
        onUseItem(songQueueItem(song), invocation)
      } else if (item.kind === "slide") {
        const slide = (await useSlideStore.getState().list("")).find((s) => s.id === item.item_id)
        if (!slide) throw new Error("This slide is no longer in the library.")
        onUseItem(reusableSlideQueueItem(slide, useMediaStore.getState().assets), invocation)
      } else if (item.kind === "media") {
        const assets = useMediaStore.getState().loaded ? useMediaStore.getState().assets : await useMediaStore.getState().list()
        const asset = assets.find((a) => a.id === item.item_id)
        if (!asset) throw new Error("This file is no longer in the library.")
        onUseItem(mediaQueueItem(asset), invocation)
      }
    } catch (e) {
      toast.error("Nothing was added", { description: describeError(e) })
    }
  }
  return (
    <>
      <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Collection</p>
      <h2 className="mt-1 text-base font-semibold">{collection.summary.name}</h2>
      <ul className="mt-3 flex flex-col gap-1" aria-label={`Items in ${collection.summary.name}`}>
        {collection.items.length === 0 && <li className="text-xs text-muted-foreground">Empty. Add songs, slides, pictures or designs below.</li>}
        {collection.items.map((item) => (
          <li key={`${item.kind}:${item.item_id}`} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs">
            <span className="w-24 shrink-0 text-muted-foreground">{collectionItemLabel(item)}</span>
            <span className={`min-w-0 flex-1 truncate ${item.title === null ? "text-muted-foreground italic" : "font-medium"}`}>{item.title ?? "No longer in the library"}</span>
            {onUseItem && item.title !== null && item.kind !== "design" && <Button size="xs" variant="outline" onClick={() => void use(item)}>Use</Button>}
            <Button size="icon-xs" variant="ghost" aria-label={`Take ${item.title ?? "missing item"} out of ${collection.summary.name}`} title="Take out of this collection (it stays in the library)" onClick={() => void take(item)}><XIcon /></Button>
          </li>
        ))}
      </ul>
      <AddToCollection collection={collection} onChanged={onChanged} />
    </>
  )
}

/** Find a library item by its name and add it to the collection. */
function AddToCollection({ collection, onChanged }: { collection: Collection; onChanged: (next: Collection) => void }) {
  const [kind, setKind] = useState<CollectionItemKind>("song")
  const [query, setQuery] = useState("")
  // Each kind (and each Try again) is its own load; a result for an earlier one is ignored.
  const [attempt, setAttempt] = useState(0)
  const key = `${kind}:${attempt}`
  const [loaded, setLoaded] = useState<{ key: string; list?: Candidate[]; error?: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<Candidate[]> => {
      if (kind === "song") return (await useSongStore.getState().all()).map((s) => ({ kind, id: s.id, title: s.title }))
      if (kind === "slide") return (await useSlideStore.getState().list("")).map((s) => ({ kind, id: s.id, title: s.title.trim() || s.body.slice(0, 80) || "Untitled slide" }))
      if (kind === "media") return (useMediaStore.getState().loaded ? useMediaStore.getState().assets : await useMediaStore.getState().list()).map((a) => ({ kind, id: a.id, title: a.name }))
      return (await designStore.list()).map((d) => ({ kind, id: d.id, title: d.title || "Untitled design" }))
    }
    load()
      .then((list) => { if (!cancelled) setLoaded({ key, list }) })
      .catch((e: unknown) => { if (!cancelled) setLoaded({ key, error: describeError(e) }) })
    return () => { cancelled = true }
  }, [kind, key])
  const candidates = loaded?.key === key ? loaded.list ?? null : null
  const error = loaded?.key === key ? loaded.error ?? null : null
  const loadCandidates = () => setAttempt((n) => n + 1)
  const inCollection = useMemo(() => new Set(collection.items.map((i) => `${i.kind}:${i.item_id}`)), [collection.items])
  const words = query.trim().toLowerCase()
  const shown = (candidates ?? []).filter((c) => !inCollection.has(`${c.kind}:${c.id}`) && (!words || c.title.toLowerCase().includes(words))).slice(0, 30)
  const add = async (c: Candidate) => {
    try {
      onChanged(await collectionsApi.add(collection.summary.id, c.kind, c.id))
    } catch (e) {
      toast.error("Could not add it to the collection", { description: describeError(e) })
    }
  }
  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="mb-2 text-xs font-medium">Add from the library</p>
      <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Kind of item to add">
        {(Object.keys(KIND_LABEL) as CollectionItemKind[]).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`rounded px-2.5 py-1 text-xs ${kind === k ? "bg-muted font-semibold" : "text-muted-foreground hover:text-foreground"}`}>{KIND_LABEL[k]}</button>
        ))}
      </div>
      <label className="relative mb-2 block">
        <SearchIcon className="pointer-events-none absolute top-2 left-2.5 size-3.5 text-muted-foreground" aria-hidden />
        <Input aria-label="Find an item to add" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find by name" className="h-8 pl-8 text-xs" />
      </label>
      {error && <LoadFailedRow what={KIND_LABEL[kind].toLowerCase()} error={error} onRetry={() => void loadCandidates()} />}
      {!error && candidates === null && <p className="text-xs text-muted-foreground" role="status">Loading…</p>}
      {!error && candidates !== null && shown.length === 0 && <p className="text-xs text-muted-foreground">{words ? "Nothing in the library matches." : "Everything of this kind is already in the collection, or there is none yet."}</p>}
      <ul className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
        {shown.map((c) => (
          <li key={c.id} className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate">{c.title}</span>
            <Button size="xs" variant="outline" aria-label={`Add ${c.title} to ${collection.summary.name}`} onClick={() => void add(c)}><PlusIcon /> Add</Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
