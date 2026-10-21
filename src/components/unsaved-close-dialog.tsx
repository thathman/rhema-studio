import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useServiceStore } from "@/stores/service-store"

/**
 * Closing the window with unsaved service changes (PRD FR-03). The Rust side
 * holds the first close while the service is unsaved and asks here; closing
 * the window a second time always quits (commands/app_close.rs).
 */
export function UnsavedCloseDialog() {
  const dirty = useServiceStore((s) => s.dirty)
  const current = useServiceStore((s) => s.current)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void invoke("set_unsaved_work", { unsaved: dirty }).catch(() => {})
  }, [dirty])

  useEffect(() => {
    const un = listen("app:close-requested", () => {
      setError(null)
      setOpen(true)
    })
    return () => void un.then((u) => u())
  }, [])

  const quit = () => void invoke("close_main_window").catch(() => {})
  const keepWorking = () => {
    setOpen(false)
    // The close that asked cleared the hold; put it back while the work is still unsaved.
    void invoke("set_unsaved_work", { unsaved: useServiceStore.getState().dirty }).catch(() => {})
  }
  const saveAndQuit = async () => {
    setSaving(true)
    const r = await useServiceStore.getState().saveCurrent()
    setSaving(false)
    if (r === "saved") quit()
    else setError(r === "conflict" ? "Not saved: this service was changed elsewhere. Keep working and reload it, or quit without saving." : "Could not save. Keep working and try Save, or quit without saving.")
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) keepWorking() }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Save changes before closing?</DialogTitle>
          <DialogDescription>
            {current ? `“${current.title}” has changes that are not saved.` : "The service on screen has not been saved."} Closing without saving loses them.
          </DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={keepWorking}>Keep working</Button>
          <Button variant="outline" className="text-destructive" onClick={quit}>Close without saving</Button>
          {current && <Button disabled={saving} autoFocus onClick={() => void saveAndQuit()}>{saving ? "Saving…" : "Save and close"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
