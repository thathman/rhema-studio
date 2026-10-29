import { create } from "zustand"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import { useShellStore, type PrepareLibraryReturnContext } from "@/studio/shell-store"
import type { QueueItem } from "@/types"

export const LIBRARY_TARGET_PREFERENCES_KEY = "rhema-studio.library-targets.v1"
export const LIBRARY_END_OF_RUN_TARGET = "end-of-run-of-show"
export const LOCAL_DRAFT_TARGET_OWNER = "local-draft"

export interface LibraryUseInvocation {
  /** Distinguishes this Library visit from a later visit after an async lookup. */
  libraryVisitId: number
  /** Null means the unsaved local rundown is open. */
  serviceId: string | null
  serviceTitle: string
  /** A local rundown has no stable service ID, so reject it if it changes during async work. */
  localRundownSignature: string | null
  /** Capture the caller route before asynchronous Bible verification begins. */
  prepareReturn: PrepareLibraryReturnContext | null
}

export type LibraryItemUseHandler = (
  item: QueueItem,
  invocation: LibraryUseInvocation,
) => void

export interface LibraryTargetPreferences {
  version: 1
  byServiceId: Record<string, string>
}

export interface LibraryTargetStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

function browserStorage(): LibraryTargetStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

export function readLibraryTargetPreferences(
  storage: LibraryTargetStorage | null,
): Record<string, string> {
  if (!storage) return {}
  try {
    const raw = storage.getItem(LIBRARY_TARGET_PREFERENCES_KEY)
    if (!raw) return {}
    const value = JSON.parse(raw) as Partial<LibraryTargetPreferences>
    if (
      value.version !== 1 ||
      typeof value.byServiceId !== "object" ||
      value.byServiceId === null ||
      Array.isArray(value.byServiceId)
    ) return {}
    return Object.fromEntries(
      Object.entries(value.byServiceId).filter(([serviceId, target]) =>
        serviceId.length > 0 &&
        serviceId !== LOCAL_DRAFT_TARGET_OWNER &&
        typeof target === "string" &&
        target.length > 0 &&
        target.length <= 300,
      ),
    )
  } catch {
    return {}
  }
}

export function writeLibraryTargetPreferences(
  storage: LibraryTargetStorage | null,
  byServiceId: Record<string, string>,
): void {
  if (!storage) return
  try {
    const persistable = Object.fromEntries(
      Object.entries(byServiceId).filter(([serviceId, target]) =>
        serviceId !== LOCAL_DRAFT_TARGET_OWNER && target.length > 0,
      ),
    )
    storage.setItem(
      LIBRARY_TARGET_PREFERENCES_KEY,
      JSON.stringify({ version: 1, byServiceId: persistable } satisfies LibraryTargetPreferences),
    )
  } catch {
    // Remembering a destination is a convenience; storage failure must not block Library use.
  }
}

export function libraryTargetOwner(invocation: LibraryUseInvocation): string {
  return invocation.serviceId ?? LOCAL_DRAFT_TARGET_OWNER
}

export function libraryHeaderTarget(headerId: string): string {
  return `header:${headerId}`
}

export function headerIdFromLibraryTarget(target: string): string | null {
  return target.startsWith("header:") ? target.slice("header:".length) || null : null
}

function localRundownSignature(): string {
  const { items, headers } = useQueueStore.getState()
  return JSON.stringify({
    itemIds: items.map(({ id }) => id),
    headers: headers.map(({ id, type, at, event }) => [id, type, at, !!event]),
  })
}

function samePrepareReturn(
  a: PrepareLibraryReturnContext | null,
  b: PrepareLibraryReturnContext | null,
): boolean {
  if (a === null || b === null) return a === b
  return a.serviceId === b.serviceId &&
    a.targetHeaderId === b.targetHeaderId &&
    a.targetHeaderTitle === b.targetHeaderTitle &&
    a.eventId === b.eventId &&
    a.momentId === b.momentId &&
    a.eventTitle === b.eventTitle &&
    a.momentTitle === b.momentTitle
}

export function captureLibraryUseInvocation(): LibraryUseInvocation {
  const service = useServiceStore.getState().current
  const shell = useShellStore.getState()
  const prepareReturn = shell.prepareLibraryReturn
  return {
    libraryVisitId: shell.libraryVisitId,
    serviceId: service?.id ?? null,
    serviceTitle: service?.title.trim() || "Local draft",
    localRundownSignature: service ? null : localRundownSignature(),
    prepareReturn: prepareReturn ? { ...prepareReturn } : null,
  }
}

/** Fail closed when an async lookup or target dialog outlives its service/caller context. */
export function isCurrentLibraryUseInvocation(
  invocation: LibraryUseInvocation,
): boolean {
  const shell = useShellStore.getState()
  if (shell.workspace !== "library" || shell.libraryVisitId !== invocation.libraryVisitId) return false
  const currentServiceId = useServiceStore.getState().current?.id ?? null
  if (currentServiceId !== invocation.serviceId) return false
  if (
    currentServiceId === null &&
    invocation.localRundownSignature !== localRundownSignature()
  ) return false
  return samePrepareReturn(
    shell.prepareLibraryReturn,
    invocation.prepareReturn,
  )
}

interface LibraryTargetStoreState {
  byServiceId: Record<string, string>
  remember: (ownerId: string, target: string) => void
  forget: (ownerId: string) => void
  clearAll: () => void
}

const storage = browserStorage()

export const useLibraryTargetStore = create<LibraryTargetStoreState>((set) => ({
  byServiceId: readLibraryTargetPreferences(storage),
  remember: (ownerId, target) => set((state) => {
    const byServiceId = { ...state.byServiceId, [ownerId]: target }
    writeLibraryTargetPreferences(storage, byServiceId)
    return { byServiceId }
  }),
  forget: (ownerId) => set((state) => {
    const byServiceId = { ...state.byServiceId }
    delete byServiceId[ownerId]
    writeLibraryTargetPreferences(storage, byServiceId)
    return { byServiceId }
  }),
  clearAll: () => set(() => {
    try {
      storage?.removeItem?.(LIBRARY_TARGET_PREFERENCES_KEY)
    } catch {
      // Tests and private browsing may provide a storage implementation without removeItem.
    }
    return { byServiceId: {} }
  }),
}))
