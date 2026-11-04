import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ask } from "@tauri-apps/plugin-dialog"
import { ArrowLeftIcon, FilePlus2Icon, Layers3Icon, PaletteIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { designStore, type DesignDocument, type DesignSummary, type DesignVersion } from "@/design-engine/design-store"
import { createBlankRhemaDesign, pinnedSceneForVersion } from "@/design-engine/design-document-utils"
import { designPages, outputCoverPictures, sceneToDesign } from "@/design-engine/rhema-scene"
import { adoptLook, type LibraryLook } from "@/lib/look-library"
import { libraryLooks } from "@/lib/design-packs"
import { useBroadcastStore, useSettingsStore } from "@/stores"
import { useUnsavedStore } from "@/stores/unsaved-store"
import { useShellStore } from "@/studio/shell-store"
import { LookLibraryView } from "@/studio/design/look-library-view"
import { DesignDocumentEditor } from "@/studio/design/design-document-editor"
import { DesignUsagePanel } from "@/studio/design/design-usage-panel"
import { hydrateDesignSceneMedia } from "@/lib/design-media"
import { renderSceneToCanvas } from "@/vendor/avnac/renderer/offscreen-render"
import type { Scene } from "@/types/scene"
import { cn } from "@/lib/utils"

function messageOf(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error && "message" in error) return String(error.message)
  return String(error)
}

export type InitialDesignTemplate = {
  look: Extract<LibraryLook, { kind: "scene" }>
  customize: boolean
}

export function DesignDocumentsWorkspace({ initialTemplate = null, onInitialTemplateHandled, initialDesignId = null, onInitialDesignHandled }: {
  initialTemplate?: InitialDesignTemplate | null
  onInitialTemplateHandled?: () => void
  initialDesignId?: string | null
  onInitialDesignHandled?: () => void
}) {
  const [documents, setDocuments] = useState<DesignSummary[]>([])
  const [active, setActive] = useState<DesignDocument | null>(null)
  const [chosenDesign, setChosenDesign] = useState<DesignDocument | null>(null)
  const [loading, setLoading] = useState(true)

  const [creating, setCreating] = useState(false)
  const [activeDirty, setActiveDirty] = useState(false)
  const [browseTemplates, setBrowseTemplates] = useState(false)
  const [query, setQuery] = useState("")
  const [error, setError] = useState("")
  const [reloadToken, setReloadToken] = useState(0)
  const handledInitialTemplate = useRef<InitialDesignTemplate | null>(null)
  const handledInitialDesign = useRef<string | null>(null)
  const mainRef = useRef<HTMLElement>(null)
  const chosenDesignHeadingRef = useRef<HTMLHeadingElement>(null)
  const focusEditorId = useRef<string | null>(null)

  useEffect(() => {
    if (chosenDesign) chosenDesignHeadingRef.current?.focus()
  }, [chosenDesign])

  useEffect(() => {
    if (!active || active.id !== focusEditorId.current) return
    mainRef.current?.querySelector<HTMLInputElement>("#design-document-title")?.focus()
    focusEditorId.current = null
  }, [active])

  const onActiveDirtyChange = useCallback((dirty: boolean) => {
    setActiveDirty(dirty)
    useUnsavedStore.getState().setDesignEditor(dirty ? active?.title ?? null : null)
  }, [active?.title])

  useEffect(() => () => useUnsavedStore.getState().setDesignEditor(null), [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const saved = await designStore.list(query.trim() || undefined)
        if (!cancelled) {
          setDocuments(saved)
          setError("")
        }
      } catch (failure) {
        if (!cancelled) setError("Saved designs could not be loaded: " + messageOf(failure))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [query, reloadToken])

  const confirmDiscard = useCallback(async () => {
    if (!activeDirty) return true
    try {
      return await ask("Your design changes are not saved. Discard them?", {
        title: "Discard design changes?",
        kind: "warning",
        okLabel: "Discard",
        cancelLabel: "Keep editing",
      })
    } catch {
      return false
    }
  }, [activeDirty])

  const open = useCallback(async (id: string) => {
    if (active?.id === id || !(await confirmDiscard())) return
    setLoading(true)
    try {
      const next = await designStore.get(id)
      if (!next) throw new Error("That design is no longer available.")
      useUnsavedStore.getState().setDesignEditor(null)
      setActive(next)
      setChosenDesign(null)
      setActiveDirty(false)
      setBrowseTemplates(false)
      focusEditorId.current = null
      setError("")
    } catch (failure) {
      setError("Design could not be opened: " + messageOf(failure))
    } finally {
      setLoading(false)
    }
  }, [active?.id, confirmDiscard])

  const createBlank = async () => {
    if (!(await confirmDiscard())) return
    setCreating(true)
    try {
      const title = "Untitled design"
      const created = await designStore.create({ title, kind: "design", document: createBlankRhemaDesign(title) })
      useUnsavedStore.getState().setDesignEditor(null)
      setActive(created)
      setChosenDesign(null)
      setActiveDirty(false)
      setBrowseTemplates(false)
      setLoading(true)
      setReloadToken((token) => token + 1)
    } catch (failure) {
      setError("A new design could not be created: " + messageOf(failure))
    } finally {
      setCreating(false)
    }
  }

  const createFromTemplate = useCallback(async (look: Extract<LibraryLook, { kind: "scene" }>, customize: boolean) => {
    const state = useBroadcastStore.getState()
    const takenNames = [
      ...state.themes.map((theme) => theme.name),
      ...state.scenes.map((scene) => scene.name),
      ...state.lowerThirdStyles.map((style) => style.name),
    ]
    const adopted = adoptLook(look, { takenNames, library: libraryLooks() })
    if (!adopted.scene) return
    setCreating(true)
    setError("")
    try {
      const created = await designStore.create({
        title: adopted.scene.name,
        kind: "design",
        document: sceneToDesign(adopted.scene),
      })
      for (const theme of adopted.themes) useBroadcastStore.getState().saveTheme(theme)
      // Keep the editable document canonical here. A scene copy is saved only when an immutable
      // version is deliberately used in Prepare or on a screen.
      setActive(customize ? created : null)
      setChosenDesign(customize ? null : created)
      focusEditorId.current = customize ? created.id : null
      setActiveDirty(false)
      setBrowseTemplates(false)
      setLoading(true)
      setReloadToken((token) => token + 1)
      toast.success("Design copy created", {
        description: customize
          ? "Your copy is saved in My Designs and opened for editing. It has not changed Preview, Program or any screen."
          : "Your copy is saved in My Designs. It has not changed Preview, Program or any screen.",
      })
    } catch (failure) {
      setError("A design copy could not be created: " + messageOf(failure))
    } finally {
      setCreating(false)
    }
  }, [])

  useEffect(() => {
    if (!initialTemplate || handledInitialTemplate.current === initialTemplate) return
    handledInitialTemplate.current = initialTemplate
    void createFromTemplate(initialTemplate.look, initialTemplate.customize)
    onInitialTemplateHandled?.()
  }, [createFromTemplate, initialTemplate, onInitialTemplateHandled])

  useEffect(() => {
    if (!initialDesignId || handledInitialDesign.current === initialDesignId || loading) return
    handledInitialDesign.current = initialDesignId
    void open(initialDesignId).finally(() => onInitialDesignHandled?.())
  }, [initialDesignId, loading, onInitialDesignHandled, open])

  const showTemplates = async () => {
    if (!(await confirmDiscard())) return
    useUnsavedStore.getState().setDesignEditor(null)
    setBrowseTemplates(true)
    setActive(null)
    setChosenDesign(null)
    setActiveDirty(false)
  }

  const reloadActive = async () => {
    if (!active) return
    const refreshed = await designStore.get(active.id)
    if (!refreshed) throw new Error("The design is no longer available.")
    setActive(refreshed)
    setDocuments((current) => current.map((item) => item.id === refreshed.id ? summaryOf(refreshed) : item))
  }
  const duplicateActive = async () => {
    if (!active || !(await confirmDiscard())) return
    setCreating(true)
    try {
      const copy = await designStore.duplicate(active.id, active.latestVersion ?? undefined, active.title + " copy")
      useUnsavedStore.getState().setDesignEditor(null)
      setActive(copy)
      setChosenDesign(null)
      setActiveDirty(false)
      setLoading(true)
      setReloadToken((token) => token + 1)
    } catch (failure) {
      setError("The template could not be duplicated: " + messageOf(failure))
    } finally {
      setCreating(false)
    }
  }
  const onSaved = (saved: DesignDocument) => {
    setActive(saved)
    setChosenDesign(null)
    setActiveDirty(false)
    setDocuments((current) => current.map((item) => item.id === saved.id ? summaryOf(saved) : item))
  }
  const onVersionCreated = (version: DesignVersion) => {
    if (!active) return
    const updated = { ...active, latestVersion: version.version }
    setActive(updated)
    setDocuments((current) => current.map((item) => item.id === updated.id ? summaryOf(updated) : item))
  }

  return (
    <div className="grid h-full min-h-[34rem] min-w-0 grid-cols-1 overflow-hidden rounded-lg border border-border bg-card shadow-panel lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-b border-border lg:border-b-0 lg:border-r" aria-label="My designs">
        <div className="border-b border-border p-3">
          <h2 className="flex items-center gap-2 text-sm font-bold"><Layers3Icon className="size-4" /> My Designs</h2>
          <p className="mt-1 text-[0.6875rem] text-muted-foreground">Local editable documents and their immutable versions.</p>
          <Input type="search" aria-label="Search designs" value={query} onChange={(event) => { setLoading(true); setQuery(event.currentTarget.value) }} placeholder="Search designs" className="mt-3 h-8 text-xs" />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button size="xs" onClick={() => void createBlank()} disabled={creating}><FilePlus2Icon /> Blank</Button>
            <Button size="xs" variant="outline" onClick={() => void showTemplates()} disabled={creating}><PaletteIcon /> Templates</Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading && <p className="px-2 py-3 text-xs text-muted-foreground">Loading saved designs…</p>}
          {!loading && documents.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">No saved designs match this search. Create a blank design or start from a scene template.</p>}
          {documents.map((item) => (
            <button key={item.id} type="button" onClick={() => void open(item.id)} className={cn("mb-1 flex w-full flex-col rounded-md border px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", active?.id === item.id ? "border-primary bg-accent" : "border-transparent hover:bg-accent/60")}>
              <span className="truncate text-xs font-semibold">{item.title}</span>
              <span className="mt-0.5 text-[0.6875rem] text-muted-foreground">{item.kind}{item.latestVersion ? " · v" + item.latestVersion : " · draft only"}</span>
            </button>
          ))}
        </div>
        {active && <DesignUsagePanel designId={active.id} />}
      </aside>
      <main ref={mainRef} className="flex min-h-0 min-w-0 flex-col">
        {error && <p role="alert" className="border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-xs">{error}</p>}
        {browseTemplates ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2">
              <Button size="xs" variant="ghost" onClick={() => setBrowseTemplates(false)}><ArrowLeftIcon /> Back to My Designs</Button>
              <span className="text-xs text-muted-foreground">Choose a template to save a private, editable copy in My Designs. It does not add a service moment or change any screen.</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <LookLibraryView onOpen={() => {}} scenePicker={{ purpose: "design", onChoose: (look, customize) => { void createFromTemplate(look, customize) } }} />
            </div>
          </div>
        ) : active ? (
          <DesignDocumentEditor
            key={active.id + ":" + active.revision}
            document={active}
            onSaved={onSaved}
            onReopen={reloadActive}
            onVersionCreated={onVersionCreated}
            onDuplicate={duplicateActive}
            onDirtyChange={onActiveDirtyChange}
          />
        ) : chosenDesign ? (
          <section className="m-auto flex max-w-lg flex-col items-center px-6 py-10 text-center" aria-labelledby="chosen-design-title">
            <Layers3Icon aria-hidden="true" className="size-8 text-muted-foreground" />
            <h3 ref={chosenDesignHeadingRef} id="chosen-design-title" tabIndex={-1} className="mt-3 text-base font-semibold">Added to My Designs</h3>
            <p role="status" className="mt-2 text-sm text-muted-foreground">“{chosenDesign.title}” is a private editable copy. Customize and save a draft here; Preview, Program and screens are unchanged.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button onClick={() => void open(chosenDesign.id)} disabled={loading || creating}>Customize this design</Button>
              <Button variant="outline" onClick={() => { setChosenDesign(null); setBrowseTemplates(true) }} disabled={creating}>Choose another template</Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">When ready, create an immutable version and choose it for a moment in Prepare. Only an explicit Take can change the public output.</p>
          </section>
        ) : (
          <div className="m-auto max-w-3xl px-6 py-8 text-center">
            <Layers3Icon className="mx-auto size-8 text-muted-foreground" />
            <h3 className="mt-3 text-base font-semibold">Choose a starting point</h3>
            <ol className="mt-4 grid grid-cols-1 gap-2 text-left sm:grid-cols-3">
              <li className="rounded-md border border-border p-3">
                <span className="text-xs font-bold">1 · Choose</span>
                <p className="mt-1 text-xs text-muted-foreground">Start blank or make a private editable copy of a scene template.</p>
              </li>
              <li className="rounded-md border border-border p-3">
                <span className="text-xs font-bold">2 · Customize</span>
                <p className="mt-1 text-xs text-muted-foreground">Edit the canvas and save a draft. Drafts stay out of Preview and Program.</p>
              </li>
              <li className="rounded-md border border-border p-3">
                <span className="text-xs font-bold">3 · Use in Prepare</span>
                <p className="mt-1 text-xs text-muted-foreground">Create an immutable version, choose it for a service moment, then use the explicit Take flow to publish.</p>
              </li>
            </ol>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button onClick={() => void createBlank()} disabled={creating}>Create a blank design</Button>
              <Button variant="outline" onClick={() => setBrowseTemplates(true)} disabled={creating}>Browse scene templates</Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">Design work stays private until a version is deliberately attached to a plan, approved and explicitly Taken.</p>
          </div>
        )}
      </main>
    </div>
  )
}

function summaryOf(document: DesignDocument): DesignSummary {
  return {
    id: document.id,
    title: document.title,
    kind: document.kind,
    revision: document.revision,
    latestVersion: document.latestVersion,
    updatedAt: document.updatedAt,
  }
}

function DesignVersionArtworkPreview({ version, pageId }: { version: DesignVersion; pageId?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const pageTitle = version.document
    ? designPages(version.document).find((page) => page.id === pageId)?.title ?? "Page 1"
    : "Page 1"

  useEffect(() => {
    let cancelled = false
    const render = async () => {
      setStatus("loading")
      const target = canvasRef.current
      const context = target?.getContext("2d")
      if (!target || !context) throw new Error("Canvas preview is unavailable on this computer.")
      context.clearRect(0, 0, target.width, target.height)
      if (!version.document) throw new Error("The saved design document is unavailable.")
      const page = designPages(version.document).find((candidate) => candidate.id === pageId)
      if (!page) throw new Error("This saved page is unavailable.")
      const pageScene = page.nodeId === version.document.scene.root
        ? version.document.scene
        : { ...version.document.scene, root: page.nodeId }
      const rendered = await renderSceneToCanvas(pageScene, { maxCssPx: 720, awaitFonts: false, imageCover: outputCoverPictures(version.document) })
      if (!rendered) throw new Error("The design renderer returned no artwork.")
      if (cancelled) return
      target.width = rendered.width
      target.height = rendered.height
      context.clearRect(0, 0, target.width, target.height)
      context.drawImage(rendered, 0, 0, target.width, target.height)
      setStatus("ready")
    }
    void render().catch(() => { if (!cancelled) setStatus("error") })
    return () => { cancelled = true }
  }, [version, pageId])

  return (
    <figure className="min-w-0">
      <div className="mx-auto aspect-video w-full max-w-[45rem] overflow-hidden rounded-md border border-border bg-muted/40">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Saved design ${version.title}, version ${version.version}, page ${pageTitle}`}
          aria-busy={status === "loading"}
          className="h-full w-full object-contain"
        />
      </div>
      {status === "loading" && <p role="status" className="mt-2 text-xs text-muted-foreground">Rendering the saved page…</p>}
      {status === "error" && <p role="alert" className="mt-2 text-xs text-destructive">The saved artwork preview could not be rendered here. The saved version is unchanged; check it in Prepare Preview before taking it live.</p>}
      <figcaption className="mt-2 text-xs text-muted-foreground">Private artwork preview · live sources are shown as static placeholders. This preview does not change Preview, Program, or any screen.</figcaption>
    </figure>
  )
}

/** Pick or customize a private copy of an immutable design version for the current Prepare moment. */
export function DesignVersionPicker({ onUse, onDirtyChange, useLabel, initialDesignId }: {
  onUse: (scene: Scene, version: DesignVersion, pageId?: string) => void
  useLabel?: string
  onDirtyChange?: (dirty: boolean) => void
  /** Open a newly created template document directly in the shared editor. */
  initialDesignId?: string
}) {
  const operatorName = useSettingsStore((state) => state.operatorName)
  const [documents, setDocuments] = useState<DesignSummary[]>([])
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState("")
  const [versions, setVersions] = useState<DesignVersion[]>([])
  const [versionsForId, setVersionsForId] = useState("")
  const [editing, setEditing] = useState<DesignDocument | null>(null)
  const [editingDirty, setEditingDirty] = useState(false)
  const [createdVersion, setCreatedVersion] = useState<DesignVersion | null>(null)
  const [createdPageId, setCreatedPageId] = useState("")
  const [previewVersion, setPreviewVersion] = useState<DesignVersion | null>(null)
  const [previewPageId, setPreviewPageId] = useState("")
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState("")
  const previewRequestId = useRef(0)
  const [editingError, setEditingError] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  useEffect(() => () => { previewRequestId.current += 1 }, [])

  useEffect(() => {
    let cancelled = false
    void designStore.list().then((items) => {
      if (cancelled) return
      const usable = items.filter((item) => item.kind !== "template")
      setDocuments(usable)
      setSelectedId(usable.find((item) => item.id === initialDesignId)?.id ?? usable[0]?.id ?? "")
    }).catch((failure) => {
      if (!cancelled) setError("Saved designs could not be loaded: " + messageOf(failure))
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [initialDesignId])

  useEffect(() => {
    if (!initialDesignId) return
    let cancelled = false
    void designStore.get(initialDesignId).then((document) => {
      if (cancelled) return
      if (!document) throw new Error("This new design is no longer available.")
      setSelectedId(document.id)
      setEditing(document)
      setEditingDirty(false)
      setCreatedVersion(null)
      previewRequestId.current += 1
      setPreviewVersion(null)
      setPreviewLoading(false)
      onDirtyChange?.(false)
    }).catch((failure) => {
      if (!cancelled) setError("The new design could not be opened: " + messageOf(failure))
    })
    return () => { cancelled = true }
  }, [initialDesignId, onDirtyChange])

  useEffect(() => {
    let cancelled = false
    if (!selectedId) return
    void designStore.listVersions(selectedId).then((items) => {
      if (!cancelled) {
        setVersions(items)
        setVersionsForId(selectedId)
      }
    }).catch((failure) => {
      if (!cancelled) setError("Saved versions could not be loaded: " + messageOf(failure))
    })
    return () => { cancelled = true }
  }, [selectedId])

  const visibleVersions = versionsForId === selectedId ? versions : []
  const filteredDocuments = documents.filter((item) => item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const createdPages = createdVersion?.document ? designPages(createdVersion.document) : []
  const effectiveCreatedPageId = createdVersion?.document?.pages?.some((page) => page.id === createdPageId)
    ? createdPageId
    : createdVersion?.document?.pages?.[0]?.id
  const createdCompatibility = useMemo(
    () => createdVersion ? pinnedSceneForVersion(createdVersion, operatorName, effectiveCreatedPageId) : null,
    [createdVersion, operatorName, effectiveCreatedPageId],
  )
  const customizeCopy = async (listed: DesignVersion) => {
    previewRequestId.current += 1
    setBusy(true)
    setError("")
    setEditingError("")
    setCreatedVersion(null)
    setPreviewVersion(null)
    setPreviewPageId("")
    setPreviewLoading(false)
    setPreviewError("")
    try {
      const copy = await designStore.duplicate(listed.designId, listed.version, listed.title + " copy")
      setEditing(copy)
      setEditingDirty(false)
      onDirtyChange?.(false)
    } catch (failure) {
      setError("A private design copy could not be created: " + messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  const reopenEditing = async () => {
    if (!editing) return
    const latest = await designStore.get(editing.id)
    if (!latest) throw new Error("The saved design copy is no longer available.")
    setEditing(latest)
  }

  const onEditingVersionCreated = async (listed: DesignVersion) => {
    setBusy(true)
    setEditingError("")
    try {
      const version = listed.document
        ? listed
        : await designStore.getVersion(listed.designId, listed.version)
      if (!version?.document) throw new Error("The saved version could not be reopened with its design document.")
      setCreatedVersion(version)
      setEditing((current) => current ? { ...current, latestVersion: version.version } : current)
    } catch (failure) {
      setEditingError("The version was saved, but its document could not be loaded: " + messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  const attachResolvedVersion = async (version: DesignVersion, pageId?: string) => {
    const converted = pinnedSceneForVersion(version, operatorName, pageId)
    if (!converted.scene) {
      const reason = converted.issues.map((issue) => issue.message).join("; ")
      setError(reason || "This version cannot be shown as a Rhema scene.")
      return
    }
    setBusy(true)
    setError("")
    try {
      const resolved = await hydrateDesignSceneMedia(converted.scene)
      if (!resolved.scene) throw new Error(resolved.issue ?? "A Library asset is unavailable on this computer.")
      onUse(resolved.scene, version, pageId)
      setPreviewVersion(null)
      setPreviewPageId("")
    } catch (failure) {
      setError("This version cannot be used: " + messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="flex min-h-[30rem] flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
          <div>
            <Button size="xs" variant="ghost" onClick={() => {
              setEditing(null)
              setCreatedVersion(null)
              setEditingError("")
              setEditingDirty(false)
              onDirtyChange?.(false)
            }} disabled={editingDirty || busy}>Back to saved versions</Button>
            {editingDirty && <p role="status" className="mt-1 px-2 text-[0.6875rem] text-amber-700">Save this draft before returning to the version list or closing this picker.</p>}
          </div>
          {createdVersion && createdCompatibility && (
            createdCompatibility.scene ? (
              <Button size="sm" onClick={() => {
                if (editingDirty) return
                onDirtyChange?.(false)
                void attachResolvedVersion(createdVersion, effectiveCreatedPageId)
              }} disabled={editingDirty || busy}>{useLabel ?? `Use version ${createdVersion.version} in Prepare`}</Button>
            ) : (
              <div role="status" className="max-w-xl rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
                <p className="font-semibold">Version {createdVersion.version} is saved, but cannot be used in Prepare yet.</p>
                <ul className="mt-1 list-disc pl-5">{createdCompatibility.issues.map((issue) => <li key={issue.nodeId + issue.message}>{issue.message}</li>)}</ul>
              </div>
            )
          )}
          {createdVersion && createdPages.length > 1 && (
            <label className="flex min-w-48 flex-col gap-1 text-xs font-semibold">Version page
              <select aria-label="Created version page" value={effectiveCreatedPageId ?? ""} onChange={(event) => setCreatedPageId(event.currentTarget.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm font-normal">
                {createdPages.map((page, index) => <option key={page.id} value={page.id}>{index + 1}. {page.title}</option>)}
              </select>
            </label>
          )}
        </div>
        {editingError && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">{editingError}</p>}
        <div className="min-h-[28rem] flex-1 overflow-y-auto">
          <DesignDocumentEditor
            key={editing.id + ":" + editing.revision}
            document={editing}
            onSaved={setEditing}
            onReopen={reopenEditing}
            onVersionCreated={(version) => { void onEditingVersionCreated(version) }}
            onDuplicate={async () => {}}
            onDirtyChange={(dirty) => {
              setEditingDirty(dirty)
              onDirtyChange?.(dirty)
            }}
          />
        </div>
      </div>
    )
  }

  const previewSavedVersion = async (listed: DesignVersion) => {
    const requestId = ++previewRequestId.current
    setPreviewLoading(true)
    setPreviewError("")
    setPreviewVersion(null)
    setPreviewPageId("")
    try {
      const version = await designStore.getVersion(listed.designId, listed.version)
      if (requestId !== previewRequestId.current) return
      if (!version?.document) throw new Error("This saved design version is no longer available on this computer.")
      setPreviewVersion(version)
      setPreviewPageId(designPages(version.document)[0]?.id ?? "")
    } catch (failure) {
      if (requestId === previewRequestId.current) setPreviewError("This version could not be previewed: " + messageOf(failure))
    } finally {
      if (requestId === previewRequestId.current) setPreviewLoading(false)
    }
  }

  const previewPages = previewVersion?.document ? designPages(previewVersion.document) : []
  const effectivePreviewPageId = previewPages.some((page) => page.id === previewPageId)
    ? previewPageId
    : previewPages[0]?.id
  const previewPage = previewPages.find((page) => page.id === effectivePreviewPageId)
  const finalUseLabel = useLabel ?? (previewPages.length > 1 ? "Use selected page in Prepare" : "Use in Prepare")
  const changeQuery = (nextQuery: string) => {
    previewRequestId.current += 1
    const matches = documents.filter((item) => item.title.toLocaleLowerCase().includes(nextQuery.trim().toLocaleLowerCase()))
    setQuery(nextQuery)
    if (!matches.some((item) => item.id === selectedId)) setSelectedId(matches[0]?.id ?? "")
    setPreviewVersion(null)
    setPreviewPageId("")
    setPreviewLoading(false)
    setPreviewError("")
  }

  return (
    <div className="flex min-h-[20rem] flex-col gap-3">
      <p className="text-xs text-muted-foreground">Choose a saved version for this moment. Rhema adds a pinned scene to the service plan; Preview can show it, and Program stays unchanged until someone explicitly Takes it. Versions with features Rhema scenes cannot render yet remain saved but cannot be used in Prepare.</p>
      {documents.length > 0 && (
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-semibold">Search saved designs
          <Input type="search" aria-label="Search saved designs" value={query} onChange={(event) => changeQuery(event.currentTarget.value)} placeholder="Search by design name" className="h-9 text-sm font-normal" />
        </label>
        {filteredDocuments.length > 0 && <label className="flex flex-col gap-1 text-xs font-semibold">Design
          <select aria-label="Saved design" value={selectedId} onChange={(event) => { previewRequestId.current += 1; setError(""); setPreviewVersion(null); setPreviewLoading(false); setPreviewError(""); setSelectedId(event.currentTarget.value) }} className="h-9 rounded-md border border-input bg-background px-2 text-sm font-normal">
            {filteredDocuments.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </label>}
      </div>
      )}
      {loading && <p className="text-xs text-muted-foreground">Loading saved designs…</p>}
      {!loading && documents.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-4 text-center">
          <p className="text-sm font-semibold">No saved design versions yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Create a design in Design → My Designs, save its draft and create a version first.</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => useShellStore.getState().openDesign("my-designs")}>Open My Designs</Button>
        </div>
      )}
      {!loading && documents.length > 0 && filteredDocuments.length === 0 && <p role="status" className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No saved designs match this search.</p>}
      {!loading && selectedId && versionsForId !== selectedId && !error && <p className="text-xs text-muted-foreground">Loading saved versions…</p>}
      {!loading && selectedId && versionsForId === selectedId && visibleVersions.length === 0 && (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">This design has no saved versions yet. Save a draft and create a version in Design → My Designs.</p>
      )}
      {visibleVersions.length > 0 && (
      <div className="divide-y divide-border rounded-md border border-border">
          {visibleVersions.map((version) => (
            <div key={version.version} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold">Version {version.version}{version.note ? " · " + version.note : ""}</p>
                <p className="text-[0.6875rem] text-muted-foreground">Saved {new Date(version.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="xs" variant="outline" onClick={() => void customizeCopy(version)} disabled={busy || previewLoading}>Customize a copy</Button>
                <Button size="xs" onClick={() => void previewSavedVersion(version)} disabled={busy || previewLoading}>Preview version {version.version}</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {previewLoading && <p role="status" aria-live="polite" className="text-xs text-muted-foreground">Loading the saved version for preview…</p>}
      {previewError && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">{previewError}</p>}
      {previewVersion?.document && previewPage && (
        <section aria-label="Saved design version preview" className="grid gap-3 rounded-md border border-border bg-muted/20 p-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(14rem,0.8fr)]">
          <DesignVersionArtworkPreview version={previewVersion} pageId={effectivePreviewPageId} />
          <div className="flex flex-col gap-3">
            <div>
              <h3 className="text-sm font-semibold">{previewVersion.title} · version {previewVersion.version}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{previewPage.title}{previewVersion.note ? ` · ${previewVersion.note}` : ""}</p>
            </div>
            {previewPages.length > 1 && <label className="flex flex-col gap-1 text-xs font-semibold">Choose a page
              <select aria-label="Preview page" value={effectivePreviewPageId ?? ""} onChange={(event) => setPreviewPageId(event.currentTarget.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm font-normal">
                {previewPages.map((page, index) => <option key={page.id} value={page.id}>{index + 1}. {page.title}</option>)}
              </select>
            </label>}
            <p className="text-xs text-muted-foreground">Using this version pins it to the selected moment. It does not publish to Program; Take stays explicit.</p>
            <div className="mt-auto flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void attachResolvedVersion(previewVersion, effectivePreviewPageId)} disabled={busy || !effectivePreviewPageId}>{finalUseLabel}</Button>
              <Button size="sm" variant="outline" onClick={() => { previewRequestId.current += 1; setPreviewVersion(null); setPreviewPageId(""); setPreviewError("") }} disabled={busy}>Back to saved versions</Button>
            </div>
          </div>
        </section>
      )}
      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">{error}</p>}
    </div>
  )
}
