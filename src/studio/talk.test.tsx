// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { TalkButton, TalkRulesSettings } from "./talk"
import { callTarget, channelsFor, hears, levelOf, mayUseChannel, speakerName, talkName } from "@/lib/voice"
import { DEFAULT_TALK_RULES, restoreSettingsFromBackup, sectionOf, useSettingsStore } from "@/stores/settings-store"

/** Hold to talk (Rhema Comms C3): talk only while held; letting go or leaving the window stops it. */
describe("the Talk button", () => {
  it("talks while held by pointer or Space, and stops on release, cancel and window blur", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const onTalk = vi.fn()
    const el = document.createElement("div")
    document.body.append(el)
    await act(async () => createRoot(el).render(<TalkButton talking={false} onTalk={onTalk} />))
    const b = el.querySelector("button")!
    const fire = (type: string) => act(async () => { b.dispatchEvent(new Event(type, { bubbles: true })) })
    await fire("pointerdown")
    await fire("pointerdown") // still held: not twice
    await fire("pointerup")
    await fire("pointerdown")
    await act(async () => { window.dispatchEvent(new Event("blur")) })
    await act(async () => { b.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })) })
    await act(async () => { b.dispatchEvent(new KeyboardEvent("keydown", { key: " ", repeat: true, bubbles: true })) })
    await act(async () => { b.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true })) })
    await act(async () => { b.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true })) })
    expect(onTalk.mock.calls.map((c) => c[0])).toEqual([true, false, true, false, true, false])
  })

  it("talk channels: All crew reaches everyone, a channel its listeners, a private call one person", () => {
    expect(hears("all", "k-ade", [])).toBe(true)
    expect(hears("production", "k-ade", ["production"])).toBe(true)
    expect(hears("production", "k-femi", ["stage"])).toBe(false)
    // A private call reaches the key it was chosen for, never a name.
    expect(hears("to:Ade", "k-ade", [], "k-ade")).toBe(true)
    expect(hears("to:Ade", "k-femi", ["production", "stage"], "k-ade")).toBe(false)
    expect(hears("to:Ade", "Ade", [], "k-ade")).toBe(false)
    expect(hears("to:Ade", "k-ade", [])).toBe(false)
    expect(hears("to:host", "host", [], "host")).toBe(true)
    expect([talkName("all"), talkName("stage"), talkName("to:Ade"), talkName("to:host", "Tolu (main desk)")]).toEqual(["All crew", "Stage & worship", "Ade", "Tolu (main desk)"])
    // Priority (the main desk): heard by everyone, like All crew.
    expect(hears("priority", "Femi", [])).toBe(true)
    expect(talkName("priority")).toBe("All crew (priority)")
  })

  it("a private call goes to the key of the one desk with exactly that name, or to nobody", () => {
    const crew: [string, { name: string }][] = [["k-ade", { name: "Ade" }], ["k-look", { name: "\u0410de" }], ["k-femi", { name: "Femi" }]]
    expect(callTarget("to:Ade", crew)).toBe("k-ade")
    expect(callTarget("to:\u0410de", crew)).toBe("k-look")
    expect(callTarget("to:ade", crew)).toBeUndefined()
    expect(callTarget("to:host", crew)).toBe("host")
    expect(callTarget("all", crew)).toBeUndefined()
    // Two keys under the same name (a copied name): nobody, rather than the wrong person.
    expect(callTarget("to:Ade", [...crew, ["k-copy", { name: "Ade" }]])).toBeUndefined()
  })

  it("names the speaker with their role, and works out channel rights and levels (#251)", () => {
    expect(speakerName({ name: "Ade", role: "bible" })).toBe("Ade · Bible")
    expect(speakerName({ name: "Pat (main desk)" })).toBe("Pat (main desk)")
    const rules = { channels: { stage: ["stage", "worship"] } }
    expect([mayUseChannel(rules, "stage", "worship"), mayUseChannel(rules, "stage", "bible"), mayUseChannel(rules, "production", "bible")]).toEqual([true, false, true])
    // All crew, private calls and the main desk (no role) are never limited.
    expect([mayUseChannel(rules, "all", "bible"), mayUseChannel(rules, "to:Ade", "bible"), mayUseChannel(rules, "stage")]).toEqual([true, true, true])
    expect(channelsFor(rules.channels, "bible").map((c) => c.id)).toEqual(["production"])
    expect(channelsFor(undefined, "bible").map((c) => c.id)).toEqual(["production", "stage"])
    expect([levelOf({ a: { volume: 0.5 } }, "a"), levelOf({ a: { volume: 0.5, muted: true } }, "a"), levelOf({}, "b"), levelOf({ a: 3 }, "a")]).toEqual([0.5, 0, 1, 1])
  })

  it("the church's talk rules are a church setting, edited in Settings → Audio, and a bad one in a backup is skipped", async () => {
    expect(sectionOf("talkRules")).toBe("church")
    useSettingsStore.setState({ talkRules: DEFAULT_TALK_RULES })
    expect(restoreSettingsFromBackup({ church: { talkRules: { channels: { stage: "everyone" }, duck: 0.2 } } })).toEqual([])
    expect(restoreSettingsFromBackup({ church: { talkRules: { channels: { stage: ["stage"] }, duck: 0.3 } } })).toEqual(["talkRules"])
    expect(useSettingsStore.getState().talkRules).toEqual({ channels: { stage: ["stage"] }, duck: 0.3 })
    useSettingsStore.setState({ talkRules: DEFAULT_TALK_RULES })
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const el = document.createElement("div")
    await act(async () => createRoot(el).render(<TalkRulesSettings />))
    const bible = [...el.querySelectorAll("fieldset")][1].querySelectorAll<HTMLInputElement>("input[type=checkbox]")[1]
    expect(bible.checked).toBe(true)
    await act(async () => bible.click())
    expect(useSettingsStore.getState().talkRules.channels.stage).not.toContain("bible")
    await act(async () => [...el.querySelectorAll("fieldset")][1].querySelectorAll<HTMLInputElement>("input[type=checkbox]")[1].click())
    // Every role ticked again is no limit at all.
    expect(useSettingsStore.getState().talkRules.channels).toEqual({})
  })
})
