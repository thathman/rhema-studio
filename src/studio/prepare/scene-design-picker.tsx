import { tablistKeys } from "@/lib/tablist-keys"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { libraryLooks } from "@/lib/design-packs"
import { adoptLook, type LibraryLook } from "@/lib/look-library"
import { designStore, type DesignVersion } from "@/design-engine/design-store"
import { pinnedSceneForVersion } from "@/design-engine/design-document-utils"
import { sceneToDesign } from "@/design-engine/rhema-scene"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { useSettingsStore } from "@/stores/settings-store"
import { projectRunOfShowEvents } from "@/lib/run-of-show"
import { LookLibraryView } from "@/studio/design/look-library-view"
import { DesignVersionPicker } from "@/studio/design/design-documents-workspace"
import type { Scene } from "@/types/scene"

type SceneLook = Extract<LibraryLook, { kind: "scene" }>

export function SceneDesignPicker({
  eventId,
  eventTitle,
  momentId,
  momentTitle,
  onSceneSelected,
}: {
  eventId: string
  eventTitle: string
  momentId: string
  momentTitle: string
  onSceneSelected: (sceneId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState<"my-designs" | "templates">("templates")
  const [designEditorDirty, setDesignEditorDirty] = useState(false)
  const [templateDesignId, setTemplateDesignId] = useState<string | undefined>()
  const [creatingTemplate, setCreatingTemplate] = useState(false)
  const [audienceMode, setAudienceMode] = useState<"all" | "selected">("all")
  const [selectedOutputIds, setSelectedOutputIds] = useState<string[]>([])
  const allOutputs = useBroadcastStore((state) => state.outputs)
  const congregationOutputs = allOutputs.filter((output) => (output.role ?? "congregation") === "congregation")

  const openPicker = () => {
    const item = useQueueStore.getState().items.find((candidate) => candidate.id === momentId)
    const savedOutputs = item?.kind === "slide" ? item.slide.designRef?.outputs ?? [] : []
    setAudienceMode(savedOutputs.length ? "selected" : "all")
    setSelectedOutputIds(savedOutputs)
    setTemplateDesignId(undefined)
    setSource("templates")
    setOpen(true)
  }

  const selectedOutputIdsMissing = audienceMode === "selected"
    ? selectedOutputIds.filter((id) => !congregationOutputs.some((output) => output.id === id))
    : []

  const momentIsCurrent = () => {
    const queue = useQueueStore.getState()
    const events = projectRunOfShowEvents(queue.items, queue.headers)
    return events.length > 0
      ? events.some((event) => event.id === eventId && event.moments.some((moment) => moment.id === momentId && moment.kind === "slide"))
      : queue.items.some((item) => item.id === momentId && item.kind === "slide")
  }

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && designEditorDirty) {
      toast.error("Save the design draft before closing", {
        description: "Your edits are still in this private copy. Save the draft or finish using a saved version first.",
      })
      return
    }
    setOpen(nextOpen)
    if (!nextOpen) setDesignEditorDirty(false)
  }

  const attachSavedVersion = (scene: Scene, version: DesignVersion, pageId?: string) => {
    if (!momentIsCurrent()) {
      setOpen(false)
      toast.error("This service moment is no longer available", {
        description: "Choose the scene again from the current event.",
      })
      return
    }

    const currentCongregation = useBroadcastStore.getState().outputs.filter((output) => (output.role ?? "congregation") === "congregation")
    const chosenOutputs = [...new Set(selectedOutputIds)].sort()
    if (audienceMode === "selected" && chosenOutputs.length === 0) {
      toast.error("Choose at least one congregation screen", { description: "Select one or more screens, or choose all congregation screens." })
      return
    }
    if (audienceMode === "selected" && chosenOutputs.some((id) => !currentCongregation.some((output) => output.id === id))) {
      toast.error("Screen list changed", { description: "One of the selected screens is no longer an available congregation output. Reopen this picker and choose the intended screens." })
      return
    }

    useBroadcastStore.getState().saveScene(scene)
    const pinnedPageId = pageId ?? scene.design?.pageId
    useQueueStore.getState().updateItem(momentId, (item) => item.kind === "slide"
      ? { ...item, slide: { ...item.slide, designRef: { id: version.designId, version: version.version, ...(pinnedPageId ? { pageId: pinnedPageId } : {}), ...(audienceMode === "selected" ? { outputs: chosenOutputs } : {}) } } }
      : item)
    onSceneSelected(scene.id)
    setOpen(false)
    toast.success("Saved version added to the service plan", {
      description: `“${version.title} v${version.version}” is pinned to ${momentTitle}. Present marks it as planned for this Preview item; Program and screens remain unchanged until you explicitly Take it.`,
    })
  }

  const choose = async (look: SceneLook, customize: boolean) => {
    if (!momentIsCurrent()) {
      setOpen(false)
      toast.error("This service moment is no longer available", {
        description: "Choose the scene again from the current event.",
      })
      return
    }

    if (creatingTemplate) return
    setCreatingTemplate(true)
    try {
      const state = useBroadcastStore.getState()
      const takenNames = [
        ...state.themes.map((theme) => theme.name),
        ...state.scenes.map((scene) => scene.name),
        ...state.lowerThirdStyles.map((style) => style.name),
      ]
      const adopted = adoptLook(look, { takenNames, library: libraryLooks() })
      if (!adopted.scene) return

      const design = await designStore.create({
        title: adopted.scene.name,
        kind: "design",
        document: sceneToDesign(adopted.scene),
      })

      if (customize) {
        for (const theme of adopted.themes) useBroadcastStore.getState().saveTheme(theme)
        setTemplateDesignId(design.id)
        setSource("my-designs")
        toast.success("Private design copy created", {
          description: `Customize “${design.title}”, save a draft, then create and use a version for ${momentTitle}. The service moment, Preview, Program and outputs are unchanged until you choose that version.`,
        })
        return
      }

      const version = await designStore.createVersion(
        design.id,
        design.revision,
        "Started from template",
        useSettingsStore.getState().operatorName.trim() || undefined,
      )
      const completeVersion = version.document
        ? version
        : await designStore.getVersion(version.designId, version.version)
      if (!completeVersion?.document) throw new Error("The template version could not be reopened on this computer.")
      const converted = pinnedSceneForVersion(completeVersion, useSettingsStore.getState().operatorName)
      if (!converted.scene) {
        const issues = converted.issues.map((issue) => issue.message).join("; ")
        throw new Error(issues || "This template version cannot be shown as a Rhema scene.")
      }

      for (const theme of adopted.themes) useBroadcastStore.getState().saveTheme(theme)
      attachSavedVersion(converted.scene, completeVersion, converted.scene.design?.pageId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error("The scene template could not be prepared", { description: message })
    } finally {
      setCreatingTemplate(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={openPicker}
        aria-label={`Choose a scene design for ${momentTitle}`}
      >
        Choose from Design…
      </Button>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-6xl flex-col overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Choose a scene for {momentTitle}</DialogTitle>
            <DialogDescription>
              {eventTitle} · choosing a saved version or template attaches a
              pinned scene to this moment. Present marks it as planned for this
              Preview item; Program and screen outputs stay unchanged until you
              explicitly Take it.
            </DialogDescription>
          </DialogHeader>
          <fieldset className="space-y-2 rounded-md border border-border bg-muted/20 p-3" aria-label="Designed moment audience">
            <legend className="px-1 text-xs font-semibold">Audience screens</legend>
            <p className="text-xs text-muted-foreground">Choose which congregation screens show this design when this moment is taken. No screen selection means all congregation screens, preserving older services.</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
              <label className="flex min-h-9 items-center gap-2"><input type="radio" name={`audience-${momentId}`} checked={audienceMode === "all"} onChange={() => setAudienceMode("all")} /> All congregation screens</label>
              <label className="flex min-h-9 items-center gap-2"><input type="radio" name={`audience-${momentId}`} checked={audienceMode === "selected"} onChange={() => { setAudienceMode("selected"); setSelectedOutputIds(congregationOutputs.map((output) => output.id)) }} /> Choose specific screens</label>
            </div>
            {audienceMode === "selected" && (
              <div role="group" aria-label="Choose designed moment screens" className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-2">
                {congregationOutputs.map((output) => (
                  <label key={output.id} className="flex min-h-9 items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      aria-label={`Include ${output.name}`}
                      checked={selectedOutputIds.includes(output.id)}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked
                        setSelectedOutputIds((current) => checked
                          ? [...new Set([...current, output.id])]
                          : current.filter((id) => id !== output.id))
                      }}
                    />
                    {output.name}
                  </label>
                ))}
                {congregationOutputs.length === 0 && <p role="status" className="text-xs text-muted-foreground">No congregation screens are configured on this computer.</p>}
                {selectedOutputIdsMissing.length > 0 && (
                  <div role="alert" className="flex basis-full flex-wrap items-center gap-2 text-xs text-destructive">
                    <span>Some previously selected screens are no longer configured.</span>
                    <Button size="xs" variant="outline" onClick={() => setSelectedOutputIds(congregationOutputs.map((output) => output.id))}>Replace with available screens</Button>
                  </div>
                )}
                {selectedOutputIds.length === 0 && <p role="alert" className="basis-full text-xs text-destructive">Select at least one available screen, or choose all congregation screens.</p>}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Changing the audience on an approved service changes its approval scope; refresh approval before taking the design.</p>
          </fieldset>
          <div onKeyDown={tablistKeys} role="tablist" aria-label="Scene source" className="flex gap-1 border-b border-border">
            <button type="button" role="tab" aria-selected={source === "my-designs"} disabled={designEditorDirty || creatingTemplate} onClick={() => setSource("my-designs")} className="border-b-2 border-transparent px-3 py-2 text-xs font-semibold aria-selected:border-primary aria-selected:text-primary-text disabled:cursor-not-allowed disabled:opacity-50">My Designs</button>
            <button type="button" role="tab" aria-selected={source === "templates"} disabled={designEditorDirty || creatingTemplate} onClick={() => setSource("templates")} className="border-b-2 border-transparent px-3 py-2 text-xs font-semibold aria-selected:border-primary aria-selected:text-primary-text disabled:cursor-not-allowed disabled:opacity-50">Templates</button>
          </div>
          <div role="tabpanel" aria-label={source === "my-designs" ? "Saved design versions" : "Scene templates"} className="min-h-0 flex-1 overflow-y-auto">
            {source === "my-designs" ? (
              <DesignVersionPicker initialDesignId={templateDesignId} onDirtyChange={setDesignEditorDirty} onUse={attachSavedVersion} />
            ) : (
              <>
                {creatingTemplate && <p role="status" className="mb-3 text-xs text-muted-foreground">Saving this template as a local design…</p>}
                <LookLibraryView onOpen={() => {}} scenePicker={{ onChoose: (look, customize) => { void choose(look, customize) } }} />
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
