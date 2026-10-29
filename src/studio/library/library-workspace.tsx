import { useState } from "react"
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
import type { OutlineHeader } from "@/lib/run-of-show"
import { useQueueStore } from "@/stores"
import { useServiceStore } from "@/stores/service-store"
import { presentActions } from "@/studio/present-actions"
import { SongLibrary } from "@/studio/prepare/song-library"
import { HymnBook } from "@/studio/prepare/hymn-book"
import { MediaLibrary } from "@/studio/prepare/media-library"
import { SongFiles } from "@/studio/library/library-blocks"
import { SlideLibrary } from "@/studio/library/slide-library"
import { BibleLibrary } from "@/studio/library/bible-library"
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
  ["media", "Pictures & videos"],
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
  const setSection = useShellStore((s) => s.setLibrarySection)
  const prepareReturn = useShellStore((s) => s.prepareLibraryReturn)
  const currentService = useServiceStore((s) => s.current)
  const headers = useQueueStore((s) => s.headers)
  const ownerId = currentService?.id ?? "local-draft"
  const rememberedTarget = useLibraryTargetStore((s) => s.byServiceId[ownerId])
  // Bumped by "New song" in the page head: the song library opens its editor.
  const [newSong, setNewSong] = useState(0)
  const [newSlide, setNewSlide] = useState(0)
  const [targetRequest, setTargetRequest] = useState<TargetRequest | null>(null)
  const [targetSelection, setTargetSelection] = useState("")
  const [targetSnapshot, setTargetSnapshot] = useState<PrepareLibraryReturnContext | null>(null)
  const [targetError, setTargetError] = useState<string | null>(null)
  const choices = destinationChoices(headers)
  const currentDestination = rememberedDestinationIsValid(rememberedTarget, choices)
    ? choices.find((choice) => choice.key === rememberedTarget) ?? null
    : null
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
    presentActions.previewItem(added)
    useShellStore.getState().setWorkspace("prepare")
    if (rememberTarget) {
      useLibraryTargetStore.getState().remember(libraryTargetOwner(invocation), target.key)
    }
    toast.success(`Added ${item.reference} to ${invocation.serviceTitle}`, {
      description: "It is selected in private Preview. Nothing has been sent to Program.",
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
    if (!rememberedDestinationIsValid(targetKey, currentChoices)) {
      openTargetChooser(item, invocation)
      return
    }
    const target = currentChoices.find((choice) => choice.key === targetKey)!
    const context = target.headerId ? prepareLibraryReturnForHeader(target.headerId) : null
    if (target.headerId && !sameDestinationContext(context, target.headerId, invocation.serviceId)) {
      openTargetChooser(item, invocation)
      return
    }
    addItemAtTarget(item, invocation, target, context, true)
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
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 px-[29px] pt-[26px] pb-4 max-[1200px]:px-5">
        <div className="min-w-0">
          <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Everything in its place</p>
          <h1 className="mt-1 text-[1.625rem] leading-tight font-bold tracking-[-0.035em]">Your creative library.</h1>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">One searchable home for saved Scripture passages, songs, choir ministrations, the hymn book, slides, pictures and videos on this computer. Use adds a copy to the chosen run-of-show destination. Preview stays private until an authorized operator explicitly Takes it.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setSection("files")}><UploadIcon /> Import files</Button>
          <Button onClick={() => {
            if (section === "slides") { setNewSlide((n) => n + 1); return }
            setSection("songs"); setNewSong((n) => n + 1)
          }}><PlusIcon /> {section === "slides" ? "New slide" : "New song"}</Button>
        </div>
      </header>

      <div className="mx-[29px] mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 max-[1200px]:mx-5">
        <div className="min-w-0">
          <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">{contextualDestination ? "Contextual Add" : "Add destination"}</p>
          <p className="mt-1 truncate text-sm font-semibold">{contextualDestination ?? `Open service · ${currentService?.title || "Local draft"}`}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {contextualDestination
              ? "The item returns to its captured Prepare section."
              : currentDestination
                ? `Library items go to ${currentDestination.label}. This choice is remembered for this service.`
                : "Choose a destination before using Library content. The choice is remembered per service."}
          </p>
        </div>
        {!contextualDestination && (
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

      <div role="tablist" aria-label="Library" className="flex shrink-0 flex-wrap gap-2 px-[29px] pb-4 max-[1200px]:px-5">
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
      <div role="tabpanel" aria-label={SECTIONS.find(([id]) => id === section)?.[1]} className="mx-[29px] mb-6 flex min-h-0 flex-1 flex-col max-[1200px]:mx-5">
        {section === "bible" && <BibleLibrary onUseItem={useItem} />}
        {section === "songs" && <SongLibrary layout="cards" newRequest={newSong} onUseItem={useItem} />}
        {section !== "songs" && section !== "bible" && (
          <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-card p-4">
            {section === "hymns" && <HymnBook onUseItem={useItem} />}
            {section === "slides" && <SlideLibrary key={newSlide} onUseItem={useItem} />}
            {section === "media" && <MediaLibrary onUseItem={useItem} />}
            {section === "files" && <div className="h-full max-w-2xl overflow-y-auto"><SongFiles /></div>}
          </div>
        )}
      </div>

      <Dialog
        open={targetRequest !== null}
        onOpenChange={(open) => { if (!open) closeTargetChooser() }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{targetRequest?.item ? "Choose where to add this item" : "Choose a Library destination"}</DialogTitle>
            <DialogDescription>
              For <strong>{targetRequest?.invocation.serviceTitle ?? currentService?.title ?? "Local draft"}</strong>. Add places the item at the end of the selected event, phase or group. It opens in private Preview; Program is unchanged.
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
