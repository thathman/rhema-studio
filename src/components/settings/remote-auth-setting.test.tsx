// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { RemoteAuthSetting } from "./remote-auth-setting"

const roots: Root[] = []
async function mount(props: React.ComponentProps<typeof RemoteAuthSetting>) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => root.render(<RemoteAuthSetting {...props} />))
  return host
}
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()))
  document.body.replaceChildren()
})

describe("remote authentication setting", () => {
  it("requires the exact risk phrase and explicit confirmation before turning authentication off", async () => {
    const onRequiredChange = vi.fn()
    const host = await mount({ required: true, locked: false, onRequiredChange })
    const toggle = host.querySelector<HTMLInputElement>('input[aria-label="Require a key or a paired device"]')!

    await act(async () => toggle.click())
    expect(onRequiredChange).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("ANY device on a local/private network that can reach a LAN listener")
    expect(document.body.textContent).toContain("Public-source commands, pairing, status, and health requests are refused")
    expect(document.body.textContent).toContain("VPN peers using private or link-local source addresses are treated as local")
    expect(document.body.textContent).toContain("server checks the immediate peer address and ignores forwarded-client headers")
    const confirm = document.body.querySelector<HTMLButtonElement>('button[aria-label="Allow unauthenticated LAN control"]')!
    expect(confirm.disabled).toBe(true)

    const phrase = document.body.querySelector<HTMLInputElement>('input[aria-label="Type ALLOW UNAUTHENTICATED LAN CONTROL"]')!
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    await act(async () => {
      set.call(phrase, "ALLOW UNAUTHENTICATED LAN CONTROL")
      phrase.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(confirm.disabled).toBe(false)
    await act(async () => confirm.click())
    expect(onRequiredChange).toHaveBeenCalledOnce()
    expect(onRequiredChange).toHaveBeenCalledWith(false)
  })

  it("cancels without changing authentication and cannot be opened while a key or device exists", async () => {
    const onRequiredChange = vi.fn()
    const host = await mount({ required: true, locked: false, onRequiredChange })
    const toggle = host.querySelector<HTMLInputElement>('input[aria-label="Require a key or a paired device"]')!
    await act(async () => toggle.click())
    await act(async () => document.body.querySelector<HTMLButtonElement>('button[aria-label="Cancel risk confirmation"]')!.click())
    expect(onRequiredChange).not.toHaveBeenCalled()

    await act(async () => rootRender(host, { required: true, locked: true, onRequiredChange }))
    const lockedToggle = host.querySelector<HTMLInputElement>('input[aria-label="Require a key or a paired device"]')!
    expect(lockedToggle.checked).toBe(true)
    expect(lockedToggle.disabled).toBe(true)
    await act(async () => lockedToggle.click())
    expect(document.body.textContent).not.toContain("ANY device that can reach a LAN listener")
    expect(onRequiredChange).not.toHaveBeenCalled()
  })

  it("renders an existing unauthenticated setting without silently changing it", async () => {
    const onRequiredChange = vi.fn()
    const host = await mount({ required: false, locked: false, onRequiredChange })
    const toggle = host.querySelector<HTMLInputElement>('input[aria-label="Require a key or a paired device"]')!
    expect(toggle.checked).toBe(false)
    expect(host.textContent).toContain("Off: commands from devices on local/private networks do not need a key or pairing")
    expect(onRequiredChange).not.toHaveBeenCalled()
  })
})

async function rootRender(host: HTMLElement, props: React.ComponentProps<typeof RemoteAuthSetting>) {
  const root = roots.at(-1)!
  await act(async () => root.render(<RemoteAuthSetting {...props} />))
  void host
}
