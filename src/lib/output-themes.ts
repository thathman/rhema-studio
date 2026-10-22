import type { BroadcastOutput } from "@/types/broadcast-output"
import type { ContentType } from "@/types/broadcast"

/** The theme an output uses for this kind of content: its own for that kind, else its main theme. */
export function themeIdFor(output: Pick<BroadcastOutput, "themeId" | "themeFor">, content?: ContentType | null): string {
  return (content && output.themeFor?.[content]) || output.themeId
}

/** Every theme an output can show (its main theme and those for particular kinds), without repeats. */
export function themeIdsOf(output: Pick<BroadcastOutput, "themeId" | "themeFor">): string[] {
  return [...new Set([output.themeId, ...Object.values(output.themeFor ?? {})].filter((t): t is string => !!t))]
}

/** The output's themes per kind with `content` set to `themeId`, or back to the main theme when it is null. */
export function withThemeFor(output: Pick<BroadcastOutput, "themeFor">, content: ContentType, themeId: string | null): Partial<Record<ContentType, string>> {
  const next = { ...(output.themeFor ?? {}) }
  if (themeId) next[content] = themeId
  else delete next[content]
  return next
}
