/**
 * Keyboard mapping for the Standard present view. Pure so it is testable
 * without a DOM; the hook in present-workspace wires it to `window`.
 */
export type PresentKeyAction = "next" | "prev" | "clear" | "restore" | "verseNext" | "versePrev"

interface KeyLike {
  key: string
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
}

/** Shortcuts must never fire while the operator is typing. */
/** A modal dialog is open: no Present key acts behind it (RG-09). */
const OPEN_MODAL = '[data-slot="dialog-content"][data-state="open"], [data-slot="sheet-content"][data-state="open"], [role="alertdialog"][data-state="open"]'
/** Focus is in a popover, menu or list, whose own keys (arrows, Escape) must not also step or clear. */
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]'
/** A presenter clicker's keys mean nothing in a popover, so they still work from one. */
const CLICKER_KEYS = new Set(["PageDown", "PageUp"])

export function shouldIgnoreKeyboard(target: EventTarget | null, key?: string): boolean {
  if (typeof document !== "undefined" && document.querySelector?.(OPEN_MODAL)) return true
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false
  const el = target as HTMLElement
  if (el.closest?.(OVERLAY)) return !(key !== undefined && CLICKER_KEYS.has(key))
  const tag = el.tagName.toLowerCase()
  if (tag === "input" || tag === "textarea" || tag === "select") return true
  if (el.isContentEditable) return true
  const role = el.getAttribute?.("role")
  return role === "combobox" || role === "textbox"
}

export function keyToPresentAction(e: KeyLike): PresentKeyAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null
  switch (e.key) {
    case "ArrowRight":
    case "PageDown":
      return e.shiftKey ? "verseNext" : "next"
    case "ArrowLeft":
    case "PageUp":
      return e.shiftKey ? "versePrev" : "prev"
    case "Escape":
      return e.shiftKey ? "restore" : "clear"
    default:
      return null
  }
}
