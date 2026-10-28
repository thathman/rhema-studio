# 11 — Canva Connect API: what is actually possible (CV-001)

Status: **research, verified against canva.dev on 2026-10-20.** No code. Decides how
Milestone 6 (Canva and Brand Kits) can be built without assuming features that do not exist.

## 1. Facts verified

| Question | Finding | Source |
|---|---|---|
| How does an app authenticate? | OAuth 2.0 Authorization Code with PKCE (S256). Token exchange uses HTTP Basic `client_id:client_secret` and **must come from a backend** (browser calls are blocked by CORS); the `code_verifier` must never reach the browser. Access tokens are short-lived; refresh tokens are single-use and rotate. Introspect and revoke endpoints exist. At least one redirect URL must be configured in the Developer Portal. | canva.dev/docs/connect/authentication |
| What can a design export produce? | `POST /rest/v1/exports` (scope `design:content:read`), asynchronous job polled with Get export job; download URLs expire after 24 h. Formats: pdf, jpg, png, gif, pptx, mp4, html, csv. PNG `transparent_background` and lossy PNG **require a paid plan**; `export_quality: pro` fails on premium elements the user has not licensed. | canva.dev/docs/connect/api-reference/exports/create-design-export-job |
| Rate limits on export | 20 requests/min/user; app 750 per 5 min and 5,000 per day; per document 75 per 5 min; per user 75 per 5 min and 500 per day. | same |
| Can Rhema fill a template with data (announcement title, date)? | Autofill `POST /rest/v1/autofills` (scope `design:content:write`) from a brand template, a design with data fields, or by updating a design; fields: text, image/video (by asset id), chart, sheet. **Available only when the user is on Canva Pro (incl. Education/Nonprofits), Teams or Enterprise.** Unknown field names are silently skipped. 60 requests/min/user. | canva.dev/docs/connect/api-reference/autofills/create-design-autofill-job |
| Brand templates | Scopes `brandtemplate:meta:read` / `brandtemplate:content:read`; tied to the user's brand (Pro/Teams/Enterprise feature). | canva.dev/docs/connect/appendix/scopes |
| Scopes relevant to Rhema | `design:meta:read`, `design:content:read` (export), `asset:read`/`asset:write` (upload church logos/photos), `brandtemplate:*` (templates), `design:content:write` (create/autofill), `profile:read`. Scopes are not implied by one another; each must be requested. No scope is itself plan-gated. | same |
| Private vs public integration | **Private** integrations are usable only by the creating team and **require a Canva Enterprise plan**; no Canva review. **Public** integrations are reviewed by Canva before release and must not use preview APIs; while under review no settings can be changed. The type cannot be changed after creation. | canva.dev/docs/connect/creating-integrations, canva.dev/docs/connect/submission-checklist |
| Preview APIs | Not for production; public apps using them fail review. | canva.dev/docs/connect |

## 2. What this means for Rhema Studio

1. **A desktop app cannot hold the client secret.** The token exchange must run on a small backend Rhema controls (a tiny hosted relay, or a self-hosted one the church runs). This is the first recurring-cost decision of Milestone 6 and needs the owner's approval before CV-002. Until then, Canva work is limited to designs the church exports by hand and imports as pictures (already possible with MD-001/MD-002).
2. **The integration type must be public.** A private integration needs Enterprise, which small churches do not have. Public means Canva review, no preview APIs, and a published privacy policy and support contact.
3. **"Edit in Canva, export, import" is the realistic flow** (CV-003): open the design in Canva's web editor (deep link), then export via the API as PNG/PDF/MP4 and import into the media library (hash-identified, offline afterwards). Transparent PNG needs a paid Canva plan; Rhema must show the `license_required` / `approval_required` errors plainly and never block presentation on them.
4. **Autofill (CV-006) is Pro/Teams/Enterprise only.** Design it as an optional accelerator with a clear "needs Canva Pro" message, not as the only way to make announcements. Native templates (CV-005) stay the default path.
5. **Offline rule holds.** Exports are files in the media folder; Canva is never needed during a service. Download URLs expire in 24 h, so Rhema must download immediately after the job succeeds, never store the URL.
6. **Rate limits are generous for a church** (hundreds of exports a day) but the app-wide 5,000/day cap means a hosted relay shared by many churches needs its own quota handling.

## 3. Recommended sequencing (Milestone 6)

1. Owner decision: hosted relay vs self-hosted relay, and whether to apply for a public integration (needs a privacy policy and support contact). **Blocks CV-002.**
2. CV-005 native announcement templates first (no Canva dependency): title/date/body fields over a Church Brand Kit (CV-004), rendered by the existing renderer.
3. CV-002/CV-003 once the relay exists: connect, list designs (`design:meta:read`), export PNG → media library, "Open in Canva" link; show plan-related export errors verbatim.
4. CV-006 autofill behind a capability check (plan detected from the autofill error, not assumed).

## 4. Sources

- https://www.canva.dev/docs/connect/
- https://www.canva.dev/docs/connect/authentication/
- https://www.canva.dev/docs/connect/appendix/scopes/
- https://www.canva.dev/docs/connect/api-reference/exports/create-design-export-job/
- https://www.canva.dev/docs/connect/api-reference/autofills/create-design-autofill-job/
- https://www.canva.dev/docs/connect/creating-integrations/
- https://www.canva.dev/docs/connect/submission-checklist/
