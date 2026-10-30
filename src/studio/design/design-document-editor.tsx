import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowDownIcon, ArrowUpIcon, CircleIcon, EyeIcon, EyeOffIcon, PlusIcon, Redo2Icon, SaveIcon, TextIcon, Trash2Icon, Undo2Icon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { designStore, type DesignDocument, type DesignInput, type DesignVersion } from "@/design-engine/design-store"
import { designToScene } from "@/design-engine/rhema-scene"
import { createColorLayer, createLiveFeedLayer } from "@/design-engine/design-document-utils"
import { createSaraswatiEditorStore, getNodeBounds, pointerDown, pointerMove, pointerUp, type SaraswatiCommand, type SaraswatiPointerState } from "@/vendor/avnac/saraswati"
import { renderSceneToCanvas } from "@/vendor/avnac/renderer/offscreen-render"
import type { SaraswatiEllipseNode, SaraswatiNode, SaraswatiRenderableNode, SaraswatiScene, SaraswatiTextNode } from "@/vendor/avnac/saraswati"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/stores/settings-store"

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error && "message" in error) return String(error.message)
  return String(error)
}

function isRevisionConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "kind" in error && error.kind === "conflict"
}

function renderable(node: SaraswatiNode | undefined): node is SaraswatiRenderableNode {
  return !!node && node.type !== "group"
}

function paintNode(node: SaraswatiRenderableNode): node is Extract<SaraswatiRenderableNode, { type: "rect" | "ellipse" | "polygon" }> {
  return node.type === "rect" || node.type === "ellipse" || node.type === "polygon"
}

function layerIds(scene: SaraswatiScene): string[] {
  const out: string[] = []
  const walk = (id: string) => {
    const node = scene.nodes[id]
    if (!node) return
    if (node.type === "group") node.children.forEach(walk)
    else out.push(id)
  }
  walk(scene.root)
  return out
}

function moveValue(node: SaraswatiRenderableNode, field: "x" | "y" | "width" | "height", value: number): SaraswatiRenderableNode {
  if (!Number.isFinite(value)) return node
  if (field === "x" || field === "y") return { ...node, [field]: value }
  if (!("width" in node)) return node
  return { ...node, [field]: Math.max(1, value) }
}

function NumberField({ label, value, min, max, onCommit }: {
  label: string
  value: number
  min?: number
  max?: number
  onCommit: (value: number) => void
}) {
  const commit = (raw: string) => {
    const parsed = Number(raw)
    if (Number.isFinite(parsed)) onCommit(Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min ?? -Number.MAX_SAFE_INTEGER, parsed)))
  }
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[0.6875rem] font-medium text-muted-foreground">
      {label}
      <Input key={label + ":" + value} type="number" min={min} max={max} defaultValue={String(Math.round(value))} onBlur={(event) => commit(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur() }} className="h-8 text-xs text-foreground" />
    </label>
  )
}

/** Canvas editor for Rhema-supported scene layers. Unsupported Avnac edits stay visible as issues. */
export function DesignDocumentEditor({
  document,
  onSaved,
  onReopen,
  onVersionCreated,
  onDuplicate,
  onDirtyChange,
}: {
  document: DesignDocument
  onSaved: (document: DesignDocument) => void
  onReopen: () => Promise<void>
  onVersionCreated: (version: DesignVersion) => void
  onDuplicate: () => Promise<void>
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [base, setBase] = useState(document)
  const [title, setTitle] = useState(document.title)
  const [editor] = useState(() => createSaraswatiEditorStore(document.document.scene))
  const [scene, setScene] = useState(() => editor.getState().scene)
  const [bindings, setBindings] = useState(document.document.bindings)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [versions, setVersions] = useState<DesignVersion[]>([])
  const [versionNote, setVersionNote] = useState("")
  const [conflicted, setConflicted] = useState(false)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState("")
  const [editorFlags, setEditorFlags] = useState({ canUndo: false, canRedo: false })
  const operatorName = useSettingsStore((state) => state.operatorName)
  const pointerRef = useRef<SaraswatiPointerState | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    return editor.subscribe((next) => {
      setScene(next.scene)
      setEditorFlags({ canUndo: next.canUndo, canRedo: next.canRedo })
    })
  }, [editor])

  const orderedIds = useMemo(() => layerIds(scene), [scene])
  const selectedNode = selectedId ? scene.nodes[selectedId] : undefined
  const selectedRenderable = renderable(selectedNode) ? selectedNode : undefined
  const selectedPaintNode = selectedRenderable && paintNode(selectedRenderable) ? selectedRenderable : undefined
  const issues = useMemo(() => designToScene({
    ...document.document,
    scene,
    bindings,
    meta: { ...document.document.meta, name: title },
  }).issues, [document.document, scene, bindings, title])
  const dirty = title !== base.title ||
    JSON.stringify(scene) !== JSON.stringify(base.document.scene) ||
    JSON.stringify(bindings) !== JSON.stringify(base.document.bindings)

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    let cancelled = false
    const draw = async () => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext("2d")
      if (!canvas || !ctx) return
      const rendered = await renderSceneToCanvas(scene, { multiplier: 1 })
      if (cancelled || !rendered) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(rendered, 0, 0, canvas.width, canvas.height)
      if (selectedId) {
        const selected = scene.nodes[selectedId]
        if (renderable(selected)) {
          const box = getNodeBounds(selected)
          ctx.save()
          ctx.strokeStyle = "#60a5fa"
          ctx.lineWidth = 4
          ctx.setLineDash([12, 8])
          ctx.strokeRect(box.x, box.y, box.width, box.height)
          ctx.restore()
        }
      }
    }
    void draw().catch(() => setMessage("The editor preview could not be drawn. Your document remains available to edit and save."))
    return () => { cancelled = true }
  }, [scene, selectedId])

  useEffect(() => {
    void designStore.listVersions(document.id).then(setVersions).catch(() => setVersions([]))
  }, [document.id, document.latestVersion])

  const dispatch = (command: SaraswatiCommand) => {
    editor.dispatch(command)
  }
  const moveByArrow = (event: React.KeyboardEvent<HTMLElement>, id: string | null) => {
    if (!id) return
    const step = event.shiftKey ? 10 : 1
    const delta = event.key === "ArrowLeft" ? [-step, 0] : event.key === "ArrowRight" ? [step, 0] : event.key === "ArrowUp" ? [0, -step] : event.key === "ArrowDown" ? [0, step] : null
    if (delta) {
      event.preventDefault()
      dispatch({ type: "MOVE_NODE", id, dx: delta[0]!, dy: delta[1]! })
    }
  }
  const updateNode = (node: SaraswatiRenderableNode) => dispatch({ type: "REPLACE_NODE", node })
  const commitNumber = (field: "x" | "y" | "width" | "height", value: number) => {
    if (selectedRenderable) updateNode(moveValue(selectedRenderable, field, value))
  }
  const pointInScene = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / Math.max(rect.width, 1)) * scene.artboard.width,
      y: ((event.clientY - rect.top) / Math.max(rect.height, 1)) * scene.artboard.height,
    }
  }
  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointInScene(event)
    const next = pointerDown(scene, event.pointerId, point.x, point.y)
    pointerRef.current = next.state
    setSelectedId(next.selectedIds[0] ?? null)
    if (next.selectedIds.length) {
      event.currentTarget.setPointerCapture(event.pointerId)
      editor.beginBatch()
    }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointerRef.current) return
    const point = pointInScene(event)
    const next = pointerMove(pointerRef.current, event.pointerId, point.x, point.y)
    pointerRef.current = next.state
    if (next.command) dispatch(next.command)
  }
  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointerRef.current) return
    editor.endBatch()
    pointerRef.current = pointerUp(pointerRef.current, event.pointerId)
  }
  const addLayer = (kind: "color" | "feed") => {
    const made = kind === "color"
      ? createColorLayer({ x: Math.round(scene.artboard.width * 0.35), y: Math.round(scene.artboard.height * 0.35) })
      : createLiveFeedLayer({ x: Math.round(scene.artboard.width * 0.1), y: Math.round(scene.artboard.height * 0.15) })
    setBindings((current) => ({ ...current, [made.node.id]: made.binding }))
    dispatch({ type: "ADD_NODE", node: made.node })
    setSelectedId(made.node.id)
  }
  const addTextLayer = () => {
    const id = "text-" + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2))
    const node: SaraswatiTextNode = {
      id,
      parentId: scene.root,
      name: "Text",
      visible: true,
      x: Math.round(scene.artboard.width * 0.1),
      y: Math.round(scene.artboard.height * 0.36),
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      originX: "left",
      originY: "top",
      type: "text",
      text: "Your text",
      width: Math.round(scene.artboard.width * 0.8),
      fontSize: 72,
      fontFamily: "Arial",
      fontWeight: "700",
      fontStyle: "normal",
      textAlign: "center",
      lineHeight: 1.2,
      underline: false,
      color: { type: "solid", color: "#ffffff" },
      stroke: null,
      strokeWidth: 0,
    }
    dispatch({ type: "ADD_NODE", node })
    setSelectedId(id)
  }
  const addEllipseLayer = () => {
    const id = "ellipse-" + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2))
    const node: SaraswatiEllipseNode = {
      id,
      parentId: scene.root,
      name: "Ellipse",
      visible: true,
      x: Math.round(scene.artboard.width * 0.32),
      y: Math.round(scene.artboard.height * 0.3),
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      originX: "left",
      originY: "top",
      type: "ellipse",
      width: Math.round(scene.artboard.width * 0.36),
      height: Math.round(scene.artboard.height * 0.4),
      fill: { type: "solid", color: "#3157a4" },
      stroke: null,
      strokeWidth: 0,
    }
    dispatch({ type: "ADD_NODE", node })
    setSelectedId(id)
  }
  const reorder = (direction: -1 | 1) => {
    if (!selectedId) return
    const root = scene.nodes[scene.root]
    if (!root || root.type !== "group") return
    const children = [...root.children]
    const from = children.indexOf(selectedId)
    const to = from + direction
    if (from < 0 || to < 0 || to >= children.length) return
    ;[children[from], children[to]] = [children[to]!, children[from]!]
    dispatch({ type: "SET_GROUP_CHILDREN", id: root.id, children })
  }
  const input = (): DesignInput => ({
    title: title.trim(),
    kind: document.kind,
    document: {
      ...document.document,
      scene,
      bindings,
      meta: { ...document.document.meta, name: title.trim() },
    },
  })
  const saveDraft = async () => {
    if (document.kind === "template" || conflicted || !title.trim()) return
    setWorking(true)
    setMessage("")
    try {
      const saved = await designStore.saveDraft(document.id, base.revision, input())
      setBase(saved)
      setConflicted(false)
      setMessage("Draft saved. Screens and Program are unchanged.")
      onSaved(saved)
      toast.success("Design draft saved", { description: "Preview, Program and outputs are unchanged." })
    } catch (error) {
      if (isRevisionConflict(error)) {
        setConflicted(true)
        setMessage("This design changed on another desk. Reopen the saved version before continuing.")
      } else setMessage("Draft could not be saved: " + errorMessage(error))
    } finally {
      setWorking(false)
    }
  }
  const createVersion = async () => {
    if (dirty || conflicted || document.kind === "template") return
    setWorking(true)
    setMessage("")
    try {
      const version = await designStore.createVersion(document.id, base.revision, versionNote.trim() || undefined, operatorName.trim() || undefined)
      setVersionNote("")
      setVersions((current) => [version, ...current.filter((item) => item.version !== version.version)])
      setMessage("Version " + version.version + " saved. It will not change any screen or service until you choose it.")
      onVersionCreated(version)
    } catch (error) {
      if (isRevisionConflict(error)) {
        setConflicted(true)
        setMessage("This design changed on another desk. Reopen the saved version before creating a version.")
      } else setMessage("Version could not be created: " + errorMessage(error))
    } finally {
      setWorking(false)
    }
  }
  const reopen = async () => {
    setWorking(true)
    try {
      await onReopen()
    } catch (error) {
      setMessage("The latest saved version could not be reopened: " + errorMessage(error))
      setWorking(false)
    }
  }

  return (
    <div className="flex h-full min-h-[32rem] min-w-0 flex-col">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <label className="sr-only" htmlFor="design-document-title">Design name</label>
          <Input id="design-document-title" value={title} maxLength={200} onChange={(event) => setTitle(event.currentTarget.value)} className="h-9 max-w-xl text-base font-semibold" />
          <p className="mt-1 text-xs text-muted-foreground">Revision {base.revision} · {document.kind === "template" ? "Template copy required before editing" : versions.length ? versions.length + " saved " + (versions.length === 1 ? "version" : "versions") : "No immutable versions yet"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {document.kind === "template" ? (
            <Button onClick={() => void onDuplicate()} disabled={working}>Duplicate as design</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => editor.undo()} disabled={!editorFlags.canUndo || working} aria-label="Undo design edit"><Undo2Icon /> Undo</Button>
              <Button variant="outline" onClick={() => editor.redo()} disabled={!editorFlags.canRedo || working} aria-label="Redo design edit"><Redo2Icon /> Redo</Button>
              <Button variant="outline" onClick={() => void createVersion()} disabled={dirty || conflicted || working} title={dirty ? "Save the draft before creating an immutable version" : undefined}>Create version</Button>
              <Button onClick={() => void saveDraft()} disabled={!dirty || conflicted || working || !title.trim()}><SaveIcon /> Save draft</Button>
            </>
          )}
        </div>
      </header>
      {conflicted && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/5 px-4 py-2 text-xs"><span>{message}</span><Button size="xs" variant="outline" onClick={() => void reopen()} disabled={working}>Reopen saved version</Button></div>}
      {!conflicted && message && <p role="status" className="border-b border-border px-4 py-2 text-xs text-muted-foreground">{message}</p>}
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <section className="flex min-w-0 flex-col gap-2 p-3" aria-label="Design canvas">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="xs" variant="outline" onClick={addTextLayer} disabled={document.kind === "template"}><TextIcon /> Text</Button>
            <Button size="xs" variant="outline" onClick={addEllipseLayer} disabled={document.kind === "template"}><CircleIcon /> Ellipse</Button>
            <Button size="xs" variant="outline" onClick={() => addLayer("feed")} disabled={document.kind === "template"}><PlusIcon /> Live content</Button>
            <Button size="xs" variant="outline" onClick={() => addLayer("color")} disabled={document.kind === "template"}><PlusIcon /> Colour layer</Button>
            <span className="ml-auto text-[0.6875rem] text-muted-foreground">Drag on canvas or focus a layer and use arrow keys; Shift + arrow moves 10 px.</span>
          </div>
          <div className="relative mx-auto w-full max-w-5xl overflow-hidden rounded-md border border-border bg-neutral-950">
            <canvas
              ref={canvasRef}
              width={scene.artboard.width}
              height={scene.artboard.height}
              className="block aspect-video h-auto w-full touch-none"
              aria-label="Design canvas; select a layer and use arrow keys to move it"
              tabIndex={0}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={(event) => moveByArrow(event, selectedId)}
            />
          </div>
          <p className="text-[0.6875rem] text-muted-foreground">This is a private design draft. Saving it does not change Preview, Program or any output.</p>
          {issues.length > 0 && (
            <div role="status" className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
              <p className="font-semibold">Some Avnac features are not supported by Rhema scene output yet.</p>
              <p className="mt-1">This design can still be saved and versioned as a native draft. A version with these compatibility issues cannot be used in Prepare.</p>
              <ul className="mt-1 list-disc pl-5">{issues.map((issue) => <li key={issue.nodeId + issue.message}>{issue.message}</li>)}</ul>
            </div>
          )}
        </section>
        <aside className="flex min-h-0 flex-col border-t border-border lg:border-t-0 lg:border-l" aria-label="Design layers and properties">
          <div className="border-b border-border p-3">
            <h3 className="text-xs font-bold">Layers</h3>
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {[...orderedIds].reverse().map((id) => {
                const node = scene.nodes[id]
                if (!renderable(node)) return null
                return (
                  <div key={id} className={cn("flex items-center gap-1 rounded border px-1", selectedId === id ? "border-primary bg-accent" : "border-transparent")}>
                    <button type="button" className="min-w-0 flex-1 truncate px-1 py-1 text-left text-[0.6875rem] outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelectedId(id)} onFocus={() => setSelectedId(id)} onKeyDown={(event) => moveByArrow(event, id)}>{node.name || "Unnamed layer"}</button>
                    <button type="button" className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label={(node.visible ? "Hide " : "Show ") + (node.name || "layer")} onClick={() => dispatch({ type: "SET_NODE_VISIBLE", id, visible: !node.visible })}>{node.visible ? <EyeIcon className="size-3" /> : <EyeOffIcon className="size-3" />}</button>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold">Properties</h3>
              {selectedRenderable && <>
                <Button size="icon-xs" variant="ghost" onClick={() => reorder(1)} aria-label="Move layer forward"><ArrowUpIcon /></Button>
                <Button size="icon-xs" variant="ghost" onClick={() => reorder(-1)} aria-label="Move layer backward"><ArrowDownIcon /></Button>
                <Button size="icon-xs" variant="ghost" onClick={() => dispatch({ type: "DELETE_NODE", id: selectedRenderable.id })} aria-label="Delete selected layer"><Trash2Icon /></Button>
              </>}
            </div>
            {selectedRenderable ? (
              <div className="space-y-3">
                <label className="flex flex-col gap-1 text-[0.6875rem] font-medium text-muted-foreground">Layer name
                  <Input value={selectedRenderable.name ?? ""} maxLength={80} onChange={(event) => dispatch({ type: "SET_NODE_NAME", id: selectedRenderable.id, name: event.currentTarget.value })} className="h-8 text-xs text-foreground" />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <NumberField label="X" value={selectedRenderable.x} onCommit={(value) => commitNumber("x", value)} />
                  <NumberField label="Y" value={selectedRenderable.y} onCommit={(value) => commitNumber("y", value)} />
                  {"width" in selectedRenderable && <NumberField label="Width" min={1} max={scene.artboard.width * 2} value={selectedRenderable.width} onCommit={(value) => commitNumber("width", value)} />}
                  {"height" in selectedRenderable && <NumberField label="Height" min={1} max={scene.artboard.height * 2} value={selectedRenderable.height} onCommit={(value) => commitNumber("height", value)} />}
                  <NumberField label="Opacity %" min={0} max={100} value={selectedRenderable.opacity * 100} onCommit={(value) => dispatch({ type: "SET_NODE_OPACITY", id: selectedRenderable.id, opacity: value / 100 })} />
                </div>
                {selectedPaintNode && (
                  <label className="flex items-center justify-between gap-2 text-[0.6875rem] font-medium text-muted-foreground">Fill colour
                    {selectedPaintNode.fill.type === "solid"
                      ? <Input type="color" value={selectedPaintNode.fill.color} onChange={(event) => dispatch({ type: "SET_NODE_FILL", id: selectedPaintNode.id, fill: { type: "solid", color: event.currentTarget.value } })} className="h-8 w-14 p-1" />
                      : <span className="text-[0.625rem]">Gradient preserved</span>}
                  </label>
                )}
                {selectedRenderable.type === "text" && (
                  <div className="space-y-3 border-t border-border pt-3">
                    <label className="flex flex-col gap-1 text-[0.6875rem] font-medium text-muted-foreground">Text content
                      <textarea aria-label="Text content" value={selectedRenderable.text} onChange={(event) => dispatch({ type: "SET_TEXT_CONTENT", id: selectedRenderable.id, text: event.currentTarget.value })} rows={4} className="min-h-20 resize-y rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                    </label>
                    <NumberField label="Font size" min={8} max={400} value={selectedRenderable.fontSize} onCommit={(value) => dispatch({ type: "SET_TEXT_FORMAT", id: selectedRenderable.id, fontSize: value })} />
                    <label className="flex flex-col gap-1 text-[0.6875rem] font-medium text-muted-foreground">Font family
                      <Input value={selectedRenderable.fontFamily} maxLength={120} onChange={(event) => dispatch({ type: "SET_TEXT_FORMAT", id: selectedRenderable.id, fontFamily: event.currentTarget.value })} className="h-8 text-xs text-foreground" />
                    </label>
                    <label className="flex items-center justify-between gap-2 text-[0.6875rem] font-medium text-muted-foreground">Text colour
                      {selectedRenderable.color.type === "solid"
                        ? <Input type="color" value={selectedRenderable.color.color} onChange={(event) => dispatch({ type: "SET_TEXT_FORMAT", id: selectedRenderable.id, color: { type: "solid", color: event.currentTarget.value } })} className="h-8 w-14 p-1" />
                        : <span className="text-[0.625rem]">Gradient preserved</span>}
                    </label>
                    <label className="flex flex-col gap-1 text-[0.6875rem] font-medium text-muted-foreground">Alignment
                      <select aria-label="Text alignment" value={selectedRenderable.textAlign} onChange={(event) => dispatch({ type: "SET_TEXT_FORMAT", id: selectedRenderable.id, textAlign: event.currentTarget.value as SaraswatiTextNode["textAlign"] })} className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground">
                        <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-[0.6875rem] font-medium text-muted-foreground">Font weight
                      <select aria-label="Font weight" value={selectedRenderable.fontWeight} onChange={(event) => dispatch({ type: "SET_TEXT_FORMAT", id: selectedRenderable.id, fontWeight: event.currentTarget.value })} className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground">
                        <option value="400">Regular</option><option value="500">Medium</option><option value="600">Semibold</option><option value="700">Bold</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-[0.6875rem] font-medium text-muted-foreground">
                      <input type="checkbox" checked={selectedRenderable.fontStyle === "italic"} onChange={(event) => dispatch({ type: "SET_TEXT_FORMAT", id: selectedRenderable.id, fontStyle: event.currentTarget.checked ? "italic" : "normal" })} />
                      Italic
                    </label>
                    <label className="flex items-center gap-2 text-[0.6875rem] font-medium text-muted-foreground">
                      <input type="checkbox" checked={selectedRenderable.underline} onChange={(event) => dispatch({ type: "SET_TEXT_FORMAT", id: selectedRenderable.id, underline: event.currentTarget.checked })} />
                      Underline
                    </label>
                  </div>
                )}
              </div>
            ) : <p className="text-xs text-muted-foreground">Select a layer on the canvas or in this list to edit its placement.</p>}
            <div className="mt-5 border-t border-border pt-3">
              <h3 className="text-xs font-bold">Artboard</h3>
              <label className="mt-2 flex items-center justify-between gap-2 text-[0.6875rem] font-medium text-muted-foreground">Background colour
                {scene.artboard.bg.type === "solid" ? (
                  <Input type="color" value={scene.artboard.bg.color} onChange={(event) => dispatch({ type: "SET_ARTBOARD", bg: { type: "solid", color: event.currentTarget.value } })} className="h-8 w-14 p-1" />
                ) : <span className="text-[0.625rem]">Gradient is not supported for Rhema output</span>}
              </label>
            </div>
            <div className="mt-5 border-t border-border pt-3">
              <h3 className="text-xs font-bold">Saved versions</h3>
              <Input aria-label="Version note" value={versionNote} maxLength={200} onChange={(event) => setVersionNote(event.currentTarget.value)} placeholder="Optional note for the next version" className="mt-2 h-8 text-xs" />
              {versions.length === 0 ? (
                <p className="mt-2 text-[0.6875rem] text-muted-foreground">No immutable version yet. Save the draft, then create a version to use it in Prepare.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {versions.map((version) => <li key={version.version} className="rounded border border-border px-2 py-1.5">
                    <p className="text-[0.6875rem] font-semibold">Version {version.version}{version.note ? " · " + version.note : ""}</p>
                    <p className="text-[0.625rem] text-muted-foreground">{version.savedBy || "Main desk"} · {new Date(version.createdAt).toLocaleString()}</p>
                  </li>)}
                </ul>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
