# Rhema Engage Cloud — Sermon & Service Recall (draft V1)

This directory implements the **public-internet game service**. It is intentionally independent of the church LAN so congregation members may participate over their own mobile-data connections. **The church's normal Rhema Studio presentation does not require this service or any cloud connection.**

## What is implemented

- Public HTTPS browser join at `/join/:code` and spectator/TV display at `/screen/:code`, QR at `/qr/:code`. No phone app, church Wi-Fi or participant account.
- Room creation with a configurable **15–600-second lobby** that starts the first question automatically when the server deadline expires; host Start Now, +30 seconds, Pause/Resume.
- Reviewed 1–20 question games with four options, sermon/service source labels, optional Scripture references, configurable 5–120-second question clocks, manual reveal and next.
- Server-side validation of correct answers; one answer per player per question; 100 points/correct; highest correct count wins, lower cumulative correct-answer response time breaks ties. Participants cannot see answer keys before Reveal.
- Public leaderboard after every reveal *if enabled*, otherwise only at Finish. Host can always see the live board.
- Room TTL 8 hours, maximum 500 participants, maximum 32 KB request, 6-digit codes allocated by single Durable Object directory, per-room Durable Object alarm-backed timing and serialized answer receipt.
- Cloud creation authorized by Worker `ADMIN_KEY`; individual room controls authorized by separately generated bearer token. Client-creation key is not persisted in the local church service.

## Deploy (explicitly opt-in)

From this directory on a Cloudflare account authorized to use **Workers + Durable Objects**:

```sh
npm install
npm test
npx wrangler login
npx wrangler secret put ADMIN_KEY
npx wrangler deploy
```

Use a **long random key** and a stable HTTPS hostname/custom domain. After deployment, open Rhema Studio → Prepare → Add item → Quiz; create/review quiz; save it. Open Present → Engage Quiz, enter the HTTPS origin and private Worker ADMIN_KEY once, click **Create internet quiz lobby**. Show the generated `/screen/123456` URL on a separate congregation display or in an **OBS Browser Source**; congregation members scan its QR or visit the public worker root and enter the code on mobile data. Room countdown starts on creation, not on TV Take.

**No deployment has been carried out by creating this PR.** A public endpoint, Worker plan and key must be configured by an owner before real guests can participate.

## Security and privacy

- Never put `ADMIN_KEY` or returned `hostToken` in public slides, shared service files, screenshot examples or URLs. Host credentials are held in desktop app memory for the session; leaving/restarting the desktop loses the token, not the room.
- Only a **human-reviewed quiz** is transmitted to the cloud on room creation. No raw sermon recording, church member roster, full service, camera feed or local church database is sent.
- Scores and nicknames are public **to those who know the six-digit room code**; avoid putting personal names in the nickname. No contact information is required.
- This pilot does **not** provide strong anti-bot, anti-Sybil or individual identity verification. Cloudflare security rules/rate limiting and nickname moderation need an additional production-hardening slice before large public deployments.
- Room expiration after eight hours is not an immediate guarantee of all infrastructure/log retention policies. Configure Cloudflare account analytics/logs in accordance with church policy.
- Public state is polled approximately every 1.5–1.8 seconds; 500-participant sessions need load/cost tests before deployment at capacity.
- **Fastest Finger is a tie-break**, but mobile-data latency makes millisecond-level fairness imperfect. Consider an accuracy-only result or a fresh tied-player tie-break question in a later release.
- CSP is kept restrictive; public screens never evaluate participant-generated HTML or source content.

## Known gaps / next PRs

- Native Rhema Scene/Live Source integration, animated graphics from Design templates and authorized Take onto actual Rhema congregation/NDI feeds are not yet implemented. This V1 uses an explicitly opened web screen/OBS Browser Source; it never silently changes public presentation. Follow #409/#410.
- Cloud account-level authentication, moderator tools, hosted keychain-backed secrets, per-IP anti-abuse, robust internet reconnect/host takeover, visual QA and physical phone/TV acceptance remain necessary.
- Built-in Scripture question bank, sermon transcript AI drafting, team challenges and historical leaderboards are **not included**. The current editor creates human-approved custom questions.
- The Worker must be tested with a real public domain and phones on different mobile networks before claiming production readiness.

## Automated checks

`npm test` executes portable Node built-in game-rule regression tests. The main repository's Vitest tests cover the service payload and editor validation. Cloudflare Durable Object integration, deployment, actual phones and real TV/OBS are separate release gates.
