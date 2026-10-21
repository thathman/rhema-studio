import { useState } from "react"
import { Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * A small trash button that asks once before deleting (PRD FR-04:
 * accidental destructive edits need a safeguard). Pressing it shows
 * Delete / Keep in its place.
 */
export function ConfirmDelete({ label, onConfirm, verb = "Delete" }: { label: string; onConfirm: () => void; verb?: string }) {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return <Button size="icon-xs" variant="ghost" aria-label={label} onClick={() => setAsking(true)}><Trash2Icon /></Button>
  }
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Button size="xs" variant="destructive" autoFocus onClick={() => { setAsking(false); onConfirm() }}>{verb}</Button>
      <Button size="xs" variant="ghost" onClick={() => setAsking(false)}>Keep</Button>
    </span>
  )
}
