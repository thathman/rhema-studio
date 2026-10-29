# Rhema Studio website

**Canonical public destination:** https://thathman.github.io/rhema-studio/

**Source:** \`site/\`, a standalone accessible HTML/CSS/JS static site. It intentionally does not use the former \`web/\` Next.js app, \`openrhema.com\`, the original Rhema public domain, or their runtime dependencies. The owner-approved Rhema Studio mark is copied verbatim from the \`brand-054/web-rhema-studio\` brand update.

## GitHub Pages setup (one-time repository admin action)

1. Open **https://github.com/thathman/rhema-studio/settings/pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**. GitHub currently reports \`has_pages=false\`, so the connected GitHub tool cannot confirm that it has been enabled.
3. Run **Actions → Rhema Studio website — GitHub Pages → Run workflow** (or push a change under \`site/\` to \`main\`). The action validates the site and publishes \`site/\` to the GitHub Pages environment.
4. Verify **https://thathman.github.io/rhema-studio/** after a successful deployment. Do **not** add the old \`openrhema.com\` CNAME or its DNS records. A GitHub Pages Settings custom domain override, if any, must be removed through GitHub settings.
5. If publishing fails, inspect the workflow run. The site must be enabled and \`github-pages\` environment approvals must be satisfied; do not label deployment succeeded because the repo was merged.

## Editing

The site deliberately has **zero build dependencies**. Edit \`index.html\`, \`styles.css\`, \`script.js\` and approved logo in \`assets/\`.

Run locally:

\`\`\`bash
cd site
python3 -m http.server 8080
# Open http://localhost:8080/
\`\`\`

The GitHub Pages workflow validates relative asset URLs and disallows reuse of the original domain.

**Important content policy:** This page describes Rhema Studio's approved product direction **in development**. Do not claim every operator workspace, Rhema Native Recording, connected device or release is shipped without real code/device acceptance. The example Live workstation graphic is a **concept**, not a product screenshot.

## Legacy \`web/\` directory and PRs

The inherited OpenBezal Next.js marketing site remains under \`web/\` for source history. Its \`deploy-web.yml\` job is now **build-only** and the inherited \`web/public/CNAME\` was removed to prevent accidental publication of \`openrhema.com\`. Website PRs #352/#367 target that old Next.js site; their design/technical content should be reviewed for selective reuse rather than deployed as the project's current website. The new site lives under \`site/\` and its own Pages workflow only.

Upstream attribution: Based on [Rhema by OpenBezal](https://github.com/openbezal/rhema) (MIT license); see repository license and project documentation.
