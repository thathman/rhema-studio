import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowDownIcon, ArrowUpIcon, CircleIcon, CopyIcon, EyeIcon, EyeOffIcon, PlusIcon, Redo2Icon, SaveIcon, SquareIcon, TextIcon, Trash2Icon, Undo2Icon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { designStore, type DesignDocument, type DesignInput, type DesignVersion } from "@/design-engine/design-store"
import { designPages, designToScene, type RhemaBinding, type RhemaDesignPage } from "@/design-engine/rhema-scene"
import { createColorLayer, createLiveFeedLayer } from "@/design-engine/design-document-utils"
import { createSaraswatiEditorStore, getNodeBounds, pointerDown, pointerMove, pointerUp, type SaraswatiCommand, type SaraswatiPointerState } from "@/vendor/avnac/saraswati"
import { renderSceneToCanvas } from "@/vendor/avnac/renderer/offscreen-render"
import type { SaraswatiEllipseNode, SaraswatiGroupNode, SaraswatiNode, SaraswatiRenderableNode, SaraswatiScene, SaraswatiTextNode } from "@/vendor/avnac/saraswati"
import { cn } from "@/lib/utils"
import { CONTENT_NAMES } from "@/lib/content-names"
import { CONTENT_TYPES, type ContentType } from "@/types/broadcast"
import type { BroadcastOutputLanguage } from "@/types/broadcast-output"
import { useSettingsStore } from "@/stores/settings-store"
import { useMediaStore } from "@/stores/media-store"
import type { MediaAssetStatus } from "@/types"

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

function layerIds(scene: SaraswatiScene, rootId = scene.root): string[] {
  const out: string[] = []
  const walk = (id: string) => {
    const node = scene.nodes[id]
    if (!node) return
    if (node.type === "group") node.children.forEach(walk)
    else out.push(id)
  }
  walk(rootId)
  return out
}

function stableId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
}

type PictureBindingSnapshot = Record<string, { mediaId?: string; imageUrl?: string }>

function pictureBindingSnapshot(scene: SaraswatiScene, bindings: Record<string, RhemaBinding>): PictureBindingSnapshot {
  const snapshot: PictureBindingSnapshot = {}
  for (const [id, node] of Object.entries(scene.nodes)) {
    const binding = bindings[id]
    if (node.type === "image" && binding?.kind === "picture") {
      snapshot[id] = { mediaId: binding.mediaId, imageUrl: binding.imageUrl }
    }
  }
  return snapshot
}

function applyPictureBindingSnapshot(
  bindings: Record<string, RhemaBinding>,
  snapshot: PictureBindingSnapshot,
): Record<string, RhemaBinding> {
  let next = bindings
  for (const [id, picture] of Object.entries(snapshot)) {
    const existing = bindings[id]
    if (existing?.kind === "picture" && existing.mediaId === picture.mediaId && existing.imageUrl === picture.imageUrl) continue
    if (next === bindings) next = { ...bindings }
    next[id] = { ...existing, id, kind: "picture", ...picture }
  }
  return next
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
  const [pageMetadata, setPageMetadata] = useState(() => new Map<string, RhemaDesignPage>(designPages(document.document).map((page) => [page.nodeId, page])))
  const initialPages = Array.isArray(document.document.pages) ? document.document.pages : []
  const pageNodeIds = useRef(new Set(initialPages.map((page) => page.nodeId)))
  const [hasExplicitPages, setHasExplicitPages] = useState(initialPages.length > 0)
  const [activePageId, setActivePageId] = useState(initialPages[0]?.id ?? document.document.scene.root)
  const [bindings, setBindingsState] = useState(document.document.bindings)
  const bindingsRef = useRef(bindings)
  const setBindings = (update: Record<string, RhemaBinding> | ((current: Record<string, RhemaBinding>) => Record<string, RhemaBinding>)) => {
    const next = typeof update === "function" ? update(bindingsRef.current) : update
    bindingsRef.current = next
    setBindingsState(next)
  }
  const pictureBindingScenes = useRef(new WeakMap<SaraswatiScene, PictureBindingSnapshot>())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [versions, setVersions] = useState<DesignVersion[]>([])
  const [versionNote, setVersionNote] = useState("")
  const [conflicted, setConflicted] = useState(false)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState("")
  const [imagePickerOpen, setImagePickerOpen] = useState(false)
  const [imagePickerBusy, setImagePickerBusy] = useState(false)
  const [imagePickerMessage, setImagePickerMessage] = useState("")
  const [editorFlags, setEditorFlags] = useState({ canUndo: false, canRedo: false })
  const operatorName = useSettingsStore((state) => state.operatorName)
  const brandKit = useSettingsStore((state) => state.brandKit)
  const mediaAssets = useMediaStore((state) => state.assets)
  const mediaLoaded = useMediaStore((state) => state.loaded)
  const mediaError = useMediaStore((state) => state.error)
  const libraryPictures = useMemo(
    () => mediaAssets.filter((asset) => asset.kind === "image" && asset.present),
    [mediaAssets],
  )
  const pointerRef = useRef<SaraswatiPointerState | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    return editor.subscribe((next) => {
      setScene(next.scene)
      setEditorFlags({ canUndo: next.canUndo, canRedo: next.canRedo })
      const rootNode = next.scene.nodes[next.scene.root]
      const explicit = rootNode?.type === "group" && rootNode.children.length > 0 && rootNode.children.every((id) => {
        const node = next.scene.nodes[id]
        return pageNodeIds.current.has(id) && node?.type === "group"
      })
      setHasExplicitPages((current) => {
        if (explicit) return true
        return Array.isArray(document.document.pages) && document.document.pages.length ? current : false
      })
      const pictureBindings = pictureBindingScenes.current.get(next.scene)
      if (pictureBindings) setBindings((current) => applyPictureBindingSnapshot(current, pictureBindings))
    })
  }, [editor, document.document.pages])

  const pageRoot = scene.nodes[scene.root]
  const pages = useMemo<RhemaDesignPage[]>(() => {
    if (hasExplicitPages && pageRoot?.type === "group") {
      const resolved = pageRoot.children.flatMap((nodeId) => {
        const node = scene.nodes[nodeId]
        const saved = pageMetadata.get(nodeId)
        if (!saved || node?.type !== "group") return []
        return [{ ...saved, title: node.name?.trim() || saved.title }]
      })
      if (resolved.length) return resolved
    }
    return [{ id: scene.root, nodeId: scene.root, title: "Page 1" }]
  }, [hasExplicitPages, pageMetadata, pageRoot, scene])
  const activePage = pages.find((page) => page.id === activePageId) ?? pages[0]!
  const activeRootId = activePage.nodeId
  const pageScene = useMemo<SaraswatiScene>(
    () => activeRootId === scene.root ? scene : { ...scene, root: activeRootId },
    [activeRootId, scene],
  )
  const orderedIds = useMemo(() => layerIds(scene, activeRootId), [scene, activeRootId])
  const pagesForDocument = hasExplicitPages ? pages : undefined
  const designForEditor = useMemo(() => {
    return { ...document.document, pages: pagesForDocument, scene, bindings }
  }, [document.document, pagesForDocument, scene, bindings])
  // Keep bindings in editor state so Undo/Redo can restore deleted nodes with their Rhema data.
  // Orphaned bindings are removed only from the document sent to storage.
  const savedBindings = Object.fromEntries(
    Object.entries(bindings).filter(([id]) => layerIds(scene).includes(id)),
  )
  const selectedNode = selectedId ? scene.nodes[selectedId] : undefined
  const selectedRenderable = renderable(selectedNode) ? selectedNode : undefined
  const selectedPaintNode = selectedRenderable && paintNode(selectedRenderable) ? selectedRenderable : undefined
  const selectedBinding = selectedRenderable ? bindings[selectedRenderable.id] : undefined
  const issues = useMemo(() => designToScene({
    ...designForEditor,
    meta: { ...document.document.meta, name: title },
  }, activePage.id).issues, [designForEditor, document.document.meta, title, activePage.id])
  const dirty = title !== base.title ||
    JSON.stringify(scene) !== JSON.stringify(base.document.scene) ||
    JSON.stringify(savedBindings) !== JSON.stringify(base.document.bindings) ||
    JSON.stringify(pagesForDocument) !== JSON.stringify(base.document.pages)

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    let cancelled = false
    const draw = async () => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext("2d")
      if (!canvas || !ctx) return
      const rendered = await renderSceneToCanvas(pageScene, { multiplier: 1 })
      if (cancelled || !rendered) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(rendered, 0, 0, canvas.width, canvas.height)
      if (selectedId) {
        const selected = pageScene.nodes[selectedId]
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
  }, [pageScene, selectedId])

  useEffect(() => {
    void designStore.listVersions(document.id).then(setVersions).catch(() => setVersions([]))
  }, [document.id, document.latestVersion])

  const dispatch = (command: SaraswatiCommand) => {
    editor.dispatch(command)
  }
  const applyBrandTextFont = (fontFamily: string) => {
    if (selectedRenderable?.type !== "text" || document.kind === "template") return
    dispatch({ type: "SET_TEXT_FORMAT", id: selectedRenderable.id, fontFamily })
  }
  const applyBrandTextColor = (color: string) => {
    if (selectedRenderable?.type !== "text" || document.kind === "template") return
    dispatch({ type: "SET_TEXT_FORMAT", id: selectedRenderable.id, color: { type: "solid", color } })
  }
  const applyBrandFill = (color: string) => {
    if (!selectedPaintNode || document.kind === "template") return
    dispatch({ type: "SET_NODE_FILL", id: selectedPaintNode.id, fill: { type: "solid", color } })
  }
  const materializeFirstPage = () => {
    if (hasExplicitPages) return pages[0]
    const current = editor.getState().scene
    const root = current.nodes[current.root]
    if (!root || root.type !== "group") return undefined
    const pageId = stableId("page")
    const page: RhemaDesignPage = { id: pageId, nodeId: pageId, title: "Page 1" }
    const group: SaraswatiGroupNode = { id: pageId, type: "group", parentId: root.id, name: page.title, visible: true, opacity: 1, children: [] }
    pageNodeIds.current.add(pageId)
    setPageMetadata((current) => new Map(current).set(pageId, page))
    editor.beginBatch()
    dispatch({ type: "ADD_NODE", node: group })
    dispatch({ type: "SET_GROUP_CHILDREN", id: pageId, children: [...root.children] })
    dispatch({ type: "SET_GROUP_CHILDREN", id: root.id, children: [pageId] })
    editor.endBatch()
    setHasExplicitPages(true)
    setActivePageId(pageId)
    setSelectedId(null)
    return page
  }
  const addPage = () => {
    if (document.kind === "template") return
    if (!hasExplicitPages) materializeFirstPage()
    const current = editor.getState().scene
    const root = current.nodes[current.root]
    if (!root || root.type !== "group") return
    const pageId = stableId("page")
    const page: RhemaDesignPage = { id: pageId, nodeId: pageId, title: `Page ${root.children.length + 1}` }
    const group: SaraswatiGroupNode = { id: pageId, type: "group", parentId: root.id, name: page.title, visible: true, opacity: 1, children: [] }
    pageNodeIds.current.add(pageId)
    setPageMetadata((current) => new Map(current).set(pageId, page))
    dispatch({ type: "ADD_NODE", node: group })
    setHasExplicitPages(true)
    setActivePageId(pageId)
    setSelectedId(null)
  }
  const duplicatePage = () => {
    if (document.kind === "template") return
    const sourcePage = hasExplicitPages ? activePage : materializeFirstPage()
    if (!sourcePage) return
    const sourceScene = editor.getState().scene
    const root = sourceScene.nodes[sourceScene.root]
    if (!root || root.type !== "group") return
    const duplicateId = stableId("page")
    const duplicateTitle = `${sourcePage.title} copy`.slice(0, 80)
    const newBindings: Record<string, RhemaBinding> = {}
    const cloneNode = (sourceId: string, parentId: string, forcedId?: string): string | null => {
      const original = sourceScene.nodes[sourceId]
      if (!original) return null
      const id = forcedId ?? stableId("layer")
      const cloned: SaraswatiNode = original.type === "group"
        ? { ...original, id, parentId, name: sourceId === sourcePage.nodeId ? duplicateTitle : original.name, children: [] }
        : { ...original, id, parentId }
      dispatch({ type: "ADD_NODE", node: cloned })
      const binding = bindingsRef.current[sourceId]
      if (binding) newBindings[id] = { ...binding, id }
      if (original.type !== "group") return id
      const children = original.children.flatMap((childId) => {
        const child = cloneNode(childId, id)
        return child ? [child] : []
      })
      dispatch({ type: "SET_GROUP_CHILDREN", id, children })
      return id
    }
    editor.beginBatch()
    cloneNode(sourcePage.nodeId, root.id, duplicateId)
    editor.endBatch()
    setBindings((current) => ({ ...current, ...newBindings }))
    const duplicate: RhemaDesignPage = { id: duplicateId, nodeId: duplicateId, title: duplicateTitle }
    pageNodeIds.current.add(duplicateId)
    setPageMetadata((current) => new Map(current).set(duplicateId, duplicate))
    setHasExplicitPages(true)
    setActivePageId(duplicateId)
    setSelectedId(null)
  }
  const movePage = (direction: -1 | 1) => {
    const root = editor.getState().scene.nodes[scene.root]
    if (!root || root.type !== "group") return
    const children = [...root.children]
    const from = children.indexOf(activePage.nodeId)
    const to = from + direction
    if (from < 0 || to < 0 || to >= children.length) return
    ;[children[from], children[to]] = [children[to]!, children[from]!]
    dispatch({ type: "SET_GROUP_CHILDREN", id: root.id, children })
  }
  const deletePage = () => {
    if (pages.length <= 1 || document.kind === "template") return
    const index = pages.findIndex((page) => page.id === activePage.id)
    const nextPage = pages[index - 1] ?? pages[index + 1]
    dispatch({ type: "DELETE_NODE", id: activePage.nodeId })
    setActivePageId(nextPage?.id ?? scene.root)
    setSelectedId(null)
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
  const alignSelectedToPage = (
    axis: "horizontal" | "vertical",
    position: "start" | "center" | "end",
  ) => {
    if (!selectedRenderable) return
    const bounds = getNodeBounds(selectedRenderable)
    const current = axis === "horizontal" ? bounds.x : bounds.y
    const size = axis === "horizontal" ? bounds.width : bounds.height
    const pageSize = axis === "horizontal" ? scene.artboard.width : scene.artboard.height
    const target = position === "start"
      ? 0
      : position === "center"
        ? (pageSize - size) / 2
        : pageSize - size
    const delta = target - current
    if (axis === "horizontal") {
      if (delta !== 0) dispatch({ type: "MOVE_NODE", id: selectedRenderable.id, dx: delta, dy: 0 })
    } else if (delta !== 0) {
      dispatch({ type: "MOVE_NODE", id: selectedRenderable.id, dx: 0, dy: delta })
    }
  }
  const duplicateSelectedLayer = () => {
    if (!selectedRenderable) return
    const bounds = getNodeBounds(selectedRenderable)
    const horizontalDelta = bounds.x + bounds.width + 24 <= scene.artboard.width
      ? 24
      : bounds.x >= 24 ? -24 : 0
    const verticalDelta = bounds.y + bounds.height + 24 <= scene.artboard.height
      ? 24
      : bounds.y >= 24 ? -24 : 0
    const duplicateId = stableId("layer")
    const duplicate: SaraswatiRenderableNode = {
      ...selectedRenderable,
      id: duplicateId,
      name: `${selectedRenderable.name?.trim() || "Layer"} copy`.slice(0, 80),
    }
    editor.beginBatch()
    dispatch({ type: "ADD_NODE", node: duplicate })
    dispatch({ type: "MOVE_NODE", id: duplicateId, dx: horizontalDelta, dy: verticalDelta })
    editor.endBatch()
    const binding = bindingsRef.current[selectedRenderable.id]
    if (binding) {
      setBindings((current) => ({ ...current, [duplicateId]: { ...binding, id: duplicateId } }))
    }
    setSelectedId(duplicateId)
  }
  const updateFeedBinding = (patch: Partial<RhemaBinding>) => {
    if (!selectedRenderable) return
    const id = selectedRenderable.id
    setBindings((current) => {
      const binding = current[id]
      if (!binding || binding.kind !== "feed") return current
      return { ...current, [id]: { ...binding, ...patch } }
    })
  }
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
    const next = pointerDown(pageScene, event.pointerId, point.x, point.y)
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
    made.node.parentId = activeRootId
    setBindings((current) => ({ ...current, [made.node.id]: made.binding }))
    dispatch({ type: "ADD_NODE", node: made.node })
    setSelectedId(made.node.id)
  }
  const addTextLayer = () => {
    const id = "text-" + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2))
    const node: SaraswatiTextNode = {
      id,
      parentId: activeRootId,
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
    setBindings((current) => ({ ...current, [id]: { id, kind: "text", textBoxHeight: scene.artboard.height * 0.2 } }))
    dispatch({ type: "ADD_NODE", node })
    setSelectedId(id)
  }
  const addRectangleLayer = () => {
    const made = createColorLayer({
      x: Math.round(scene.artboard.width * 0.35),
      y: Math.round(scene.artboard.height * 0.35),
      color: "#3157a4",
      name: "Rectangle",
    })
    made.node.parentId = activeRootId
    setBindings((current) => ({ ...current, [made.node.id]: made.binding }))
    dispatch({ type: "ADD_NODE", node: made.node })
    setSelectedId(made.node.id)
  }
  const addEllipseLayer = () => {
    const id = "ellipse-" + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2))
    const node: SaraswatiEllipseNode = {
      id,
      parentId: activeRootId,
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
    setBindings((current) => ({ ...current, [id]: { id, kind: "ellipse" } }))
    dispatch({ type: "ADD_NODE", node })
    setSelectedId(id)
  }
  const openImagePicker = () => {
    setImagePickerOpen(true)
    setImagePickerMessage("")
    if (!mediaLoaded) void useMediaStore.getState().list()
  }
  const importPictures = async () => {
    setImagePickerBusy(true)
    setImagePickerMessage("")
    try {
      const results = await useMediaStore.getState().importFiles()
      if (!results) return
      const imported = results.filter((result) => result.status === "imported")
      const failures = results.filter((result) => result.status === "failed")
      if (imported.length) setImagePickerMessage("Pictures added to the Library. Choose one to add it to this design.")
      else if (failures.length) setImagePickerMessage(failures.map((result) => result.message).join(" "))
      else setImagePickerMessage("No pictures were added.")
    } catch (error) {
      setImagePickerMessage("The picture could not be added to the Library: " + errorMessage(error))
    } finally {
      setImagePickerBusy(false)
    }
  }
  const addLibraryPicture = async (asset: MediaAssetStatus) => {
    if (!asset.present) {
      setImagePickerMessage("That picture is no longer available in the Library. Refresh the list and try again.")
      return
    }
    setImagePickerBusy(true)
    setImagePickerMessage("")
    try {
      // Persist the content-addressed local asset URL in the design. The file name keeps the
      // media library's deletion guard effective and avoids copying image bytes into every version.
      const imageUrl = await useMediaStore.getState().fileUrl(asset.id)
      if (!imageUrl) throw new Error("The picture file is missing or could not be read.")

      const selectedImage = selectedRenderable?.type === "image" ? selectedRenderable : null
      if (selectedImage) {
        const sceneBeforeReplace = editor.getState().scene
        const bindingsBeforeReplace = bindingsRef.current
        pictureBindingScenes.current.set(
          sceneBeforeReplace,
          pictureBindingSnapshot(sceneBeforeReplace, bindingsBeforeReplace),
        )
        const replacementBinding: RhemaBinding = {
          ...bindingsBeforeReplace[selectedImage.id],
          id: selectedImage.id,
          kind: "picture",
          mediaId: asset.id,
          imageUrl,
        }
        updateNode({ ...selectedImage, src: imageUrl })
        const sceneAfterReplace = editor.getState().scene
        pictureBindingScenes.current.set(sceneAfterReplace, pictureBindingSnapshot(sceneAfterReplace, {
          ...bindingsBeforeReplace,
          [selectedImage.id]: replacementBinding,
        }))
        setBindings((current) => ({ ...current, [selectedImage.id]: replacementBinding }))
      } else {
        const sourceAspect = asset.width && asset.height && asset.width > 0 && asset.height > 0
          ? asset.width / asset.height
          : 16 / 9
        const aspect = Math.max(0.1, Math.min(10, sourceAspect))
        const maxWidth = scene.artboard.width * 0.5
        const maxHeight = scene.artboard.height * 0.5
        const width = Math.round(Math.min(maxWidth, maxHeight * aspect))
        const height = Math.round(width / aspect)
        const id = "image-" + globalThis.crypto.randomUUID()
        const node = {
          id,
          parentId: activeRootId,
          name: asset.name,
          visible: true,
          x: Math.round((scene.artboard.width - width) / 2),
          y: Math.round((scene.artboard.height - height) / 2),
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          opacity: 1,
          originX: "left" as const,
          originY: "top" as const,
          type: "image" as const,
          width,
          height,
          src: imageUrl,
          cropX: 0,
          cropY: 0,
          clipPath: null,
        }
        setBindings((current) => ({
          ...current,
          [id]: { id, kind: "picture", mediaId: asset.id, imageUrl },
        }))
        dispatch({ type: "ADD_NODE", node })
        setSelectedId(id)
      }
      setImagePickerOpen(false)
      setImagePickerMessage("")
      setMessage(selectedRenderable?.type === "image" ? "Library picture replaced. Save the draft to keep the change." : "Library picture added as a layer. Save the draft to keep the change.")
    } catch (error) {
      setImagePickerMessage("The picture could not be added to this design: " + errorMessage(error))
    } finally {
      setImagePickerBusy(false)
    }
  }
  const reorder = (direction: -1 | 1) => {
    if (!selectedId) return
    const root = scene.nodes[scene.nodes[selectedId]?.parentId ?? activeRootId]
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
      ...designForEditor,
      scene,
      bindings: savedBindings,
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
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2" aria-label="Design pages">
            <label className="flex min-w-40 flex-1 flex-col gap-1 text-[0.6875rem] font-semibold">Page
              <select aria-label="Design page" value={activePage.id} onChange={(event) => { setActivePageId(event.currentTarget.value); setSelectedId(null) }} className="h-8 rounded-md border border-input bg-background px-2 text-xs font-normal">
                {pages.map((page, index) => <option key={page.id} value={page.id}>{index + 1}. {page.title}</option>)}
              </select>
            </label>
            {hasExplicitPages ? (
              <label className="flex min-w-32 flex-1 flex-col gap-1 text-[0.6875rem] font-semibold">Page name
                <Input aria-label="Page name" value={activePage.title} maxLength={80} onChange={(event) => dispatch({ type: "SET_NODE_NAME", id: activePage.nodeId, name: event.currentTarget.value.slice(0, 80) })} className="h-8 text-xs font-normal" />
              </label>
            ) : <p className="max-w-56 text-[0.6875rem] text-muted-foreground">This saved design opens as one page. Add a page to make the layout multi-page.</p>}
            <div className="flex flex-wrap gap-1">
              <Button size="xs" variant="outline" onClick={addPage} disabled={document.kind === "template"} aria-label="Add page"><PlusIcon /> Add page</Button>
              <Button size="xs" variant="outline" onClick={duplicatePage} disabled={document.kind === "template"} aria-label="Duplicate page">Duplicate</Button>
              <Button size="icon-xs" variant="ghost" onClick={() => movePage(-1)} disabled={!hasExplicitPages || pages.findIndex((page) => page.id === activePage.id) <= 0} aria-label="Move page earlier"><ArrowUpIcon /></Button>
              <Button size="icon-xs" variant="ghost" onClick={() => movePage(1)} disabled={!hasExplicitPages || pages.findIndex((page) => page.id === activePage.id) >= pages.length - 1} aria-label="Move page later"><ArrowDownIcon /></Button>
              <Button size="icon-xs" variant="ghost" onClick={deletePage} disabled={!hasExplicitPages || pages.length <= 1 || document.kind === "template"} aria-label="Delete page"><Trash2Icon /></Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="xs" variant="outline" onClick={addTextLayer} disabled={document.kind === "template"}><TextIcon /> Text</Button>
            <Button size="xs" variant="outline" onClick={addRectangleLayer} disabled={document.kind === "template"}><SquareIcon /> Rectangle</Button>
            <Button size="xs" variant="outline" onClick={addEllipseLayer} disabled={document.kind === "template"}><CircleIcon /> Ellipse</Button>
            <Button size="xs" variant="outline" onClick={openImagePicker} disabled={document.kind === "template" || imagePickerBusy}>
              {selectedRenderable?.type === "image" ? "Replace image" : "Image from Library"}
            </Button>
            <Button size="xs" variant="outline" onClick={() => addLayer("feed")} disabled={document.kind === "template"}><PlusIcon /> Live content</Button>
            <Button size="xs" variant="outline" onClick={() => addLayer("color")} disabled={document.kind === "template"}><PlusIcon /> Colour layer</Button>
            <span className="ml-auto text-[0.6875rem] text-muted-foreground">Drag on canvas or focus a layer and use arrow keys; Shift + arrow moves 10 px.</span>
          </div>
          {imagePickerOpen && (
            <section aria-label="Image library" className="rounded-md border border-border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold">Pictures from your Library</h3>
                  <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">Choose a local image to add as an editable layer. It stays with this design when you save it.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="xs" variant="outline" onClick={() => void importPictures()} disabled={imagePickerBusy}>Import picture</Button>
                  <Button size="xs" variant="ghost" onClick={() => setImagePickerOpen(false)} disabled={imagePickerBusy}>Close</Button>
                </div>
              </div>
              {imagePickerMessage && <p role="status" className="mt-2 text-xs text-muted-foreground">{imagePickerMessage}</p>}
              {mediaError && libraryPictures.length === 0 && <p role="alert" className="mt-2 text-xs text-destructive">The Library pictures could not be loaded: {mediaError}</p>}
              {libraryPictures.length ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {libraryPictures.map((asset) => (
                    <li key={asset.id}>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => void addLibraryPicture(asset)}
                        disabled={imagePickerBusy}
                        aria-label={`${selectedRenderable?.type === "image" ? "Replace with" : "Add"} ${asset.name}${selectedRenderable?.type === "image" ? "" : " as image layer"}`}
                      >
                        {asset.name}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : !mediaError && (
                <p className="mt-3 rounded border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  No pictures are in the Library yet. Import a picture here, then choose it to add it to this design.
                </p>
              )}
            </section>
          )}
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
                <Button size="icon-xs" variant="ghost" onClick={duplicateSelectedLayer} aria-label="Duplicate selected layer"><CopyIcon /></Button>
                <Button size="icon-xs" variant="ghost" onClick={() => {
                  const id = selectedRenderable.id
                  dispatch({ type: "DELETE_NODE", id })
                  setSelectedId(null)
                }} aria-label="Delete selected layer"><Trash2Icon /></Button>
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
                <section className="space-y-2 border-t border-border pt-3" aria-label="Align selected layer">
                  <h4 className="text-[0.6875rem] font-semibold">Align to page</h4>
                  <div role="group" aria-label="Horizontal alignment" className="flex flex-wrap gap-1.5">
                    <Button size="xs" variant="outline" onClick={() => alignSelectedToPage("horizontal", "start")} aria-label="Align left to page">Left</Button>
                    <Button size="xs" variant="outline" onClick={() => alignSelectedToPage("horizontal", "center")} aria-label="Center horizontally on page">Center</Button>
                    <Button size="xs" variant="outline" onClick={() => alignSelectedToPage("horizontal", "end")} aria-label="Align right to page">Right</Button>
                  </div>
                  <div role="group" aria-label="Vertical alignment" className="flex flex-wrap gap-1.5">
                    <Button size="xs" variant="outline" onClick={() => alignSelectedToPage("vertical", "start")} aria-label="Align top to page">Top</Button>
                    <Button size="xs" variant="outline" onClick={() => alignSelectedToPage("vertical", "center")} aria-label="Center vertically on page">Middle</Button>
                    <Button size="xs" variant="outline" onClick={() => alignSelectedToPage("vertical", "end")} aria-label="Align bottom to page">Bottom</Button>
                  </div>
                </section>
                {selectedPaintNode && (
                  <label className="flex items-center justify-between gap-2 text-[0.6875rem] font-medium text-muted-foreground">Fill colour
                    {selectedPaintNode.fill.type === "solid"
                      ? <Input type="color" value={selectedPaintNode.fill.color} onChange={(event) => dispatch({ type: "SET_NODE_FILL", id: selectedPaintNode.id, fill: { type: "solid", color: event.currentTarget.value } })} className="h-8 w-14 p-1" />
                      : <span className="text-[0.6875rem]">Gradient preserved</span>}
                  </label>
                )}
                {(selectedRenderable.type === "text" || !!selectedPaintNode) && (
                  <section className="space-y-2 border-t border-border pt-3" aria-label="Brand Kit styles">
                    <h4 className="text-[0.6875rem] font-semibold">Brand Kit</h4>
                    <p className="text-[0.6875rem] text-muted-foreground">Color tokens replace this layer’s current color or fill, including a gradient fill, with a solid color copied into this draft. Later Brand Kit changes will not update this layer.</p>
                    {selectedRenderable.type === "text" ? (
                      <div className="flex flex-wrap gap-1.5">
                        <Button size="xs" variant="outline" aria-label="Apply Brand Kit heading font" disabled={document.kind === "template"} onClick={() => applyBrandTextFont(brandKit.fonts.heading)}>
                          Heading · {brandKit.fonts.heading}
                        </Button>
                        <Button size="xs" variant="outline" aria-label="Apply Brand Kit body font" disabled={document.kind === "template"} onClick={() => applyBrandTextFont(brandKit.fonts.body)}>
                          Body · {brandKit.fonts.body}
                        </Button>
                        <Button size="xs" variant="outline" aria-label="Apply Brand Kit text colour" disabled={document.kind === "template"} onClick={() => applyBrandTextColor(brandKit.colors.text)}>
                          <span aria-hidden="true" className="size-3 rounded-full border border-border" style={{ backgroundColor: brandKit.colors.text }} /> Text · {brandKit.colors.text}
                        </Button>
                        <Button size="xs" variant="outline" aria-label="Apply Brand Kit accent colour" disabled={document.kind === "template"} onClick={() => applyBrandTextColor(brandKit.colors.accent)}>
                          <span aria-hidden="true" className="size-3 rounded-full border border-border" style={{ backgroundColor: brandKit.colors.accent }} /> Accent · {brandKit.colors.accent}
                        </Button>
                      </div>
                    ) : selectedPaintNode && (
                      <div className="flex flex-wrap gap-1.5">
                        {(["primary", "accent", "text", "background"] as const).map((token) => {
                          const color = brandKit.colors[token]
                          return (
                            <Button key={token} size="xs" variant="outline" aria-label={`Apply Brand Kit ${token} fill`} disabled={document.kind === "template"} onClick={() => applyBrandFill(color)}>
                              <span aria-hidden="true" className="size-3 rounded-full border border-border" style={{ backgroundColor: color }} /> {token} · {color}
                            </Button>
                          )
                        })}
                      </div>
                    )}
                  </section>
                )}
                {selectedBinding?.kind === "feed" && (
                  <section className="space-y-3 border-t border-border pt-3" aria-label="Live content binding">
                    <fieldset className="space-y-2">
                      <legend className="text-[0.6875rem] font-semibold">What this follows</legend>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          aria-pressed={!selectedBinding.shows?.length}
                          onClick={() => updateFeedBinding({ shows: undefined })}
                          className={cn(
                            "rounded-full border px-2 py-1 text-[0.6875rem] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            !selectedBinding.shows?.length ? "border-primary bg-accent text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                          )}
                        >
                          Whatever is on air
                        </button>
                        {CONTENT_TYPES.map((source: ContentType) => {
                          const selected = !!selectedBinding.shows?.includes(source)
                          return (
                            <button
                              key={source}
                              type="button"
                              aria-pressed={selected}
                              aria-label={`Follow ${CONTENT_NAMES[source]}`}
                              onClick={() => {
                                const current = selectedBinding.shows ?? []
                                const next = selected
                                  ? current.filter((item) => item !== source)
                                  : [...current, source]
                                updateFeedBinding({ shows: next.length ? next : undefined })
                              }}
                              className={cn(
                                "rounded-full border px-2 py-1 text-[0.6875rem] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                selected ? "border-primary bg-accent text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                              )}
                            >
                              {CONTENT_NAMES[source]}
                            </button>
                          )
                        })}
                      </div>
                    </fieldset>
                    <label className="flex flex-col gap-1 text-[0.6875rem] font-medium text-muted-foreground">
                      Language
                      <select
                        aria-label="Live content language"
                        value={selectedBinding.language ?? ""}
                        onChange={(event) => updateFeedBinding({ language: (event.currentTarget.value || undefined) as BroadcastOutputLanguage | undefined })}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                      >
                        <option value="">Use each output’s language</option>
                        <option value="first">Primary language only</option>
                        <option value="second">Secondary language only</option>
                        <option value="both">Both available languages</option>
                      </select>
                    </label>
                    <p className="text-[0.6875rem] text-muted-foreground">These choices are saved with this design. The canvas shows a placeholder for live content; it does not preview the current program.</p>
                  </section>
                )}
                {selectedRenderable.type === "text" && (
                  <div className="space-y-3 border-t border-border pt-3">
                    <label className="flex flex-col gap-1 text-[0.6875rem] font-medium text-muted-foreground">Text content
                      <textarea aria-label="Text content" value={selectedRenderable.text} maxLength={2000} onChange={(event) => dispatch({ type: "SET_TEXT_CONTENT", id: selectedRenderable.id, text: event.currentTarget.value })} rows={4} className="min-h-20 resize-y rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                    </label>
                    <NumberField label="Font size" min={8} max={400} value={selectedRenderable.fontSize} onCommit={(value) => dispatch({ type: "SET_TEXT_FORMAT", id: selectedRenderable.id, fontSize: value })} />
                    <label className="flex flex-col gap-1 text-[0.6875rem] font-medium text-muted-foreground">Font family
                      <Input value={selectedRenderable.fontFamily} maxLength={120} onChange={(event) => dispatch({ type: "SET_TEXT_FORMAT", id: selectedRenderable.id, fontFamily: event.currentTarget.value })} className="h-8 text-xs text-foreground" />
                    </label>
                    <label className="flex items-center justify-between gap-2 text-[0.6875rem] font-medium text-muted-foreground">Text colour
                      {selectedRenderable.color.type === "solid"
                        ? <Input type="color" value={selectedRenderable.color.color} onChange={(event) => dispatch({ type: "SET_TEXT_FORMAT", id: selectedRenderable.id, color: { type: "solid", color: event.currentTarget.value } })} className="h-8 w-14 p-1" />
                        : <span className="text-[0.6875rem]">Gradient preserved</span>}
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
                ) : <span className="text-[0.6875rem]">Gradient is not supported for Rhema output</span>}
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
                    <p className="text-[0.6875rem] text-muted-foreground">{version.savedBy || "Main desk"} · {new Date(version.createdAt).toLocaleString()}</p>
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
