/**
 * Keyboard mapping for the Present console. Pure so it is testable
 * without a DOM; the hook in present-workspace wires it to `window`.
 */
export type PresentKeyAction = "next" | "prev" | "clear" | "restore" | "verseNext" | "versePrev" | "ticker"

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
/** A list or menu moves its own selection with PageUp/PageDown: the clicker leaves it alone (#411). */
const OWN_PAGING = '[role="listbox"], [role="menu"]'

/**
 * A presenter clicker's press (#411, owner decision 5 Nov): plain PageUp/PageDown. It works while
 * Live tools is open, so the tools extend the presenter rather than interrupt; the arrows there stay
 * the panel's own (tabs, menus), never a service step.
 */
export function isClickerKey(e: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean {
  return CLICKER_KEYS.has(e.key) && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey
}

export function shouldIgnoreKeyboard(target: EventTarget | null, key?: string): boolean {
  if (typeof document !== "undefined" && document.querySelector?.(OPEN_MODAL)) return true
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false
  const el = target as HTMLElement
  if (el.closest?.(OVERLAY)) return !(key !== undefined && CLICKER_KEYS.has(key)) || !!el.closest?.(OWN_PAGING)
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
    // Shift+T: Take the news ticker, or Stop it when it runs (#187). Shift, so a stray T does nothing.
    case "T":
    case "t":
      return e.shiftKey ? "ticker" : null
    default:
      return null
  }
}
