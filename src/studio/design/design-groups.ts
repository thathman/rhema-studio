import { designTabOf, type DesignTab } from "@/studio/shell-store"

/**
 * Design's sections in three purpose groups (#818): Make the things that go on screen, Style how
 * they look, and see Where used. Every section id is unchanged, so every existing deep link
 * (`openDesign("…")`, saved routes, search) still opens the same content.
 */
export type DesignGroupId = "make" | "style" | "where-used"

/** A Design section that has its own content; "outputs" is only an old link to "used-on". */
export type DesignSectionId = Exclude<DesignTab, "outputs">

export interface DesignSection {
  id: DesignSectionId
  label: string
  hint: string
}

export interface DesignGroup {
  id: DesignGroupId
  label: string
  hint: string
  sections: readonly DesignSection[]
}

export const DESIGN_GROUPS: readonly DesignGroup[] = [
  {
    id: "make",
    label: "Make",
    hint: "Designs, templates, lower thirds, ticker, countdown and stage",
    sections: [
      { id: "my-designs", label: "My Designs", hint: "Editable church designs, private drafts and immutable versions" },
      { id: "library", label: "Templates", hint: "Scene templates for private, editable designs" },
      { id: "scenes", label: "Scenes", hint: "Arrange the layers of the scenes Live takes: camera, Bible, lyrics, graphics" },
      { id: "lower-thirds", label: "Lower thirds", hint: "Names, scripture and lyrics strips" },
      { id: "ticker", label: "News ticker", hint: "The crawl along the screen" },
      { id: "countdown", label: "Countdown", hint: "One big time that turns amber, then red, as time runs out" },
      { id: "stage", label: "Stage", hint: "What the team on the platform sees" },
    ],
  },
  {
    id: "style",
    label: "Style",
    hint: "Themes and the brand kit",
    sections: [
      { id: "themes", label: "Themes", hint: "How Bible, songs, hymns, slides and pictures look" },
      { id: "brand", label: "Brand kit", hint: "Logo, colours and fonts once" },
    ],
  },
  {
    id: "where-used",
    label: "Where used",
    hint: "Which outputs show each look",
    sections: [
      { id: "used-on", label: "Outputs overview", hint: "Which outputs show each look" },
    ],
  },
]

export const DESIGN_SECTIONS: readonly DesignSection[] = DESIGN_GROUPS.flatMap((group) => group.sections)

/** The section a Design tab opens (an old "outputs" link opens the Where used overview). */
export function designSectionOf(tab: DesignTab): DesignSection {
  const id = designTabOf(tab)
  return DESIGN_SECTIONS.find((section) => section.id === id) ?? DESIGN_SECTIONS[0]
}

/** The purpose group a Design tab belongs to. */
export function designGroupOf(tab: DesignTab): DesignGroup {
  const id = designSectionOf(tab).id
  return DESIGN_GROUPS.find((group) => group.sections.some((section) => section.id === id)) ?? DESIGN_GROUPS[0]
}

/** The path people read, e.g. "Design → Where used". */
export function designPathOf(tab: DesignTab): string {
  const group = designGroupOf(tab)
  const section = designSectionOf(tab)
  return group.sections.length === 1 ? `Design → ${group.label}` : `Design → ${group.label} → ${section.label}`
}
