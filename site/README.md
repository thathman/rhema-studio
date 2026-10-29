# Rhema Studio website

**Canonical public destination:** https://thathman.github.io/rhema-studio/

**Source:** `site/`, a standalone accessible HTML/CSS/JS static site. It intentionally does not use the former `web/` Next.js app, `openrhema.com`, the original Rhema public domain, or their runtime dependencies. The owner-approved Rhema Studio mark is copied verbatim from the `brand-054/web-rhema-studio` brand update.

## GitHub Pages setup (one-time repository admin action)

1. Open **https://github.com/thathman/rhema-studio/settings/pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**. GitHub currently reports `has_pages=false`, so the connected GitHub tool cannot confirm that it has been enabled.
3. Run **Actions → Rhema Studio website — GitHub Pages → Run workflow** (or push a change under `site/` to `main`). The action validates the site and publishes `site/` to the GitHub Pages environment.
4. Verify **https://thathman.github.io/rhema-studio/** after a successful deployment. Do **not** add the old `openrhema.com` CNAME or its DNS records. A GitHub Pages Settings custom domain override, if any, must be removed through GitHub settings.
5. If publishing fails, inspect the workflow run. The site must be enabled and `github-pages` environment approvals must be satisfied; do not label deployment succeeded because the repo was merged.

## Editing

The site deliberately has **zero build dependencies**. The home page is `index.html`; its styles and responsive navigation are `styles.css` and `script.js`. The approved mark is in `assets/`. The static documentation and wiki live in `docs/`, with shared styling and navigation in `docs/docs.css` and `docs/docs.js`.

Run locally:

```bash
cd site
python3 -m http.server 8080
# Open http://localhost:8080/
```

The existing GitHub Pages workflow remains unchanged: it validates the home page and selected relative assets, then publishes `site/` to the same repository Pages destination on its existing main-branch path. It does not publish this preview branch.

**Screenshot provenance:** The six application screenshots on the site are byte-for-byte copies of captures already in the repository, dated October 25, 2026. They show the frontend running in browser-shim development mode with synthetic example data and predate the current Home, Prepare, Live, Library, Design, and History navigation. They are not native-app, connected-host, output, or physical-device acceptance evidence. The excluded operator/camera captures contained pairing credentials or private network details. Do not add those captures publicly.

**Important content policy:** Keep implemented code, approved product direction, and device acceptance distinct. Do not claim every operator workspace, Rhema-native recording, connected device, or release is shipped without evidence. The wiki labels known implementation limits and links to the current feature-coverage inventory and approved contracts. Recheck those sources when updating status.

## Legacy `web/` directory and PRs

The inherited OpenBezal Next.js marketing site remains under `web/` for source history. Its `deploy-web.yml` job is **build-only** and the inherited `web/public/CNAME` was removed to prevent accidental publication of `openrhema.com`. Its marketing story and screenshots were not reused for this site because they are stale or do not establish current product behavior. The standalone site under `site/` and its existing Pages workflow remain authoritative.

Upstream attribution: Based on [Rhema by OpenBezal](https://github.com/openbezal/rhema) (MIT license); see repository license and project documentation.
