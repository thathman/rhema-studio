# 48 · Keeping the Receiver and Rhema Cam paired when the Mac's address changes

Status: **design for owner/Codex review — no code yet.**
Problem (confirmed on device, 2026-11-11): after a DHCP change, the Rhema Receiver (Google TV, `android-tv/`) and Rhema Cam (`android-camera/`) keep the Mac's old address and never find it again by themselves.

## Why it breaks today

| Piece | What it does now | Why a new address breaks it |
|---|---|---|
| Host `follow_address` / `address_cert` (`src-tauri/src/commands/remote.rs`) | Each new LAN address gets a new leaf certificate **with a new key** (`make_server` → `KeyPair::generate`, `crates/api/src/tls.rs`). | Nothing about the new certificate matches what devices pinned. |
| Receiver | Pins SHA-256 of the **whole leaf certificate DER** (`prefs "pin"`, from the sealed `/show` `certFingerprint`); checked in `MainActivity.onReceivedSslError`. Stores the feed URL with the IP in it. | The new cert has a different hash → `NOT_THAT_RHEMA`. It never looks for the new address either. |
| Rhema Cam | Pins SHA-256 of the RTSPS leaf DER (`fp` in the pairing link; `Publisher.Pin`, `Report.Pin`). Stores `host`. Names are not checked. | The camera router keeps serving the startup cert while Rhema runs, so the pin holds until Rhema restarts at the new address — but the camera still dials the old IP. After a restart the router's cert is new → pin fails. |
| Host server cert renewal | A leaf older than 365 days is replaced with a new key too. | Same break, once a year, with no address change at all. |

So mDNS rediscovery alone cannot work: the TLS check at the new address fails by design. The fix is to change **what is pinned**, then add rediscovery.

## Options

### (a) Stable server key — pin the SPKI

The host generates **one long-lived server key pair** (kept like the CA key: `tls/rhema-server-key.pem`, 0600) and signs every per-address/renewed certificate over that same key. Devices pin `SHA-256(SubjectPublicKeyInfo DER)` instead of `SHA-256(cert DER)`. Phones/browsers (Comms) still get a cert whose SAN matches the address they dial, so nothing changes for them.

- **LAN spoofing:** an impostor at the new address (or a device that inherited the old IP) does not have the key, so the pin fails exactly as today. Names are still ignored by the pinned devices, as today.
- **Stolen old cert:** worthless — certificates are public, only the key matters. **Stolen server key:** the attacker can impersonate this host to paired devices until they re-pair. Today a stolen leaf key gives the same until the next address change; the key sits in the same folder as the CA key, so the exposure is no worse than (b). Recovery: "Reset https keys" makes a new CA + server key, and every device re-pairs (that already happens today on a new CA).
- **Migration:** keep the key of today's `rhema-server.key` as the stable key (adopt, don't regenerate), so certs already pinned stay served until the address changes. Devices accept **either** the legacy cert hash **or** the SPKI hash; on the first connection where the legacy hash matches, they store the SPKI hash computed from that same verified cert (trust upgrade over an already-pinned connection, no user action). Host sends both: `/show` gets `keyFingerprint` next to `certFingerprint`; the camera link gets `key=` next to `fp=`. Old apps ignore the new field (the Cam parser keeps unknown keys in the map and never reads them; the Receiver reads only the JSON fields it knows) — confirm both in the implementation PR.
- **Android API:** fine at minSdk 24 (Receiver) / 26 (Cam). Receiver: API 29+ `SslCertificate.getX509Certificate().getPublicKey().getEncoded()`; below 29, the DER is already read from `SslCertificate.saveState(...)."x509-certificate"` (`MainActivity.fingerprint`), parsed with `CertificateFactory.getInstance("X.509")` (API 1). Cam: `chain[0].getPublicKey().getEncoded()` in the existing `X509TrustManager`. `getEncoded()` on a public key is the SPKI DER, the same bytes `rcgen`'s `public_key_der()` hashes on the host.
- **Size:** host ~20 lines (load-or-create key, pass it to `make_server`, SPKI fingerprint fn); devices ~15 lines each.

### (b) Pin the local CA, verify the chain on the device

Devices pin the Rhema CA (Companion already does this: `join.rs` pins the host's CA fingerprint), and accept any leaf the CA signed for a private address.

- **LAN spoofing:** same protection as (a) while the CA key is safe; the CA's name constraints limit it to private ranges.
- **Stolen CA key:** worse than (a) — the attacker can mint certs for any private address, for every device of this church. Both keys live in the same `tls/` folder, so (b) is not safer against disk theft; it only lets the host rotate leaf keys without re-pairing, which we never need.
- **Migration:** same dual-accept/upgrade as (a), but the device needs the CA **certificate**, not just its hash, to check signatures: sent in `/show` and the camera link (QR gets ~500 bytes larger), or fetched from `/rhema-ca.pem` over the legacy-pinned connection.
- **Android API — the hard part:** the WebView's `onReceivedSslError` hands the Receiver **only the leaf** (`SslError.getCertificate()`), not the chain, so the TV must re-implement chain checking by hand: `leaf.verify(caPublicKey)` (`SHA256withECDSA`, available on 24), validity dates, key usage, and the CA's name constraints. A Network Security Config `<trust-anchors>` cannot help: the CA is different for every church and unknown at build time, and the WebView's own verifier is not driven by it for runtime anchors. On the Cam, a custom `TrustManagerFactory` with a runtime `KeyStore` holding the CA works (API 1), but MediaMTX must then serve the full chain in `rtspServerCert` (to check).
- **Size:** noticeably more device code, and hand-rolled X.509 checks are where security bugs live.

### (c) Re-pairing UX only

Keep the pin model; when the pin or the address fails, the Receiver says "Rhema Studio moved — send the feed again from Rhema" and the Cam says "Scan the camera link again".

- **Security:** unchanged (the strongest: nothing new is trusted).
- **Migration:** none.
- **Android API:** none.
- **Cost:** someone has to walk to the TV/phone and the Mac, usually mid-service when a lease renews or the router reboots. Every cert renewal (yearly) also forces it. This is the fallback we need anyway (new CA, reset keys, nothing found), not a fix.

### Rejected: host re-sends `/show` to known TVs

The host could push the new URL to each TV it finds on `_rhema-tv._tcp`. But the `/show` key comes from the one-time code exchange (`tv_proof.rs`) and is not kept; keeping a long-term per-TV key is a bigger protocol change than (a), and it does nothing for Rhema Cam.

## Rediscovery over the existing host advert

The host already announces `_rhema-host._tcp` (`src/commands/host_advert.rs`, `mdns-sd` with `enable_addr_auto`, so the A record follows the new address) with TXT `v=1` and `tls=<https port>`.

1. **Host:** add TXT `k=<first 16 hex of the SPKI hash>`. A filter hint only, so a device can skip other Rhema hosts on the same network; it is not trusted (anyone can announce it) and leaks nothing (the cert is served to anyone who connects).
2. **Device trigger:** the stored address fails (connect refused/timeout, or the pin fails) for ~10 s → browse `_rhema-host._tcp` with `NsdManager` (API 16+, TXT via `getAttributes()` API 21+; resolve candidates one at a time — before API 34 `resolveService` allows only one at a time; on 34 use `registerServiceInfoCallback`).
3. **Accept:** for each candidate whose `k` matches, open TLS to `candidate:tls` (Receiver) / `candidate:rtsps port` (Cam) and require the SPKI pin. Only a pin match rewrites the stored host; the URL path and token are kept (the feed token is checked by path, not by Host header — confirm in the PR). Persist, then reload/reconnect.
4. **Nothing found** after ~2 min of browsing → the (c) message, while browsing continues in the background.

The Receiver already uses `NsdManager` (it registers `_rhema-tv._tcp`), so no new permission or library. The Cam needs `NsdManager` too (no new permission; `INTERNET` is enough).

## Recommendation

**(a) stable server key + SPKI pin, with (c) as the fallback message, and rediscovery as above.** It is the smallest change, uses only APIs the devices already call, keeps the WebView path free of hand-written chain checks, migrates paired devices without anyone touching them, and also ends the yearly renewal break. (b) buys only leaf-key rotation, which we don't use, at the cost of more and riskier device code and a wider blast radius if its key leaks.

Build order (each its own PR, ≤2 open at once):

1. **Host:** stable server key (adopt the current one), SPKI fingerprint, send `keyFingerprint` / `key=` alongside the old fields, TXT `k=`. Old devices keep working unchanged. Tests: same SPKI across addresses and renewals; DER changes; adoption keeps the current key.
2. **Receiver:** dual-accept + upgrade, rediscovery, "moved" message. Java test for SPKI/legacy matching (runs in `android-tv/build.sh`); device check on the Onn TV.
3. **Rhema Cam:** same, in `Publisher.Pin` / `Report.Pin` and `Pairing`.

Device acceptance: pair TV and Cam, change the Mac's address (owner-side: a different DHCP reservation, or switch Wi-Fi), and both come back by themselves within ~30 s with no taps; a second Mac running Rhema on the same network is never accepted.

Open questions for the owner: OK to keep one server key for the life of the CA (rotated only by "Reset https keys")? Any objection to the `k=` TXT hint?

## Decision (12 Nov 2026)

The owner delegated this decision. Accepted: option (a), one stable server key for the life of the local CA, pinned by SPKI. Migration needs no taps: the devices accept the legacy leaf hash once and upgrade to the SPKI pin over the verified connection. Rediscovery uses `_rhema-host._tcp` with the `k=` TXT hint. Re-pairing (c) stays as the fallback message. Both open questions: yes. Build order: host, Receiver, Cam, one PR each.

### As built on the host (milestone 1)

- The server key is `tls/rhema-server-key.pem` (0600, written to a private temporary file and renamed into place, like the CA key; both are made private again whenever they are read).
- **Adoption happens once.** At the first start after the upgrade (no `tls/rhema-server-key.made` marker yet), the key of the certificate Rhema serves (`rhema-server.key`) is adopted, and only when its public key matches `rhema-server.pem`. After that, a missing or unreadable server key is replaced by a **new** key (paired TVs and cameras pair again), never re-adopted from a certificate's key file, which may be the one that leaked.
- **"Reset https keys"** is the host command `reset_https_keys` (main desk only, `window_acl`). It removes `rhema-ca.*`, the server key and every `rhema-server*` certificate, makes a new CA, server key and certificate, and restarts https for phone pages and the camera router when they were on. Every Receiver, Rhema Cam and Companion must pair again, and the result says so. The Settings button that calls it is left to the UI owner.

### As built on the Receiver (milestone 2, Receiver 1.8.0.0)

- **Pins** (`android-tv/.../KeyPin.java`): a `/show` with `keyFingerprint` stores only the key pin (`prefs "keyPin"`); one from an older Rhema stores the certificate pin (`"pin"`) as before. A present but malformed `keyFingerprint` is refused. `onReceivedSslError` hashes the leaf the WebView gives (API 29+ `getX509Certificate()`, else the DER in `saveState(...)."x509-certificate"`, parsed with `CertificateFactory`) and its `getPublicKey().getEncoded()`. With a key pin, only that key opens the page. With only the certificate pin, that exact certificate opens it and its key pin replaces the certificate pin (zero taps); a different certificate is refused, even over the same key, until that upgrade has happened.
- **Rediscovery** (`Rediscovery.java`): about 10 s after the feed first fails to open (unreachable, or the wrong key at the old address), and only while the feed is on screen and pinned by key, the TV browses `_rhema-host._tcp` for 30 s, resolving one service at a time. It skips any service whose `k=` is not the first 16 hex of its key pin, then opens TLS to `<IPv4>:<tls>` and requires the whole key pin, within 4 s in all. Checks run one at a time. `ProbeQueue` (the same as Rhema Cam's) allows at most 2 addresses per service and 8 waiting. It keeps addresses turned away for want of room, and checks that could not start, aside and unmarked: up to 32 of them, with a random one giving way when that is full. It puts the last-known host first and takes the rest in random order, so one announcer cannot starve the real host. A browse with checks still waiting goes on past 30 s, up to 60 s. Any HTTP answer from the pinned host (403, 401, 5xx) ends the looking. The server must complete the handshake, which proves it holds the key. Only then does the TV rewrite the address in the stored feed link (same path and key; the host accepts any IP literal on its ports), the sender address used by Identify, and the kept picture's link, and then reload. Between browses it waits 15 s, then 30 s, then 60 s, and at most 120 s after that. Browsing stops when the feed opens, when a new feed or a 403 arrives, or when the app leaves the screen (`onStop`).
- **Fallback:** after 2 minutes of looking, the existing failure words gain a first line: "Rhema Studio may have moved to another address: this TV keeps looking for it." The code screen and "send the feed again" stay as before.
- **Limits:** a TV still holding only a certificate pin cannot rediscover (an old certificate does not identify the key until it has opened once at its old address). Only IPv4 addresses are used. Before Android 14 the TV uses `resolveService`, one call at a time. On 14 and later it still calls the same method, which is deprecated but works.
