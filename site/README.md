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

**Screenshot provenance:** `assets/screenshots/` contains five unaltered 1440 × 900 captures made on October 29, 2026 from the current frontend at source commit `4ed4c6066429e274c5d7b38b9f221b96ac2c0f71`. The frontend was running through `src/dev/browser-shim.ts`; its visible banner says `SIMULATED · No native host · sample data`, and the shim keeps changes in memory. The Home view is empty; Prepare and Live use a synthetic sample service; Library and Design use synthetic examples. These images do not prove native persistence, real host pairing, a browser operator app, receiver output, physical-device behavior, sustained recording, or save/reopen. File-by-file details and the capture limitations are in `assets/screenshots/README.md`. No operator, camera, or private pairing captures are published.

**Important content policy:** Keep implemented code, approved product direction, and device acceptance distinct. Do not claim every operator workspace, Rhema-native recording, connected device, or release is shipped without evidence. The wiki labels known implementation limits and links to the current feature-coverage inventory and approved contracts. Recheck those sources when updating status.

## Legacy `web/` directory and PRs

The inherited OpenBezal Next.js marketing site remains under `web/` for source history. Its `deploy-web.yml` job is **build-only** and the inherited `web/public/CNAME` was removed to prevent accidental publication of `openrhema.com`. Its marketing story and screenshots were not reused for this site because they are stale or do not establish current product behavior. The standalone site under `site/` and its existing Pages workflow remain authoritative.

Upstream attribution: Based on [Rhema by OpenBezal](https://github.com/openbezal/rhema) (MIT license); see repository license and project documentation.
