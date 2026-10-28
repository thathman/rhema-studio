# Rhema Engage Cloud — Sermon & Service Recall (draft V1)

This directory implements the **public-internet game service**. It is intentionally independent of the church LAN so congregation members may participate over their own mobile-data connections. **The church's normal Rhema Studio presentation does not require this service or any cloud connection.**

## What is implemented

- Public HTTPS browser join at `/join/:code` and spectator/TV display at `/screen/:code`, QR at `/qr/:code`. No phone app, church Wi-Fi or participant account.
- Room creation with a configurable **15–600-second lobby** that starts the first question automatically when the server deadline expires; host Start Now, +30 seconds, Pause/Resume.
- Reviewed 1–20 question games with four options, sermon/service source labels, optional Scripture references, configurable 5–120-second question clocks, manual reveal and next.
- Server-side validation of correct answers; one answer per player per question; 100 points/correct; highest correct count wins, lower cumulative correct-answer response time breaks ties. Participants cannot see answer keys before Reveal.
- Public leaderboard after every reveal *if enabled*, otherwise only at Finish. Host can always see the live board.
- Room TTL 8 hours, maximum 500 participants, maximum 32 KB streamed request bodies, eight-digit codes allocated by a single Durable Object directory, per-room Durable Object alarm-backed timing and serialized answer receipt.
- Cloud creation authorized by Worker `ADMIN_KEY`; failed host-key attempts are rate-limited. The Worker signs room-bound host, participant and display tokens with `SESSION_SIGNING_KEY`. Room state cannot be read with the eight-digit code alone. The client-creation key is not persisted in the local church service.
- Cloudflare Turnstile protects participant joins; pre-challenge attempts have separate per-address throttling (up to 1,000 per 15 minutes) so a large congregation behind one shared network address can join and failed challenges do not consume verified room-join capacity. The Durable Object directory rate-limits room creation, host-key attempts, invalid-code probes and verified joins. Temporary rate-limit storage is capped and expires by alarm. A host can delete all quiz and participant data immediately from the Live Engage panel.

## Deploy (explicitly opt-in)

From this directory on a Cloudflare account authorized to use **Workers + Durable Objects**:

```sh
npm ci
npm test
npx wrangler login
npx wrangler secret put ADMIN_KEY
npx wrangler secret put SESSION_SIGNING_KEY
npx wrangler secret put TURNSTILE_SITE_KEY
npx wrangler secret put TURNSTILE_SECRET
npx wrangler deploy
```

Use a **long random `ADMIN_KEY`**, a separate random `SESSION_SIGNING_KEY` of at least 32 bytes, a Cloudflare Turnstile site configured for the Worker hostname, and a stable HTTPS hostname/custom domain. Keep all four values in Worker secrets; do not commit them. After deployment, open Rhema Studio → Prepare → Add item → Quiz; create/review quiz; save it. Open Live → Engage Quiz, enter the HTTPS origin and private Worker ADMIN_KEY once, click **Create internet quiz lobby**. Open the generated secure screen link on a designated display or in an **OBS Browser Source**; congregation members scan its QR or visit the public worker root and enter the eight-digit code on mobile data. Room countdown starts on creation, not on TV Take.

**No deployment has been carried out by creating this PR.** A public endpoint, Worker plan and key must be configured by an owner before real guests can participate.

## Security and privacy

- Never put `ADMIN_KEY` or the host token in public slides, shared service files or screenshots. Host credentials are held in desktop app memory for the session; leaving/restarting the desktop loses the token, not the room. The screen URL is a read-only bearer link for the designated public display; its signed token is in the URL fragment, which browsers do not send to the Worker or as a referrer.
- State requests require a signed host, participant or screen token bound to that room. Guessing the eight-digit code alone does not reveal its title, questions, participants or answers. Rotating `SESSION_SIGNING_KEY` invalidates active host, participant and screen sessions; delete or let active rooms expire before rotating it.
- The desktop flow sends a quiz only after its human-review box is checked, and the Worker requires the `reviewed` flag. This is a workflow guard, not independent reviewer attestation: anyone holding `ADMIN_KEY` is trusted to submit approved content and can call the API directly. No raw sermon recording, church member roster, full service, camera feed or local church database is sent.
- Scores and nicknames are visible to joined participants and anyone with the secure read-only screen link; avoid putting personal names in the nickname. The eight-digit room code alone does not grant access to state. No contact information is required. Turnstile and rate limits reduce automated joins and code probing, but do not prove individual identity or prevent a determined Sybil attack.
- The host can delete quiz, nickname and answer data immediately. Otherwise, the room becomes inaccessible after eight hours and its Durable Object alarm deletes its stored data. The directory stores only keyed HMAC-derived, pseudonymous client identifiers for short rate-limit windows; it never stores raw client IPs or a reversible address hash. Storage caps are isolated by limiter category: pre-challenge attempts and verified active joins each have a 4,096-bucket global cap; pre-challenge attempts allow 1,000 per address per 15 minutes; active joins also have a 600-bucket per-room cap. Failed challenge attempts do not create active-join buckets. A full invalid-code bucket does not consume failed-host or active-join capacity. New keys in a full category fail closed until expired buckets are cleared. These controls do not change Cloudflare account analytics/log retention. Configure those policies in accordance with church policy.
- Public state is polled approximately every 1.5–1.8 seconds; 500-participant sessions need load/cost tests before deployment at capacity.
- **Fastest Finger is a tie-break**, but mobile-data latency makes millisecond-level fairness imperfect. Consider an accuracy-only result or a fresh tied-player tie-break question in a later release.
- CSP is kept restrictive; public screens never evaluate participant-generated HTML or source content.

## Remaining release validation

- Native Rhema Scene/Live Source integration, animated graphics from Design templates and authorized Take onto actual Rhema congregation/NDI feeds are not yet implemented. This V1 uses an explicitly opened web screen/OBS Browser Source; it never silently changes public presentation. Follow #409/#410.
- Cloudflare account-level authentication, moderator tools, hosted keychain-backed secrets, robust internet reconnect/host takeover, load testing, visual QA and physical phone/TV acceptance remain necessary.
- Built-in Scripture question bank, sermon transcript AI drafting, team challenges and historical leaderboards are **not included**. The current editor creates human-approved custom questions.
- The Worker must be tested with a real public domain and phones on different mobile networks before claiming production readiness.

## Automated checks

`npm test` executes portable Node built-in game-rule regression tests. The main repository's Vitest tests cover the service payload and editor validation. Cloudflare Durable Object integration, deployment, actual phones and real TV/OBS are separate release gates.
