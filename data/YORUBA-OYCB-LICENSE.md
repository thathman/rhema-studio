# Open Yoruba Contemporary Bible (OYCB)

Rhema Studio's Yoruba text is sourced from the official eBible.org VPL download:

- Source page: <https://ebible.org/bible/details.php?id=yor>
- Source archive: <https://ebible.org/Scriptures/yor_vpl.zip>
- License: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)
  <https://creativecommons.org/licenses/by-sa/4.0/>
- Copyright © 2009, 2017 by Biblica, Inc.

Attribution (required by the licensor): "The original work by Biblica, Inc. is
available for free at www.biblica.com and open.bible."

## Changes made (CC BY-SA 4.0 §3(a)(1)(B))

The bundled database is an adaptation of the source, not the unmodified work:

- The VPL (verse-per-line) text was converted into Rhema's SQLite Bible schema
  (`data/convert-yoruba-vpl.ts`). Verse text is retained as published.
- Books are keyed by the English canonical book identifiers and the Protestant
  1–66 book numbering used for every translation in Rhema, so one reference and
  search system works across translations.
- Front matter, headings and footnotes from the source are not included.

## Trademark

Biblica® is a trademark of Biblica, Inc. Because this is a modified form of
the work, the Biblica® trademark is **not** used: the translation is stored and
displayed as "Open Yoruba Contemporary Bible" (abbreviation OYCB), not as the
"Biblica® Open Yoruba Contemporary Bible™". No endorsement by Biblica is implied.

## Redistribution

The converted Yoruba text remains licensed under CC BY-SA 4.0 (ShareAlike).
That licence applies to the Yoruba text inside the bundled `rhema.db`; the
Rhema Studio application code is separately licensed under MIT (see `LICENSE`).
Anyone redistributing builds that include the OYCB text must keep this notice
with them. This file is bundled with the application as
`licenses/YORUBA-OYCB-LICENSE.md` and summarised in the About screen.
