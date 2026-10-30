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
import type { DesignVersion } from "@/design-engine/design-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import { LookLibraryView } from "@/studio/design/look-library-view"
import { DesignVersionPicker } from "@/studio/design/design-documents-workspace"
import { openProductionTab } from "@/studio/production/production-tab"
import { useShellStore } from "@/studio/shell-store"
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

  const attachSavedVersion = (scene: Scene, version: DesignVersion) => {
    const queueItem = useQueueStore.getState().items.find((item) => item.id === momentId)
    if (!queueItem) {
      setOpen(false)
      toast.error("This service moment is no longer available", {
        description: "Choose the scene again from the current event.",
      })
      return
    }

    useBroadcastStore.getState().saveScene(scene)
    useQueueStore.getState().updateItem(momentId, (item) => item.kind === "slide"
      ? { ...item, slide: { ...item.slide, designRef: { id: version.designId, version: version.version } } }
      : item)
    onSceneSelected(scene.id)
    setOpen(false)
    toast.success("Saved version added to the service plan", {
      description: `“${version.title} v${version.version}” is pinned to ${momentTitle}. Present marks it as planned for this Preview item; Program and screens remain unchanged until you explicitly Take it.`,
    })
  }

  const choose = (look: SceneLook, customize: boolean) => {
    const queueItem = useQueueStore
      .getState()
      .items.find((item) => item.id === momentId)
    if (!queueItem) {
      setOpen(false)
      toast.error("This service moment is no longer available", {
        description: "Choose the scene again from the current event.",
      })
      return
    }

    const state = useBroadcastStore.getState()
    const takenNames = [
      ...state.themes.map((theme) => theme.name),
      ...state.scenes.map((scene) => scene.name),
      ...state.lowerThirdStyles.map((style) => style.name),
    ]
    const added = adoptLook(look, { takenNames, library: libraryLooks() })
    if (!added.scene) return

    for (const theme of added.themes)
      useBroadcastStore.getState().saveTheme(theme)
    useBroadcastStore.getState().saveScene(added.scene)
    onSceneSelected(added.scene.id)
    setOpen(false)

    if (!customize) {
      toast.success("Scene added to the service plan", {
        description: `“${added.scene.name}” is attached to ${momentTitle}. No screen changed.`,
      })
      return
    }

    useShellStore.getState().setPrepareDesignReturn({
      serviceId: useServiceStore.getState().current?.id ?? null,
      eventId,
      momentId,
      eventTitle,
      momentTitle,
      sceneId: added.scene.id,
    })
    toast.success("Scene copy attached", {
      description: `Customize “${added.scene.name}” as a draft for ${momentTitle}. Program and outputs stay unchanged.`,
    })
    openProductionTab("programs", { sceneId: added.scene.id })
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => { setSource("templates"); setOpen(true) }}
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
          <div role="tablist" aria-label="Scene source" className="flex gap-1 border-b border-border">
            <button type="button" role="tab" aria-selected={source === "my-designs"} onClick={() => setSource("my-designs")} className="border-b-2 border-transparent px-3 py-2 text-xs font-semibold aria-selected:border-primary aria-selected:text-primary-text">My Designs</button>
            <button type="button" role="tab" aria-selected={source === "templates"} onClick={() => setSource("templates")} className="border-b-2 border-transparent px-3 py-2 text-xs font-semibold aria-selected:border-primary aria-selected:text-primary-text">Templates</button>
          </div>
          <div role="tabpanel" aria-label={source === "my-designs" ? "Saved design versions" : "Scene templates"} className="min-h-0 flex-1 overflow-y-auto">
            {source === "my-designs" ? (
              <DesignVersionPicker onDirtyChange={setDesignEditorDirty} onUse={attachSavedVersion} />
            ) : (
              <LookLibraryView onOpen={() => {}} scenePicker={{ onChoose: choose }} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
