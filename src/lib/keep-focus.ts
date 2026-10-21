/**
 * After removing an item from a list with the keyboard, put focus on the
 * matching control of the item now in its place (or the last one), so it
 * never falls back to the page.
 */
export function keepFocusInList(from: HTMLElement | null, selector: string): void {
  const li = from?.closest("li")
  const list = li?.parentElement
  if (!li || !list) return
  const at = Array.from(list.children).indexOf(li)
  requestAnimationFrame(() => {
    const items = Array.from(list.children)
    for (let i = Math.min(at, items.length - 1); i >= 0; i--) {
      const target = items[i].querySelector<HTMLElement>(selector)
      if (target) return target.focus()
    }
  })
}
