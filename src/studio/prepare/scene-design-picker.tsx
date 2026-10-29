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
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import { LookLibraryView } from "@/studio/design/look-library-view"
import { openProductionTab } from "@/studio/production/production-tab"
import { useShellStore } from "@/studio/shell-store"

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
        onClick={() => setOpen(true)}
        aria-label={`Choose a scene design for ${momentTitle}`}
      >
        Choose from Design…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-6xl flex-col overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Choose a scene for {momentTitle}</DialogTitle>
            <DialogDescription>
              {eventTitle} · choosing creates a copy and attaches it to this
              moment. This updates the service plan only; it does not change
              Program.
            </DialogDescription>
          </DialogHeader>
          <LookLibraryView
            onOpen={() => {}}
            scenePicker={{ onChoose: choose }}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
