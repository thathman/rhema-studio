# Rhema Studio design packs

A design pack is one JSON file (`.rhema-design.json`) of look recipes. Importing it adds its looks
to **Design → Library**, grouped under the pack's name. They work like the built-in looks: the
filters, **Use**, **Use and edit**, **Use with church colours** and **Reset** all apply to them.

Importing never puts anything on air and never changes an output, a camera or a scene. A look
reaches a screen only when you **Use** it (which adds your own copy) and then choose that copy for
an output, or take a scene made from it.

## The Worship Expressions pack

[`rhema-worship-expressions.rhema-design.json`](rhema-worship-expressions.rhema-design.json) has
120 original looks, MIT licensed like Rhema Studio:

It is included in Rhema Studio and appears in **Design → Library** on a fresh install, including
without an Internet connection. No import step is needed. Its **Included offline** label marks the
unchangeable app copy. **Use** or **Use and edit** makes church-owned copies; it never changes an
output or an on-air scene by itself.

- 8 colour families × 8 looks: scripture, song and hymn full screen; notices; keyed scripture and
  lyric bands for OBS and NDI; a name band; a ticker.
- 8 × 5 scene templates: camera and scripture band, camera and lyrics, camera and half-screen
  scripture, a picture behind lyrics, a video behind lyrics.
- 16 more scenes: picture-in-picture, two cameras, picture or video backgrounds, a welcome screen
  with the church logo and a clock, and a graphics-only scene for OBS.

It has no pictures, videos, song lyrics or logos. A picture, video, camera or logo layer is an
empty place: choose your own picture, video or camera for it in **Production → Scenes**, and the
logo comes from your Brand Kit. Use pictures and videos your church owns or is licensed to use.

An older installation may have imported this same pack manually. Rhema removes an unchanged saved
copy during startup, so there is still only one gallery entry. A customized older copy is kept as
the church's local version and temporarily takes the place of the bundled family; removing that
local version restores the bundled one. Imported custom copies are carried in backups; the bundled
recipes are shipped with the app and are not duplicated in backups.

## The format (version 1)

```json
{
  "format": "rhema.design-pack",
  "version": 1,
  "id": "example-pack",
  "name": "Example Pack",
  "author": "Your church",
  "license": "MIT",
  "entries": [
    {
      "id": "bible-night",
      "name": "Bible · Night",
      "from": "look-clean-bible-full",
      "purpose": "Scripture on a dark gradient",
      "variant": { "gradient": ["#08182f", "#31547a"], "foreground": "#ffffff", "accent": "#a5d6e2", "fontSize": 75 }
    },
    {
      "id": "camera-and-bible",
      "name": "Camera and Bible",
      "scene": {
        "background": "#08182f",
        "layers": [
          { "kind": "camera", "name": "Camera", "box": { "x": 0, "y": 0, "w": 50, "h": 100 } },
          { "kind": "feed", "name": "Bible", "shows": ["bible"], "lookId": "bible-night", "box": { "x": 50, "y": 0, "w": 50, "h": 100 } }
        ]
      }
    }
  ]
}
```

- `from` names a built-in look (the ids in `src/lib/look-library-data.ts`); `variant` changes its
  colours and type: `background`, `gradient` (2–5 colours) with `radial`, `foreground`,
  `secondary`, `accent`, `plate`, `plateOpacity`, `fontSize`, `referenceSize`, `fontFamily`,
  `align`, and for bands and tickers `bottom`, `height`, `motion`, `speed`, `label`.
- `scene` lays out a template. Layer kinds: `feed`, `camera`, `color`, `picture`, `video`,
  `clock`, `ticker`, `lowerThird`, `logo`. Boxes are in % of the frame. A feed's `lookId` is a
  theme in the same pack (its entry id) or a built-in theme (`look-…`). The background is a colour
  or `transparent`.

## What is checked

- At most 2 MB and 160 looks. Ids are lower-case letters, digits and dashes, and are unique.
- Colours are `#rgb` or `#rrggbb`. Fonts must be ones Rhema bundles. Every reference must exist.
- Anything else in the file (addresses, file paths, pictures, scripts, unknown fields) is dropped.
- Importing a local pack with the same `id` replaces that local pack; copies already made from it
  stay as they are. IDs shipped with Rhema cannot be newly replaced; give a customized pack a new
  ID instead.
- Imported packs are part of a backup and are checked again when it is restored. Bundled packs
  come with the app and are not copied into backups.
- A future format will have a new `version`; Rhema refuses versions it does not know.
