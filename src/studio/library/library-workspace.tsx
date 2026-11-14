import { tablistKeys } from "@/lib/tablist-keys"
import { LibraryPreviewPane } from "@/studio/library/library-preview-pane"
import { useLibraryPreview } from "@/stores/library-preview-store"
import { useRundownSelection } from "@/studio/prepare/rundown-selection"
import { useEffect, useState } from "react"
import { PlusIcon, UploadIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { cleanTakeSteps, parseTakeStep, sceneStep } from "@/lib/item-intent"
import type { DesignVersion } from "@/design-engine/design-store"
import type { Scene } from "@/types/scene"
import { useBroadcastStore } from "@/stores/broadcast-store"
import type { OutlineHeader } from "@/lib/run-of-show"
import { useQueueStore } from "@/stores"
import { useServiceStore } from "@/stores/service-store"
import { SongLibrary } from "@/studio/library/song-library"
import { HymnBook } from "@/studio/library/hymn-book"
import { MediaLibrary } from "@/studio/library/media-library"
import { SongFiles } from "@/studio/library/library-blocks"
import { CollectionsPanel } from "@/studio/library/collections-panel"
import { LibraryFileBlock } from "@/studio/library/library-file-block"
import { SlideLibrary } from "@/studio/library/slide-library"
import { BibleLibrary } from "@/studio/library/bible-library"
import { DesignVersionPicker } from "@/studio/design/design-documents-workspace"
import type { LibrarySection, PrepareLibraryReturnContext } from "@/studio/shell-store"
import { useShellStore } from "@/studio/shell-store"
import {
  captureLibraryUseInvocation,
  headerIdFromLibraryTarget,
  isCurrentLibraryUseInvocation,
  libraryHeaderTarget,
  libraryTargetOwner,
  LIBRARY_END_OF_RUN_TARGET,
  useLibraryTargetStore,
  type LibraryItemUseHandler,
  type LibraryUseInvocation,
} from "@/studio/library/library-target-store"
import {
  isCurrentPrepareLibraryReturn,
  prepareLibraryReturnForHeader,
} from "@/studio/prepare/library-return"
import type { QueueItem } from "@/types"

const SECTIONS: ReadonlyArray<readonly [LibrarySection, string]> = [
  ["bible", "Bible"],
  ["songs", "Songs & ministrations"],
  ["hymns", "Hymn book"],
  ["slides", "Slides & announcements"],
  ["designs", "Visual designs"],
  ["media", "Pictures & videos"],
  ["audio", "Sounds"],
  ["collections", "Collections"],
  ["files", "Import & export"],
]

interface DestinationChoice {
  key: string
  label: string
  headerId: string | null
}

interface TargetRequest {
  item: QueueItem | null
  invocation: LibraryUseInvocation
}

function destinationChoices(headers: OutlineHeader[]): DestinationChoice[] {
  if (headers.length === 0) {
    return [{
      key: LIBRARY_END_OF_RUN_TARGET,
      label: "End of current run of show",
      headerId: null,
    }]
  }
  return headers
    .map((header, order) => ({ header, order }))
    .sort((a, b) => a.header.at - b.header.at || a.order - b.order)
    .map(({ header }) => {
      const kind = header.event
        ? "event"
        : header.type === "phase"
          ? "phase"
          : "group"
      return {
        key: libraryHeaderTarget(header.id),
        label: `End of ${kind} “${header.name}”`,
        headerId: header.id,
      }
    })
}

function rememberedDestinationIsValid(
  target: string | undefined,
  choices: DestinationChoice[],
): target is string {
  return !!target && choices.some((choice) => choice.key === target)
}

function sameDestinationContext(
  context: PrepareLibraryReturnContext | null,
  targetHeaderId: string,
  serviceId: string | null,
): context is PrepareLibraryReturnContext {
  return !!context &&
    context.targetHeaderId === targetHeaderId &&
    context.serviceId === serviceId &&
    isCurrentPrepareLibraryReturn(context)
}

/**
 * Your church's library. Standalone Use asks where the item belongs and remembers
 * that section per service. A Prepare caller keeps its exact event/placement context.
 */
export function LibraryWorkspace() {
  const section = useShellStore((s) => s.librarySection)
  // A section switch closes Library's preview (it was of the last section's item); nothing else moves.
  useEffect(() => () => useLibraryPreview.getState().clear(), [section])
  const setSection = useShellStore((s) => s.setLibrarySection)
  const prepareReturn = useShellStore((s) => s.prepareLibraryReturn)
  const currentService = useServiceStore((s) => s.current)
  const headers = useQueueStore((s) => s.headers)
  const ownerId = currentService?.id ?? "local-draft"
  const rememberedTarget = useLibraryTargetStore((s) => s.byServiceId[ownerId])
  // Bumped by "New song" in the page head: the song library opens its editor.
  const [newSong, setNewSong] = useState(0)
  const [newSlide, setNewSlide] = useState(0)
  const [designInvocation, setDesignInvocation] = useState<LibraryUseInvocation | null>(null)
  const [targetRequest, setTargetRequest] = useState<TargetRequest | null>(null)
  const [targetSelection, setTargetSelection] = useState("")
  const [targetSnapshot, setTargetSnapshot] = useState<PrepareLibraryReturnContext | null>(null)
  const [targetError, setTargetError] = useState<string | null>(null)
  const choices = destinationChoices(headers)
  const currentDestination = rememberedDestinationIsValid(rememberedTarget, choices)
    ? choices.find((choice) => choice.key === rememberedTarget) ?? null
    : choices.length === 1 ? choices[0] : null
  // Only one place an item can go: there is nothing to choose, so no chooser is offered.
  const realChoice = choices.length > 1
  const selectedDestination = choices.find((choice) => choice.key === targetSelection) ?? null

  const closeTargetChooser = () => {
    setTargetRequest(null)
    setTargetSelection("")
    setTargetSnapshot(null)
    setTargetError(null)
  }

  const openTargetChooser = (
    item: QueueItem | null,
    invocation: LibraryUseInvocation = captureLibraryUseInvocation(),
  ) => {
    const existing = item === null
      ? useLibraryTargetStore.getState().byServiceId[libraryTargetOwner(invocation)]
      : undefined
    const initialTarget = rememberedDestinationIsValid(existing, destinationChoices(useQueueStore.getState().headers))
      ? existing
      : ""
    const initialHeaderId = headerIdFromLibraryTarget(initialTarget)
    setTargetRequest({ item, invocation })
    setTargetSelection(initialTarget)
    setTargetSnapshot(initialHeaderId ? prepareLibraryReturnForHeader(initialHeaderId) : null)
    setTargetError(null)
  }

  const addItemAtTarget = (
    item: QueueItem,
    invocation: LibraryUseInvocation,
    target: DestinationChoice,
    context: PrepareLibraryReturnContext | null,
    rememberTarget: boolean,
  ): boolean => {
    if (!isCurrentLibraryUseInvocation(invocation)) {
      toast.error("The open service or Library caller changed", {
        description: "Nothing was added. Return to Library and choose the destination again.",
      })
      return false
    }
    if (target.headerId) {
      if (!sameDestinationContext(context, target.headerId, invocation.serviceId)) {
        toast.error("That destination changed", {
          description: "Nothing was added. Choose the event, phase or group again.",
        })
        return false
      }
    } else if (
      target.key !== LIBRARY_END_OF_RUN_TARGET ||
      useQueueStore.getState().headers.length !== 0
    ) {
      toast.error("The run of show changed", {
        description: "Nothing was added. Choose a current destination again.",
      })
      return false
    }

    const queue = useQueueStore.getState()
    const previousAddTarget = queue.addTarget
    let id: string | null = null
    try {
      queue.setAddTarget(target.headerId)
      id = useQueueStore.getState().addItem(item, "end")
    } catch (error) {
      toast.error("Could not add this item to the run of show", {
        description: error instanceof Error ? error.message : String(error),
      })
      return false
    } finally {
      useQueueStore.getState().setAddTarget(previousAddTarget)
    }
    if (!id) {
      toast.error("Could not add this item to the run of show")
      return false
    }
    const added = useQueueStore.getState().items.find((candidate) => candidate.id === id)
    if (!added) {
      toast.error("The item was added but could not be selected in Prepare")
      return false
    }

    if (context) {
      useShellStore.getState().setPrepareLibraryReturn({
        ...context,
        momentId: id,
        momentTitle: item.reference,
      })
    } else {
      useShellStore.getState().clearPrepareLibraryReturn()
    }
    // Planning only (#447): focus it in Prepare; Live's Preview and Program stay as they are.
    useRundownSelection.getState().focus(added.id)
    useShellStore.getState().setWorkspace("prepare")
    if (rememberTarget) {
      useLibraryTargetStore.getState().remember(libraryTargetOwner(invocation), target.key)
    }
    toast.success(`Added ${item.reference} to ${invocation.serviceTitle}`, {
      description: "It is open in Prepare. Live's Preview and Program are unchanged.",
    })
    return true
  }

  const useItem: LibraryItemUseHandler = (item, invocation) => {
    if (!isCurrentLibraryUseInvocation(invocation)) {
      toast.error("The open service or Library caller changed", {
        description: "Nothing was added. Return to the same service and open Library again.",
      })
      return
    }

    if (invocation.prepareReturn) {
      const target = destinationChoices(useQueueStore.getState().headers).find(
        (choice) => choice.headerId === invocation.prepareReturn!.targetHeaderId,
      )
      if (!target || !sameDestinationContext(
        invocation.prepareReturn,
        invocation.prepareReturn.targetHeaderId,
        invocation.serviceId,
      )) {
        useShellStore.getState().clearPrepareLibraryReturn()
        openTargetChooser(item, captureLibraryUseInvocation())
        return
      }
      addItemAtTarget(item, invocation, target, invocation.prepareReturn, false)
      return
    }

    const targetKey = useLibraryTargetStore.getState().byServiceId[libraryTargetOwner(invocation)]
    const currentChoices = destinationChoices(useQueueStore.getState().headers)
    // F9: ask only when there is a real choice. One destination (an empty run of show, or a single
    // section) is used straight away and remembered like a chosen one.
    const onlyChoice = currentChoices.length === 1 ? currentChoices[0] : null
    if (!rememberedDestinationIsValid(targetKey, currentChoices) && !onlyChoice) {
      openTargetChooser(item, invocation)
      return
    }
    const target = rememberedDestinationIsValid(targetKey, currentChoices)
      ? currentChoices.find((choice) => choice.key === targetKey)!
      : onlyChoice!
    const context = target.headerId ? prepareLibraryReturnForHeader(target.headerId) : null
    if (target.headerId && !sameDestinationContext(context, target.headerId, invocation.serviceId)) {
      openTargetChooser(item, invocation)
      return
    }
    // Only a real choice is remembered; the single destination is used without being stored as one.
    addItemAtTarget(item, invocation, target, context, rememberedDestinationIsValid(targetKey, currentChoices))
  }
  // The same handler, named for what it does (the Library preview's Add to service).
  const addToService = useItem

  const useDesignVersion = (scene: Scene, version: DesignVersion, pageId?: string) => {
    const context = designInvocation?.prepareReturn
    if (!designInvocation || !context?.eventId || !context.momentId ||
      !isCurrentLibraryUseInvocation(designInvocation) ||
      !isCurrentPrepareLibraryReturn(context)) {
      toast.error("The Prepare service or moment changed", {
        description: "Nothing was attached. Return to the intended moment in Prepare and open Library again.",
      })
      return
    }

    useBroadcastStore.getState().saveScene(scene)
    const pinnedPageId = pageId ?? scene.design?.pageId
    useQueueStore.getState().updateItem(context.momentId, (item) => ({
      ...item,
      scene_id: scene.id,
      ...(item.kind === "slide" ? {
        slide: { ...item.slide, designRef: { id: version.designId, version: version.version, ...(pinnedPageId ? { pageId: pinnedPageId } : {}) } },
      } : {}),
      // Follow the same plan behavior as Prepare's scene selector: replace an
      // already-armed shared scene, preserving output-specific Take overrides.
      on_take: item.on_take == null ? item.on_take : cleanTakeSteps(item.on_take).map((step) => {
        const parsed = parseTakeStep(step)
        return parsed?.kind === "scene" && parsed.outputId === null ? sceneStep(scene.id) : step
      }),
    }))
    useShellStore.getState().setPrepareLibraryReturn(context)
    useShellStore.getState().setWorkspace("prepare")
    setDesignInvocation(null)
    toast.success("Saved version added to the service plan", {
      description: `“${version.title} v${version.version}” is pinned to ${context.momentTitle}. Program and screens remain unchanged until an explicit Take.`,
    })
  }

  const selectDestination = (value: string) => {
    setTargetSelection(value)
    setTargetError(null)
    const headerId = headerIdFromLibraryTarget(value)
    setTargetSnapshot(headerId ? prepareLibraryReturnForHeader(headerId) : null)
  }

  const confirmDestination = () => {
    const request = targetRequest
    if (!request) return
    if (!isCurrentLibraryUseInvocation(request.invocation)) {
      setTargetError("The open service or Prepare caller changed. Cancel and start again.")
      return
    }
    const currentChoices = destinationChoices(useQueueStore.getState().headers)
    const target = currentChoices.find((choice) => choice.key === targetSelection)
    if (!target) {
      setTargetError("Choose a destination that still exists in this run of show.")
      return
    }
    if (target.headerId && !sameDestinationContext(
      targetSnapshot,
      target.headerId,
      request.invocation.serviceId,
    )) {
      setTargetError("That section changed while the chooser was open. Select it again.")
      return
    }
    if (!target.headerId && useQueueStore.getState().headers.length !== 0) {
      setTargetError("The run of show now has sections. Select the section where the item belongs.")
      return
    }
    if (request.item) {
      const added = addItemAtTarget(
        request.item,
        request.invocation,
        target,
        targetSnapshot,
        true,
      )
      if (!added) return
    } else {
      useLibraryTargetStore.getState().remember(
        libraryTargetOwner(request.invocation),
        target.key,
      )
      toast.success(`Destination saved for ${request.invocation.serviceTitle}`)
    }
    closeTargetChooser()
  }

  const prepareReturnIsCurrent = prepareReturn !== null && isCurrentPrepareLibraryReturn(prepareReturn)
  const contextualDestination = prepareReturnIsCurrent
    ? `Prepare destination · ${prepareReturn.targetHeaderTitle || "selected section"}`
    : null

  return (
    // A short window scrolls the page rather than crushing a section's list (#385: Slides' list was 16 px tall at 1024×700).
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 px-[29px] pt-[26px] pb-4 max-[1200px]:px-5">
        <div className="min-w-0">
          <h1 className="text-2xl leading-tight font-semibold tracking-tight">Library</h1>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            {section === "designs"
              ? "Browse and customize the same local, versioned design documents used in Design and Prepare. Draft saves stay private and do not change a screen."
              : "One searchable home for saved Scripture passages, songs, choir ministrations, the hymn book, slides, pictures and videos on this computer. Use adds a copy to the chosen run-of-show destination. Preview stays private until an authorized operator explicitly Takes it."}
          </p>
        </div>
        {section !== "designs" && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setSection("files")}><UploadIcon /> Import files</Button>
            {/* F9: "New song" belongs to Songs and Hymns; Slides gets "New slide"; other sections get neither. */}
            {(section === "songs" || section === "hymns") && <Button onClick={() => { setSection("songs"); setNewSong((n) => n + 1) }}><PlusIcon /> New song</Button>}
            {section === "slides" && <Button onClick={() => setNewSlide((n) => n + 1)}><PlusIcon /> New slide</Button>}
          </div>
        )}
      </header>

      {section !== "designs" && (
        <div className="mx-[29px] mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 max-[1200px]:mx-5">
          <div className="min-w-0">
            <p className="eyebrow">{contextualDestination ? "Contextual Add" : "Add destination"}</p>
            <p className="mt-1 truncate text-sm font-semibold">{contextualDestination ?? `Open service · ${currentService?.title || "Local draft"}`}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {contextualDestination
                ? "The item returns to its captured Prepare section."
                : currentDestination
                  ? realChoice
                    ? `Library items go to ${currentDestination.label}. This choice is remembered for this service.`
                    : `Library items go to ${currentDestination.label}.`
                  : "Use asks once where items go in this service, then remembers it."}
            </p>
          </div>
          {!contextualDestination && realChoice && (
            <Button
              variant="outline"
              onClick={() => {
                if (prepareReturn && !prepareReturnIsCurrent) {
                  useShellStore.getState().clearPrepareLibraryReturn()
                }
                openTargetChooser(null)
              }}
              aria-label={currentDestination ? "Change Library destination" : "Choose Library destination"}
            >
              {currentDestination ? "Change destination" : "Choose destination"}
            </Button>
          )}
        </div>
      )}

      <div onKeyDown={tablistKeys} role="tablist" aria-label="Library" className="flex shrink-0 flex-wrap gap-2 px-[29px] pb-4 max-[1200px]:px-5">
        {SECTIONS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            onClick={() => setSection(id)}
            className={cn(
              "rounded-full border px-[15px] py-2.5 text-xs font-bold outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              section === id ? "border-transparent bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={SECTIONS.find(([id]) => id === section)?.[1]} className="mx-[29px] mb-6 flex min-h-[24rem] flex-1 flex-col max-[1200px]:mx-5">
        {section === "bible" && <BibleLibrary onUseItem={useItem} />}
        {section === "songs" && <SongLibrary layout="cards" newRequest={newSong} onUseItem={useItem} privatePreview />}
        {section === "designs" && <div className="min-h-0 flex-1 overflow-y-auto">
          {designInvocation ? (
            <section className="rounded-lg border border-border bg-card p-4" aria-label="Use a design in the current moment">
              <Button size="sm" variant="outline" className="mb-3" onClick={() => setDesignInvocation(null)}>Back to visual designs</Button>
              <h2 className="text-sm font-semibold">{designInvocation.prepareReturn?.eventTitle} · {designInvocation.prepareReturn?.momentTitle}</h2>
              <DesignVersionPicker onUse={useDesignVersion} useLabel="Use this version in the current moment" />
            </section>
          ) : (
            <>
              {prepareReturnIsCurrent && prepareReturn.eventId && prepareReturn.momentId && (
                <section className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4" aria-label="Prepare moment destination">
                  <div>
                    <h2 className="text-sm font-semibold">{prepareReturn.eventTitle} · {prepareReturn.momentTitle}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">Attach a pinned design version to this exact Prepare moment. No screen changes.</p>
                  </div>
                  <Button variant="outline" onClick={() => setDesignInvocation(captureLibraryUseInvocation())}>Choose a saved version for this moment</Button>
                </section>
              )}
              {/* My Designs lives in one place, Design (#806 R7); Library links to it. */}
              <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4" aria-label="My Designs">
                <div>
                  <h2 className="text-sm font-semibold">My Designs</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Editable designs, their drafts and versions are made and kept in Design → My Designs. Choose a saved version for a Prepare moment here.</p>
                </div>
                <Button onClick={() => useShellStore.getState().openDesign("my-designs")}>Open My Designs in Design</Button>
              </section>
            </>
          )}
        </div>}
        {section !== "songs" && section !== "bible" && section !== "designs" && (
          <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-card p-4">
            {section === "hymns" && <HymnBook onUseItem={useItem} privatePreview />}
            {section === "slides" && <SlideLibrary newRequest={newSlide} onUseItem={useItem} />}
            {section === "media" && <MediaLibrary kinds="visual" onUseItem={useItem} privatePreview />}
            {section === "audio" && <MediaLibrary kinds="audio" onUseItem={useItem} privatePreview />}
            {section === "collections" && <CollectionsPanel onUseItem={useItem} />}
            {section === "files" && <div className="h-full max-w-2xl overflow-y-auto"><SongFiles /><LibraryFileBlock /></div>}
          </div>
        )}
        <LibraryPreviewPane onAdd={(item) => addToService(item, captureLibraryUseInvocation())} />
      </div>

      <Dialog
        open={targetRequest !== null}
        onOpenChange={(open) => { if (!open) closeTargetChooser() }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{targetRequest?.item ? "Choose where to add this item" : "Choose a Library destination"}</DialogTitle>
            <DialogDescription>
              For <strong>{targetRequest?.invocation.serviceTitle ?? currentService?.title ?? "Local draft"}</strong>. Add places the item at the end of the selected event, phase or group. It opens in Prepare; Live's Preview and Program are unchanged.
            </DialogDescription>
          </DialogHeader>
          {targetRequest && !isCurrentLibraryUseInvocation(targetRequest.invocation) && (
            <p role="alert" className="text-sm text-destructive">The open service or Prepare caller changed. Cancel and start again.</p>
          )}
          <label className="grid gap-2 text-sm font-medium" htmlFor="library-destination">
            Destination
            <select
              id="library-destination"
              aria-label="Library destination"
              value={targetSelection}
              onChange={(event) => selectDestination(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <option value="">Choose a destination…</option>
              {choices.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
            </select>
          </label>
          {targetError && <p role="alert" className="text-sm text-destructive">{targetError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={closeTargetChooser}>Cancel</Button>
            <Button disabled={!selectedDestination} onClick={confirmDestination}>
              {targetRequest?.item ? "Add to service" : "Remember destination"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
