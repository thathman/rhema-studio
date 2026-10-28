import { describe, expect, it } from "vitest"
import {
  addArrangement, addSection, applyPaste, appendStep, defaultLabel, defaultSteps, emptyForm, formFromSong, newSongInputFromForm, formLanguages,
  inputFromForm, moveSection, moveStep, removeArrangement, removeSection, removeStep, updateArrangement, validateForm,
} from "./song-form"
import type { SongWithSections } from "@/types"

const stored: SongWithSections = {
  song: {
    id: "s1", title: "Blessed Assurance", authors: "Fanny Crosby", copyright: "", ccli_number: "22324", licence: "public_domain",
    licence_note: "", primary_language: "en", tags: "", notes: "", key: "", tempo: null, revision: 3, created_at: "", updated_at: "",
  },
  sections: [
    { id: "v1", kind: "verse", label: "Verse 1", texts: { en: "Blessed assurance" } },
    { id: "c", kind: "chorus", label: "Chorus", texts: { en: "This is my story", yo: "Èyí ni ìtàn mi" } },
  ],
  arrangements: [{ id: "a1", name: "Default", sequence: ["v1", "c", "c"], is_default: true }],
  numbers: [{ hymnbook_id: "b1", hymnbook_code: "SSS", number: "345" }],
}

describe("song form", () => {
  it("round-trips a stored song, keeping real ids and sending new sections by index", () => {
    const form = formFromSong(stored)
    expect(form.arrangements[0].steps.map((s) => s.sectionId)).toEqual(["v1", "c", "c"])
    expect(new Set(form.arrangements[0].steps.map((s) => s.uid)).size).toBe(3)
    const input = inputFromForm(form)
    expect(input.sections.map((s) => s.id)).toEqual(["v1", "c"])
    expect(input.arrangements?.[0]).toMatchObject({ id: "a1", sequence: ["v1", "c", "c"], is_default: true })
    expect(input.numbers).toEqual([{ hymnbook_id: "b1", number: "345" }])
    expect(input.ccli_number).toBe("22324")
    expect(inputFromForm({ ...form, key: " G ", tempo: "72" })).toMatchObject({ key: "G", tempo: 72 })
    expect(validateForm({ ...form, tempo: "900" })).toContain("Tempo is whole beats per minute, 20 to 300.")
    expect(validateForm({ ...form, tempo: "72.5" })).toContain("Tempo is whole beats per minute, 20 to 300.")

    const withNew = addSection(form, "bridge")
    const bridgeId = withNew.sections[2].id
    const arranged = updateArrangement(withNew, "a1", { steps: appendStep(withNew.arrangements[0].steps, bridgeId) })
    const out = inputFromForm(arranged)
    expect(out.sections[2].id).toBeUndefined()
    expect(out.arrangements?.[0].sequence).toEqual(["v1", "c", "c", "#2"])
    expect(out.sections[2].texts).toEqual({}) // empty text is dropped, validation catches it
  })

  it("labels sections by kind and renumbers after reorder or removal", () => {
    expect(defaultLabel("chorus", 1, [{ kind: "verse" }, { kind: "chorus" }])).toBe("Chorus")
    expect(defaultLabel("chorus", 2, [{ kind: "chorus" }, { kind: "verse" }, { kind: "chorus" }])).toBe("Chorus 2")
    expect(defaultLabel("verse", 0, [{ kind: "verse" }])).toBe("Verse 1")
    let form = applyPaste(emptyForm(), "first words\n\nChorus\nchorus words\n\nthird words", "en")
    expect(form.sections.map((s) => s.label)).toEqual(["Verse 1", "Chorus", "Verse 2"])
    form = moveSection(form, 2, 0)
    expect(form.sections.map((s) => s.label)).toEqual(["Verse 1", "Verse 2", "Chorus"])
    expect(form.sections[0].texts.en).toBe("third words")
    form = removeSection(form, form.sections[0].id)
    expect(form.sections.map((s) => s.label)).toEqual(["Verse 1", "Chorus"])
    // A custom label is kept.
    form = { ...form, sections: form.sections.map((s, i) => (i === 0 ? { ...s, label: "Opening" } : s)) }
    expect(moveSection(form, 0, 1).sections.map((s) => s.label)).toEqual(["Chorus", "Opening"])
  })

  it("builds the default arrangement with one chorus after each verse and edits steps", () => {
    const form = applyPaste(emptyForm(), "verse one\n\nChorus\nchorus words\n\nverse two", "en")
    const steps = defaultSteps(form.sections)
    const [v1, c, v2] = form.sections.map((s) => s.id)
    expect(steps.map((s) => s.sectionId)).toEqual([v1, c, v2, c])
    const added = addArrangement(form, "Default")
    expect(added.arrangements[0].is_default).toBe(true)
    const short = addArrangement(added, "Short")
    expect(short.arrangements[1].is_default).toBe(false)
    const flipped = updateArrangement(short, short.arrangements[1].id, { is_default: true })
    expect(flipped.arrangements.map((a) => a.is_default)).toEqual([false, true])
    const removed = removeArrangement(flipped, flipped.arrangements[1].id)
    expect(removed.arrangements.map((a) => a.is_default)).toEqual([true])

    const moved = moveStep(steps, 3, 0)
    expect(moved.map((s) => s.sectionId)).toEqual([c, v1, c, v2])
    expect(removeStep(moved, moved[0].uid).map((s) => s.sectionId)).toEqual([v1, c, v2])
    expect(moveStep(steps, 0, 9)).toBe(steps)
    // Removing a section removes its steps everywhere.
    const noChorus = removeSection(added, c)
    expect(noChorus.arrangements[0].steps.map((s) => s.sectionId)).toEqual([v1, v2])
  })

  it("validates what a volunteer must fix and lists the song's languages", () => {
    expect(validateForm(emptyForm())).toEqual(["Give the song a title.", "Add at least one section of words."])
    let form = applyPaste({ ...emptyForm(), title: "x" }, "words", "en")
    expect(validateForm(form)).toEqual([])
    form = addSection(form)
    expect(validateForm(form)).toEqual(["Every section needs some words, or remove the empty one."])
    form = removeSection(form, form.sections[1].id)
    form = { ...form, ccli_number: "12a", numbers: [{ hymnbook_id: "b", number: "abc" }] }
    expect(validateForm(form)).toHaveLength(2)
    form = { ...form, ccli_number: "", numbers: [], arrangements: [{ id: "new-1", name: "A", steps: [], is_default: true }, { id: "new-2", name: "a", steps: [], is_default: false }] }
    expect(validateForm(form)).toEqual(["Two arrangements have the same name."])
    expect(formLanguages(formFromSong(stored))).toEqual(["en", "yo"])
  })

  it("a conflict's 'save mine as a new song' carries no ids or hymn numbers from the original, within the title limit", () => {
    const f = formFromSong(sampleSongForNew())
    const input = newSongInputFromForm(f, " (my version)")
    expect(input.sections.every((s) => s.id === undefined)).toBe(true)
    expect((input.arrangements ?? []).every((a) => a.id === undefined && a.sequence.every((x) => x.startsWith("#")))).toBe(true)
    expect(input.numbers).toEqual([])
    expect(input.title.endsWith(" (my version)")).toBe(true)
    expect(Array.from(newSongInputFromForm({ ...f, title: "x".repeat(200) }, " (my version)").title)).toHaveLength(200)
  })
})

function sampleSongForNew() {
  return {
    song: { id: "song-1", title: "Amazing Grace", authors: "", copyright: "", ccli_number: null, licence: "public_domain", licence_note: "", primary_language: "en", tags: "", notes: "", key: "", tempo: null, revision: 3, created_at: "", updated_at: "" },
    sections: [{ id: "sec-a", kind: "verse", label: "Verse 1", texts: { en: "Amazing grace" } }, { id: "sec-b", kind: "chorus", label: "Chorus", texts: { en: "My chains" } }],
    arrangements: [{ id: "arr-1", name: "Default", sequence: ["sec-a", "sec-b", "sec-a"], is_default: true }],
    numbers: [{ hymnbook_id: "hb-1", hymnbook_name: "SSS", number: "245" }],
  } as unknown as Parameters<typeof formFromSong>[0]
}


describe("other titles", () => {
  it("one per line, blanks dropped; more than 20 cannot be saved", async () => {
    const { emptyForm, otherTitles, validateForm } = await import("./song-form")
    const f = { ...emptyForm(), title: "X", alternate_titles: " Olùṣọ́-àgùntàn \n\n  Great shepherd hear " }
    expect(otherTitles(f)).toEqual(["Olùṣọ́-àgùntàn", "Great shepherd hear"])
    expect(validateForm({ ...f, alternate_titles: Array.from({ length: 21 }, (_, i) => `t${i}`).join("\n") })).toContain("At most 20 other titles.")
  })
})
