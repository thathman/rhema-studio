// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { RevokeAction } from "./revoke-action"

let root: Root
let host: HTMLDivElement
const onRevoke = vi.fn()
const q = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  onRevoke.mockClear()
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<RevokeAction label="Stage phone" what="Stage phone's key is removed." onRevoke={onRevoke} />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe("RevokeAction (#801)", () => {
  it("keeps an empty live region until the confirm opens, then fills it", async () => {
    const status = host.querySelector('[role="status"]')!
    expect(status.textContent).toBe("")
    await act(async () => q("Revoke Stage phone")!.click())
    // The same live region, now filled, so the change is announced.
    expect(host.querySelector('[role="status"]')).toBe(status)
    expect(status.textContent).toBe("Stage phone's key is removed.")
  })

  it("moves focus to Revoke now on open, and back to Revoke after Keep, without revoking", async () => {
    q("Revoke Stage phone")!.focus()
    await act(async () => q("Revoke Stage phone")!.click())
    expect(document.activeElement).toBe(q("Confirm revoke Stage phone"))

    await act(async () => q("Keep Stage phone")!.click())
    expect(document.activeElement).toBe(q("Revoke Stage phone"))
    expect(host.querySelector('[role="status"]')!.textContent).toBe("")
    expect(onRevoke).not.toHaveBeenCalled()
  })

  it("revokes only on the second click", async () => {
    await act(async () => q("Revoke Stage phone")!.click())
    expect(onRevoke).not.toHaveBeenCalled()
    await act(async () => q("Confirm revoke Stage phone")!.click())
    expect(onRevoke).toHaveBeenCalledTimes(1)
  })
})
