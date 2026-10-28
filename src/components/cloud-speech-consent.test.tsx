// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { CloudSpeechConsent } from "@/components/cloud-speech-consent"
import { useCloudConsentStore } from "@/stores/cloud-consent-store"

describe("CloudSpeechConsent", () => {
  let root: Root | undefined
  let host: HTMLDivElement | undefined

  afterEach(async () => {
    if (root) await act(async () => root!.unmount())
    host?.remove()
    root = undefined
    host = undefined
    useCloudConsentStore.setState({ open: false, pendingProvider: null, onAgree: null })
  })

  it("discloses the OpenAI launch-environment key fallback before audio is sent", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useCloudConsentStore.setState({ open: true, pendingProvider: "openai" })
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)

    await act(async () => root!.render(<CloudSpeechConsent />))

    expect(document.body.textContent).toContain("OPENAI_API_KEY")
    expect(document.body.textContent).toContain("saved in Settings")
  })
})
