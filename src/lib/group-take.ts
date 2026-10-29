import type { BroadcastOutputRole, BroadcastOutputType } from "@/types"

export interface GroupTakeImpact {
  language: "both" | "first" | "second"
  aspectRatio: string
  themeId: string
  themeFor: Record<string, string>
  shows: string[]
  themeNames: Record<string, string>
  themeRevisions: Record<string, number>
}

export interface GroupTakeOutputCheck extends GroupTakeImpact {
  name: string
  type: BroadcastOutputType
  role: BroadcastOutputRole
  sceneId: string | null
  sceneRevision: number | null
}

/** Snapshot returned by the host's last authorization/revision check. */
export interface GroupTakeHostCheck {
  service: string
  sceneUpdatedAt: number
  revisions: Record<string, number>
  outputs: Record<string, GroupTakeOutputCheck>
}

/** A host result deliberately says nothing about whether a receiver displayed the frame. */
export interface GroupTakeOutputResult {
  id: string
  name: string
  status: "pending" | "host-applied" | "not-applied"
  reason?: string
}

export interface GroupTakeResult {
  requestId: string
  scene: string
  service?: string
  at: number
  by?: string
  outputs: GroupTakeOutputResult[]
}

/** Return the reduced display ratio used by the output's saved look. */
export function aspectRatioLabel(resolution: { width: number; height: number } | undefined): string {
  if (!resolution || !Number.isSafeInteger(resolution.width) || !Number.isSafeInteger(resolution.height) || resolution.width < 1 || resolution.height < 1) return "unknown"
  let width = resolution.width
  let height = resolution.height
  let a = width
  let b = height
  while (b !== 0) [a, b] = [b, a % b]
  width /= a
  height /= a
  return `${width}:${height}`
}

export function validAspectRatioLabel(value: string): boolean {
  const parts = value.split(":")
  return parts.length === 2 && parts.every((part) => /^\d+$/.test(part) && Number(part) > 0 && Number.isSafeInteger(Number(part)))
}
