# Legacy inherited Rhema marketing site — not Rhema Studio's public website

This `web/` Next.js application belongs to the original Rhema/OpenBezal website codebase. It is retained for reference and existing historical documentation, **not** deployed by Rhema Studio.

**Current Rhema Studio website source:** [`site/`](../site/README.md). **GitHub Pages destination:** https://thathman.github.io/rhema-studio/.

The previous `openrhema.com` CNAME has been removed. The legacy `.github/workflows/deploy-web.yml` workflow is now **build-verification-only** and cannot publish a site. No ordinary change to `web/` should deploy to the old domain.

If future work migrates any of these pages into the canonical site, rewrite unsupported historical Built/Checked status claims, reuse approved brand assets, and implement it through the `site/` deployment workflow with independent review.

## Local legacy build

```bash
cd web
bun install
bun run dev
bun run build
```

This does not publish a site.

Based on [Rhema by OpenBezal](https://github.com/openbezal/rhema).