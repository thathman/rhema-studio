import type { Program, QueueItem } from "@/types"
import { isImageItem, isSongItem } from "@/types"

export type ApprovalState = "approved" | "changed" | "none"

/**
 * Where a saved service stands against its approval: approved as it is,
 * changed since (saved again after approving), or never approved.
 */
export function approvalState(p: Pick<Program, "revision" | "approved_revision"> | null): ApprovalState {
  if (!p || p.approved_revision === null || p.approved_revision === undefined) return "none"
  return p.approved_revision === p.revision ? "approved" : "changed"
}

export function approvalLabel(p: Pick<Program, "revision" | "approved_revision" | "approved_at" | "approved_by"> | null): string {
  switch (approvalState(p)) {
    case "approved": return `Approved${p?.approved_by ? ` by ${p.approved_by}` : ""}${p?.approved_at ? ` ${new Date(p.approved_at).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : ""}`
    case "changed": return `Changed since approval (v${p?.approved_revision} approved, now v${p?.revision})`
    default: return "Not approved yet"
  }
}

/**
 * PRD FR-08: the production machine verifies every asset is local before a
 * service counts as ready. Approval refuses while a song is missing from
 * the library or a picture (item or background) is missing from the media
 * folder. Returns plain sentences for the operator; empty means go ahead.
 */
export function approvalBlockers(
  items: QueueItem[],
  missingSongIds: string[],
  media: Array<{ id: string; present: boolean }>,
): string[] {
  const out: string[] = []
  const songs = items.filter(isSongItem).filter((i) => missingSongIds.includes(i.song.song_id))
  if (songs.length) out.push(`${songs.length === 1 ? "A song is" : `${songs.length} songs are`} not in the library: ${songs.map((i) => i.song.title).join(", ")}.`)
  const present = (id: string) => media.find((m) => m.id === id)?.present === true
  const pictures = items.filter(isImageItem).filter((i) => !present(i.image.media_id)).map((i) => i.image.name)
  const backgrounds = items.filter((i) => i.background && !present(i.background.media_id)).map((i) => i.background?.name ?? i.reference)
  const gone = [...pictures, ...backgrounds]
  if (gone.length) out.push(`${gone.length === 1 ? "A media file is" : `${gone.length} media files are`} missing from the media folder: ${gone.join(", ")}.`)
  return out
}
