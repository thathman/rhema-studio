import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { unsavedScratch, useServiceStore } from "@/stores/service-store"
import { useQueueStore } from "@/stores/queue-store"
import { useUnsavedStore } from "@/stores/unsaved-store"
import { flushThemeSave, themeDraftChanged, useBroadcastStore } from "@/stores/broadcast-store"
import { flushSettingsSave } from "@/stores/settings-store"
import { journalUnkept, keepJournal } from "@/stores/journal-store"

const anyUnsaved = () =>
  useServiceStore.getState().dirty || useUnsavedStore.getState().songEditor !== null || unsavedScratch(useQueueStore.getState().items, useServiceStore.getState().current) || themeDraftChanged()

/**
 * Before the window goes: write settings and themes changed in the last
 * moment (their saves wait a fraction of a second) and keep the service log
 * in the library if something was logged since it was last kept. Bounded, so
 * a stuck write never traps the operator.
 */
async function beforeClose(): Promise<void> {
  const work = Promise.allSettled([flushSettingsSave(), flushThemeSave(), journalUnkept() ? keepJournal() : Promise.resolve()])
  await Promise.race([work, new Promise((r) => setTimeout(r, 3000))])
}

/**
 * Closing the window with unsaved service changes (PRD FR-03). The Rust side
 * holds the first close while the service is unsaved and asks here; closing
 * the window a second time always quits (commands/app_close.rs).
 */
export function UnsavedCloseDialog() {
  const dirty = useServiceStore((s) => s.dirty)
  const current = useServiceStore((s) => s.current)
  const songEditor = useUnsavedStore((s) => s.songEditor)
  const scratch = useQueueStore((s) => unsavedScratch(s.items, current))
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const themeDraft = useBroadcastStore((s) => (s.draftTheme && themeDraftChanged() ? s.draftTheme.name : null))

  // Every close comes here first (saves are written, the log kept); a second close always goes through.
  useEffect(() => {
    void invoke("set_unsaved_work", { unsaved: true }).catch(() => {})
    const un = listen("app:close-requested", () => {
      void beforeClose().then(() => {
        if (!anyUnsaved()) return void invoke("close_main_window").catch(() => {})
        setError(null)
        setOpen(true)
      })
    })
    return () => void un.then((u) => u())
  }, [])

  const quit = () => void beforeClose().then(() => invoke("close_main_window")).catch(() => {})
  const keepWorking = () => {
    setOpen(false)
    // The close that asked cleared the hold; put it back.
    void invoke("set_unsaved_work", { unsaved: true }).catch(() => {})
  }
  const saveAndQuit = async () => {
    setSaving(true)
    const r = await useServiceStore.getState().saveCurrent()
    setSaving(false)
    if (r === "saved") quit()
    else setError({
      conflict: "Not saved: this service was changed elsewhere. Keep working and reload it, or close without saving.",
      unsupported: "Not saved: this service has items this version of Rhema cannot save (see Prepare). Keep working, or close without saving.",
      nothing: "A save is already running. Wait a moment and press Save and close again.",
    }[r as string] ?? "Could not save. Keep working and try Save, or close without saving.")
  }

  // While saving, nothing else can be chosen: the save ends in quitting, so backing out mid-save is not offered.
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) keepWorking() }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Save changes before closing?</DialogTitle>
          <DialogDescription>
            {[
              dirty && current ? `“${current.title}” has changes that are not saved.` : null,
              scratch ? "The service on screen has not been saved (create a service in Prepare to keep it)." : null,
              songEditor ? `The song “${songEditor}” is open in the editor with changes that are not saved${dirty ? "; Save and close saves the service, not the song" : ""}.` : null,
              themeDraft ? `The theme “${themeDraft}” has design changes that are not saved${dirty ? "; Save and close saves the service, not the theme" : ""}.` : null,
            ].filter(Boolean).join(" ")} Closing without saving loses them.
          </DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" disabled={saving} onClick={keepWorking}>Keep working</Button>
          <Button variant="outline" className="text-destructive" disabled={saving} onClick={quit}>Close without saving</Button>
          {current && dirty && <Button disabled={saving} autoFocus onClick={() => void saveAndQuit()}>{saving ? "Saving…" : "Save and close"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
