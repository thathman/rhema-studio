import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export function DesignDraftActions({
  dirty,
  saved,
  scope,
  outputs,
  onSave,
  onDiscard,
  onApply,
  onApplied,
}: {
  dirty: boolean
  saved: boolean
  scope: string
  outputs: string[]
  onSave: () => void
  onDiscard: () => void
  onApply: () => void | Promise<void>
  onApplied: () => void
}) {
  const [open, setOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const finishApply = async () => {
    setApplying(true)
    setError(null)
    try {
      // Keep a failed Apply recoverable even when the operator had not clicked Save Draft first.
      onSave()
      await onApply()
      onApplied()
      setOpen(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The design could not be applied. Try again.")
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
      <span role="status" className="mr-auto text-xs text-muted-foreground">
        {dirty ? "Draft changes · outputs unchanged" : saved ? "Saved draft · outputs unchanged" : "Published design preview · edits stay here until applied"}
      </span>
      <Button type="button" size="sm" variant="outline" onClick={onSave} disabled={!dirty}>Save Draft</Button>
      {(dirty || saved) && <Button type="button" size="sm" variant="ghost" onClick={onDiscard}>Discard Draft</Button>}
      <Button type="button" size="sm" onClick={() => { setError(null); setOpen(true) }} disabled={!dirty && !saved}>Apply design…</Button>
      <Dialog open={open} onOpenChange={(next) => { if (!applying) setOpen(next) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply this design?</DialogTitle>
            <DialogDescription>
              This applies the edited design to {scope}. It can change what connected outputs show now.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            <p className="font-semibold">Affected outputs</p>
            {outputs.length ? (
              <ul className="mt-1 list-inside list-disc text-muted-foreground">
                {outputs.map((name) => <li key={name}>{name}</li>)}
              </ul>
            ) : (
              <p className="mt-1 text-muted-foreground">No connected output is using this source now. The design will be ready for its next use.</p>
            )}
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={applying} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" disabled={applying} onClick={() => void finishApply()}>{applying ? "Applying…" : "Apply design"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
