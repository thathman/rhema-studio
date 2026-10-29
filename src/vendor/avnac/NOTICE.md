# Avnac engine code in Rhema Studio

**Source:** [Avnac Studio](https://github.com/striker561/Avnac-Studio), branch `studio`, commit
[`79a4bed4a468d59e21339ad9a62a476aa6264b6f`](https://github.com/striker561/Avnac-Studio/tree/79a4bed4a468d59e21339ad9a62a476aa6264b6f),
directory `frontend/src/lib/`.
**Authors:** striker561 and d3uceY (Avnac Studio, the desktop port), from [Avnac](https://github.com/akinloluwami/avnac)
by akinloluwami. Upstream states "GPL © 2026 striker561, d3uceY".
**Licence:** GNU General Public License version 3 (the full text is in the repository's [LICENSE](../../../LICENSE)).
Rhema Studio as a whole is GPL-3.0-or-later (owner decision with legal sign-off, 29 October 2026; issue #443).

## What was taken

The scene model (Saraswati), its command reducer and render-command builder, the Canvas2D renderer and
the small helpers they import. The editor UI, routing, storage, AI, MCP, Wails bindings and assets were
**not** taken.

- `avnac-document.ts`
- `avnac-shape-geometry.ts`
- `editor-paint.ts`
- `load-google-font.ts`
- `renderer/backends/canvas2d/partial-repaint.ts`
- `renderer/backends/canvas2d/renderer.ts`
- `renderer/backends/canvas2d/shapes.ts`
- `renderer/backends/canvas2d/shared.ts`
- `renderer/backends/canvas2d/text-layout.ts`
- `renderer/backends/canvas2d/text.ts`
- `renderer/dirty-regions.ts`
- `renderer/index.ts`
- `renderer/offscreen-render.ts`
- `renderer/paint-scheduler.ts`
- `renderer/preview.ts`
- `renderer/render-stats.ts`
- `renderer/types.ts`
- `saraswati/commands/reducer.ts`
- `saraswati/commands/types.ts`
- `saraswati/compat/from-avnac-v2.ts`
- `saraswati/compat/from-avnac.ts`
- `saraswati/compat/to-avnac.ts`
- `saraswati/editor/interaction.ts`
- `saraswati/editor/store.ts`
- `saraswati/index.ts`
- `saraswati/render/commands.ts`
- `saraswati/scene.ts`
- `saraswati/spatial/index.ts`
- `saraswati/transform/anchor.ts`
- `saraswati/types.ts`
- `saraswati/utils/index.ts`
- `saraswati/utils/placement.ts`
- `saraswati/utils/pointer.ts`
- `saraswati/utils/shape-labels.ts`
- `saraswati/utils/text.ts`

## Changes made in Rhema Studio (29 October 2026)

- `@/lib/...` imports rewritten as relative paths, since everything lives under `src/vendor/avnac/`.
- `renderer/backends/pixi/` removed: it was not exported upstream and `pixi.js` is not a dependency.
- `load-google-font.ts` replaced by a Rhema version with the two functions the renderer uses. Rhema works
  offline and never fetches fonts from Google; fonts resolve from the computer and Rhema's bundled fonts.
- `renderer/dirty-regions.ts`: `let merged` became `const merged` (lint).
- `saraswati/spatial/index.ts`: a lint exception on the deprecated no-op `setSaraswatiInteractionScale`.
- Added `avnac-engine.test.ts` (Rhema's compatibility tests). Nothing else in these files is changed.

When updating from upstream, keep this file and repeat the changes above.
