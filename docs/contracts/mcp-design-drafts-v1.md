# MCP design drafts v1 (#443 C5 slice 1)

An opt-in local AI assistant can propose a **new design** over Rhema's stdio MCP server, read a
design, and revise a draft **it** made until a person saves it or makes a version (#443). Rhema checks
it and saves it as an ordinary **draft** in the canonical design store (`design_documents`, the same
rows Design → My Designs lists). People open it, edit it, save it and make a version themselves.
Nothing else changes: no version, no edit of an existing design, no pin, approval, service, Take,
output or setting.

Code: `src-tauri/crates/content/src/design_proposal.rs` (check and build),
`ContentDb::create_assistant_design` and `ContentDb::open_existing` (store), `src-tauri/src/mcp_designs.rs`
(tools). Tests: `src-tauri/crates/content/tests/mcp_design_draft.rs`,
`src-tauri/crates/content/tests/mcp-design-draft.render.test.ts`, `src-tauri/tests/mcp_design_drafts.rs`.

## Tools

| Tool | Writes | Does |
| --- | --- | --- |
| `rhema_get_design_capabilities` | no | The proposal schema: artboard, layer types and fields, fills, limits, what is refused and why, the rules |
| `rhema_list_designs` | no | Designs by title (`query`, `limit` ≤ 50), newest change first: id, title, kind, draft revision, latest version. No documents |
| `rhema_validate_design_draft` | no | `{ design }` → `{ ok, errors: [{ at, message }], warnings, title, kind, pages, layers }`; every problem in one answer |
| `rhema_create_design_draft` | one new design | Same check; on success `{ designId, revision: 1, warnings, next }`, otherwise `isError` with the same report in `structuredContent` |
| `rhema_get_design` | no | `{ id }` → title, kind, draft revision, latest version, archived, `assistantMayRevise`, and the editor's document with every local file address removed (pictures keep their media id) |
| `rhema_update_design_draft` | one draft it made | `{ id, revision, design }`: the same checks as create, then replaces that draft. Only a draft an assistant made over MCP that no person has saved since and that has no version, at the revision read (an older one: "read it again"). Otherwise refused (`not_assistant_draft`) and nothing changes |

## The proposal

```json
{
  "title": "Harvest Thanksgiving announcement",
  "kind": "design",
  "background": { "type": "gradient", "angle": 135, "stops": [{ "color": "#0b1020", "offset": 0 }, { "color": "#1e3a8a", "offset": 1 }] },
  "pages": [
    { "title": "Welcome", "layers": [
      { "type": "rect", "x": 0, "y": 760, "width": 1920, "height": 320, "fill": { "type": "solid", "color": "#c2410c" } },
      { "type": "text", "x": 160, "y": 300, "width": 1600, "height": 200, "text": "Harvest Thanksgiving", "textSecond": "Ìdúpẹ́ Ìkórè", "fontSize": 96, "fontWeight": "800" }
    ] },
    { "title": "Picture", "layers": [
      { "type": "picture", "x": 160, "y": 140, "width": 960, "height": 540, "mediaId": "<id from rhema_list_media>" }
    ] }
  ]
}
```

- **Lengths** are counted as the editor's adapter counts them (UTF-16 units: an emoji is two).
- **Pages:** 1–12, unique titles up to 80 characters, 1–40 layers each (bottom first), 200 in all.
  The background is shared by the pages. Proposal ≤ 256 KB (the stdio message limit is 1 MB).
- **Layers** (px on the 1920 × 1080 artboard, top-left origin, inside it; `opacity` 0–1):
  - `text`: `text` (≤ 2,000 characters, `\n` breaks a line), `textSecond` (the second service
    language), `fontSize` 8–400, `fontFamily` (letters A–Z, numbers, spaces, commas, `_`, `-`; up to 120),
    `fontWeight` "400"–"900", `fontStyle`, `textAlign`, `lineHeight` 0.5–3, `color` `#rrggbb`, `underline`.
  - `rect`, `ellipse`: `fill`, either solid `#rrggbb` or a linear gradient (angle −360–360, 2–16 stops
    of `#rrggbb`/`#rrggbbaa` at offsets 0–1 in order).
  - `picture`: `mediaId` of an image in the media library whose file is present. Screens fill the box,
    keeping the picture's shape, and the Design editor shows the same (#662).
- **Refused by name, never dropped or flattened:** lines, arrows, polygons, stars; rotation,
  flipping, shadow, blur, outlines, rounded corners; gradient or non-hex text colours; pictures by
  address (`src`, `url`, `imageUrl`, `href`: web, file or data URLs); crops and masks (people add them in
  the editor); control and text-direction characters (U+202A–202E, U+2066–2069, U+200E/F, U+FEFF) in
  any title or words; any unknown field; `id`, `revision`, `version`, `design`, `designRef`,
  `approved`, `outputs`, `service`.
- **Warnings:** when Setup lists two or more service languages, a text layer without `textSecond`
  (screens set to the second language show the first and warn); a picture box not in the picture's
  shape (its overflow is cut off).

## What is saved

The builder makes the same document the Design editor makes (`createBlankRhemaDesign`'s shape):
`scene` (Saraswati v1, 1920 × 1080, `root` group whose children are one group per page, named as the
page), `bindings` by node (`text` with `text`/`textSecond`/`textBoxHeight`; `color`; `ellipse`;
`picture` with `mediaId` and `imageUrl`), `meta` (`id`, `name`, `createdAt`, `updatedAt`) and `pages`
(`id`, `title`, `nodeId`). Every id is new. A library picture's `imageUrl`/`src` is its local
`asset://localhost/<path>` address (`http://asset.localhost/…` on Windows), as the editor stores one;
it is never returned to the assistant. The editor's own adapter (`designToScene`) opens every page with
no issue and the output renderer draws it (`mcp-design-draft.render.test.ts`, on the golden document
`fixtures/mcp-design-draft.json`, which `mcp_design_draft.rs` keeps equal to the builder).

`ContentDb::create_assistant_design` is `create_design` (the host's document checks, one transaction)
with the audit row's actor `"<client name> <version> (AI assistant, MCP)"` (from the client's
`initialize`, without control, line-break or text-direction characters) and payload `{ title, kind, source: "mcp", assistant }`. The draft has revision 1 and
no version, so no service or scene can pin it (pins need a version) and nothing reaches a screen.

## Safety

- **Off until the church turns it on:** the switch is read before every call, as for every tool.
- **Rate limit** 30 calls a minute; local stdio only; no network listener; no remote assets.
- **The write handle:** the server keeps its read-only database handle; a save opens
  `ContentDb::open_existing` for that one save and drops it. It never creates the file and never
  migrates: a database a newer Rhema wrote, or one this Rhema has not yet updated, is refused (the
  assistant is told to open Rhema Studio). SQLite's WAL locking with a 5 s busy wait keeps the
  transaction whole beside the running app.
- **No other writes:** there is no tool to save over a design, make a version, delete, pin, approve
  or Take. Refused proposals write nothing; stderr (the assistant's MCP log) gets one line per refusal
  or save, with the assistant's name and the new design's id.
- Text is data: words that look like markup or instructions are stored and drawn as typed.

## Using it

1. Rhema Studio → Settings → AI assistants: turn on access, copy the configuration
   (`{ "mcpServers": { "rhema-studio": { "command": "/Applications/Rhema.app/Contents/MacOS/Rhema", "args": ["--mcp"] } } }`)
   into the assistant (e.g. Claude Desktop's `claude_desktop_config.json`), and restart the assistant.
2. Ask it for a design, e.g. "Make a three-page Harvest Thanksgiving announcement in Yorùbá and
   English with the choir picture". It reads `rhema_get_design_capabilities`, `rhema_get_church_profile`
   (fonts, colours, languages) and `rhema_list_media`, checks with `rhema_validate_design_draft`, then
   saves with `rhema_create_design_draft`.
3. In Rhema Studio → Design → My Designs, open the new design, edit and save it, and make a version
   when it is ready; use that version in Prepare as any other design. If My Designs was already open
   and the new draft is not listed, reopen it.

Not in this slice: revising a draft over MCP, crops and masks, live layers (Bible, song, clock,
camera), brand looks, and any approval or Take.
