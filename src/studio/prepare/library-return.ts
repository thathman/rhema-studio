import {
  interleave,
  projectRunOfShowEvents,
  sectionEnd,
  type OutlineHeader,
} from "@/lib/run-of-show"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import type { PrepareLibraryReturnContext } from "@/studio/shell-store"
import type { QueueItem } from "@/types"

function containingEventIdForHeader(
  items: QueueItem[],
  headers: OutlineHeader[],
  target: OutlineHeader
): string | null {
  if (target.event) return target.id
  let eventId: string | null = null
  for (const row of interleave(items, headers)) {
    if (!("header" in row)) continue
    if (row.header.type === "phase") eventId = null
    else if (row.header.event) eventId = row.header.id
    if (row.header.id === target.id) return eventId
  }
  return null
}

/** Capture the exact service event and moment that opened the shared Library. */
export function prepareLibraryReturnForMoment(
  momentId: string
): PrepareLibraryReturnContext | null {
  const { items, headers } = useQueueStore.getState()
  const event = projectRunOfShowEvents(items, headers).find((candidate) =>
    candidate.moments.some((moment) => moment.id === momentId)
  )
  const moment = event?.moments.find((candidate) => candidate.id === momentId)
  if (!event || !moment) return null

  return {
    serviceId: useServiceStore.getState().current?.id ?? null,
    targetHeaderId: event.id,
    targetHeaderTitle: event.title,
    eventId: event.id,
    momentId,
    eventTitle: event.title,
    momentTitle: moment.reference,
  }
}

/** Capture a standalone Library destination before the user confirms an Add. */
export function prepareLibraryReturnForHeader(
  targetHeaderId: string,
): PrepareLibraryReturnContext | null {
  const queue = useQueueStore.getState()
  const target = queue.headers.find((header) => header.id === targetHeaderId)
  if (!target) return null
  const containingEventId = containingEventIdForHeader(
    queue.items,
    queue.headers,
    target,
  )
  const event = containingEventId
    ? projectRunOfShowEvents(queue.items, queue.headers).find(
        (candidate) => candidate.id === containingEventId,
      )
    : null
  return {
    serviceId: useServiceStore.getState().current?.id ?? null,
    targetHeaderId: target.id,
    targetHeaderTitle: target.name,
    eventId: containingEventId,
    momentId: null,
    eventTitle: event?.title ?? null,
    momentTitle: null,
  }
}

/** Capture an event-level Add target when its slide composer opens the shared Library. */
export function prepareLibraryReturnForAddTarget(): PrepareLibraryReturnContext | null {
  const queue = useQueueStore.getState()
  const targetHeaderId = queue.addTarget
  if (!targetHeaderId) return null
  const target = queue.headers.find((header) => header.id === queue.addTarget)
  if (!target) {
    return {
      serviceId: useServiceStore.getState().current?.id ?? null,
      targetHeaderId,
      targetHeaderTitle: "",
      eventId: null,
      momentId: null,
      eventTitle: null,
      momentTitle: null,
    }
  }
  return prepareLibraryReturnForHeader(target.id)
}

/** The Library must fail closed if the caller's service, section, or moment changed while it was open. */
export function isCurrentPrepareLibraryReturn(
  context: PrepareLibraryReturnContext
): boolean {
  if ((useServiceStore.getState().current?.id ?? null) !== context.serviceId)
    return false
  const { items, headers } = useQueueStore.getState()
  const target = headers.find((header) => header.id === context.targetHeaderId)
  if (!target) return false
  if (containingEventIdForHeader(items, headers, target) !== context.eventId)
    return false
  if (context.eventId === null) {
    if (context.momentId === null) return true
    const itemIndex = items.findIndex((item) => item.id === context.momentId)
    return (
      itemIndex >= target.at &&
      itemIndex < sectionEnd(items.length, headers, target.id)
    )
  }
  return projectRunOfShowEvents(items, headers).some(
    (event) =>
      event.id === context.eventId &&
      (context.momentId === null ||
        event.moments.some((moment) => moment.id === context.momentId))
  )
}
