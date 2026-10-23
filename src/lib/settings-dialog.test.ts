import { describe, expect, it } from "vitest"
import { openSettings, useSettingsDialogStore } from "./settings-dialog"

/** Cloud keys was folded into Speech Recognition (#299): old links still land on the Deepgram key. */
describe("Settings sections", () => {
  it("send the old Cloud keys link to Speech Recognition", () => {
    openSettings("api-keys")
    expect(useSettingsDialogStore.getState()).toMatchObject({ isOpen: true, activeSection: "speech" })
    useSettingsDialogStore.getState().setActiveSection("remote")
    useSettingsDialogStore.getState().setActiveSection("api-keys")
    expect(useSettingsDialogStore.getState().activeSection).toBe("speech")
  })

  it("open current sections as they are, and keep the last one when none is named", () => {
    openSettings("remote")
    expect(useSettingsDialogStore.getState().activeSection).toBe("remote")
    openSettings()
    expect(useSettingsDialogStore.getState().activeSection).toBe("remote")
  })
})
