import { useEffect, useRef, useState } from "react"
import { Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * A small trash button that asks once before deleting (PRD FR-04:
 * accidental destructive edits need a safeguard). Pressing it shows
 * Delete / Keep in its place; afterwards focus returns to the trash button
 * (if it is still there), never to the page.
 */
export function ConfirmDelete({ label, onConfirm, verb = "Delete" }: { label: string; onConfirm: () => void; verb?: string }) {
  const [asking, setAsking] = useState(false)
  const trash = useRef<HTMLButtonElement>(null)
  const answered = useRef(false)
  useEffect(() => {
    if (!asking && answered.current) {
      answered.current = false
      trash.current?.focus()
    }
  }, [asking])
  const done = () => {
    answered.current = true
    setAsking(false)
  }
  if (!asking) {
    return <Button ref={trash} size="icon-xs" variant="ghost" aria-label={label} onClick={() => setAsking(true)}><Trash2Icon /></Button>
  }
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Button size="xs" variant="destructive" autoFocus onClick={() => { done(); onConfirm() }}>{verb}</Button>
      <Button size="xs" variant="ghost" onClick={done}>Keep</Button>
    </span>
  )
}
