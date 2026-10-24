# Rhema Studio portable design packs (v1)

**File extension:** `.rhema-design.json` (UTF-8 JSON)  
**Format identifier:** `rhema.design-pack` · **Version:** `1`

## Install the Worship Expressions pack

1. Download [rhema-worship-expressions.rhema-design.json](rhema-worship-expressions.rhema-design.json) from this repository.
2. Open **Rhema Studio → Design → Library → Import design pack**.
3. Choose the downloaded file and review the confirmation. The 120 entries appear in Design Library.
4. Pick a design and choose **Use** (or **Use and edit**). This creates your own editable copy. For a scene, use it in Production → Scenes.
5. Only deliberately assigning a copied design to an output or **taking a scene** changes what an audience sees. Import alone **never** alters Live sources, OBS, NDI, current service, or output routing.

The pack includes **8 stylistic families/palettes × 8 source looks** (Bible fullscreen, lyrics fullscreen, hymn fullscreen, announcements, Bible lower-third, lyric lower-third, speaker lower-third, ticker), **8 × 5 camera-and-source scenes**, and **16 additional production compositions** = **120** portable items.

The media-enabled scenes are **editable templates**, not videos or images: a picture background is a picture-layer placeholder, a motion background is a muted video-layer placeholder, and a camera is a LAN camera placeholder. Assign an appropriate local image/video/camera source from Rhema's Media Library or scene editor before trying to present those elements. The text looks, gradients, alpha-overlays and other native graphics render offline without any external assets.

### Resource and licensing suggestions (optional)

Rhema can use your church's owned photography/videos or appropriately licensed free stock footage as local media. These providers were checked for their published licensing terms:

- [Pexels photos and videos](https://www.pexels.com/legal-pages/license/) — free for many uses; don't redistribute the unmodified stock as a competing stock product or imply endorsement.
- [Unsplash photos](https://unsplash.com/license) — broad free image licence; redistribution as a competing collection is restricted.
- [Mixkit stock videos](https://mixkit.co/license/) — check the **individual clip's** licence. Mixkit distinguishes *Video Free* from *Video Restricted* (non-commercial only).

No third-party asset is copied into this pack. Verify the exact clip/photo's terms before including it in a redistributed bundle and respect third-party privacy/trademark rights.

## Authoring format

A single file contains a manifest and entries:

```json
{
  "format": "rhema.design-pack",
  "version": 1,
  "id": "example-church-pack",
  "name": "Example Church Pack",
  "author": "Your church",
  "license": "MIT",
  "entries": [
    {
      "id": "bible-night",
      "name": "Bible · Midnight",
      "from": "look-clean-bible-full",
      "purpose": "Readable Scripture against a muted gradient",
      "variant": {
        "gradient": ["#08182f", "#31547a", "#08182f"],
        "foreground": "#ffffff",
        "secondary": "#c4d9e9",
        "accent": "#a5d6e2",
        "fontSize": 75
      }
    },
    {
      "id": "camera-and-bible",
      "name": "Camera + Bible",
      "scene": {
        "background": "#08182f",
        "layers": [
          { "kind": "camera", "name": "Camera placeholder", "box": { "x": 0, "y": 0, "w": 50, "h": 100 } },
          { "kind": "feed", "name": "Bible", "shows": ["bible"], "lookId": "bible-night", "box": { "x": 50, "y": 0, "w": 50, "h": 100 } }
        ]
      }
    }
  ]
}
```

`from` must reference an existing built-in design ID in `src/lib/look-library-data.ts`. `lookId` references another theme in the same pack by its entry ID (or a built-in look ID beginning `look-`). The importer expands it to a stable ID `pack-id/entry-id`, validates references, and derives the actual Rhema theme/style/scene types; it doesn't execute code or fetch remote URLs.

**Supported recipe kinds** are existing full-screen/keyed themes, ticker styles, presenter lower thirds and Stage styles via `from`, or new scene layouts via `scene`. Scene layers support `camera`, `feed`, `picture`, `video`, `color`, `ticker`, `lowerThird`, `clock` and `logo`. Picture/video layers intentionally have no media URL in the pack and require a local assignment later. Supported colour variants: `background`, `gradient`, `radial`, `foreground`, `secondary`, `accent`, `plate`, `plateOpacity`, `fontSize`, `referenceSize`, `fontFamily`, `align`, `bottom`, `height`, `motion`, `speed`, `label`.

## Safety and compatibility

- 2 MB maximum JSON and 160 entries per file. Duplicate IDs, unsafe colours, invalid geometry and missing source/theme references are rejected.
- Only existing bundled fonts are accepted. JSON cannot inject remote assets, external stylesheets, JavaScript, third-party audio or Tauri file paths.
- Reimporting the same pack ID updates its catalog entries; previously created *copies* keep their identities and are not overwritten.
- Pack IDs are namespaced. Original built-in themes and current saved outputs are not deleted.
- User chooses **Use** before copying any design; OBS/sanctuary and other output targets are never changed by the import itself.
- The portable format uses known built-in reference IDs; a compatible Rhema Studio version with the source looks is required. Standalone full-content exports (including optional media attachments) can be added in a future version after a signed/hashed, path-safe media asset schema has been developed.
- Future formats should increment `version` and migrate explicitly; do not silently accept unknown versions.

**Current build status:** source integration committed on a feature branch and must pass desktop/Vitest/real render checks before being declared merged or production-ready.
