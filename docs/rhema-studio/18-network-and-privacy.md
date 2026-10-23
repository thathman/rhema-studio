# Network connections and privacy (NFR-09)

Rhema Studio presents with no internet connection. There is no telemetry, no analytics, no crash upload and no automatic update check. Everything the app stores (services, songs, media, logs, settings) stays in its data folder on this computer until the operator exports it.

`src/lib/network-hosts.test.ts` fails the build if code names an internet host that is not listed there with a reason, so a new connection cannot slip in unnoticed.

## Connections the app can make

| Connection | When | What is sent | Off by default? |
|---|---|---|---|
| Deepgram speech recognition (`api.deepgram.com`, upstream feature) | Only when the speech provider is Deepgram (the upstream default), a key is entered, listening is started, **and someone on this computer has agreed** in the consent dialog shown before the first cloud session (withdrawable in Settings → Speech Recognition) | Microphone audio while listening | Yes: speech is optional and nothing is sent before consent; the Present chip reads "Listening (Deepgram)" while it is sent |
| OBS WebSocket (address the operator types, usually this computer) | Only after "Connect to OBS" is ticked | Recording start/stop, chapter marks; the password proof, never the password | Yes |
| NDI (local network) | Only for outputs set to NDI | The output picture, to NDI receivers on the network | Yes |
| Remote control (OSC and HTTP, incoming) | Only while the operator has started a listener | Nothing leaves; devices on the network send commands in | Yes |
| Phone remote page (incoming) | Served by the HTTP listener above | The page and the live reference text to paired phones | Yes |
| Host/Join: Live State (incoming, `/api/v1/live`, `/api/v1/live/events`, `/api/v1/me`) | Served by the HTTP listener to **paired** devices only (with keys off, to this computer only) | What is on the screens, each live source's reference, the event clock, the run of show (titles, planned minutes), timing, the stage message; never a secret, a picture or the transcript | Yes |
| Browser feeds (incoming, `/feed/<id>`, `/api/v1/feed/<id>/events`, `/assets/…`) | Only for outputs of kind Browser Feed that are on, while the HTTP listener runs | The frame that output shows (text, looks with their pictures, lower third, ticker) to whoever has the feed's link with its secret; `/assets/` serves only the app's built page code; the page sends back only the number of the frame it drew (`/api/v1/feed/<id>/ack`) | Yes |
| Rhema Comms: production notices (over the Host/Join listener) | Only between the host and paired devices | Short messages (280 characters), who sent them, their answers, an optional action request (a reference, scene or item id); kept in memory on the host for the session (last 100), never on a screen or in the service log | Yes |
| Rhema Comms: talk channel (WebRTC on the LAN, signalled over the Host/Join listener) | Only while a paired desk has joined the talk channel | The voices of those holding Talk, between the host and the paired desks only; LAN addresses only (no STUN, TURN or cloud); never recorded, transcribed or sent to an assistant | Yes |
| Phone pages over https (incoming, the HTTP port + 1) | Only with "Secure page for phones (https)" ticked, while the HTTP listener runs | The same pages and API as http, encrypted; the certificate is made on this computer by a local certificate authority (its private key stays in the app's data folder, readable only by this user); `/rhema-ca.pem` serves the CA's public certificate so phones can trust it; the CA is limited (X.509 name constraints) to private network addresses and localhost, so a phone that installed it trusts it for nothing else, even if its key were stolen | Yes |
| Host/Join: joining another Rhema (outgoing) | Only after the operator types a host's address and pairing code (Production → Operators) | The pairing code and this computer's name, then the commands its role allows; the token is kept in the keychain | Yes |
| Rhema MCP for AI assistants (local, stdio) | Only when an assistant on this computer starts `Rhema --mcp` **and** Settings → AI assistants is on | To that assistant only: services and run of show, song and hymn titles and numbers (no lyrics), Bible text from the installed editions; a proposed service is saved only as a draft file for review; nothing leaves the computer from Rhema itself (an online assistant sends its own conversation to its provider) | Yes |
| QR link slides | Never by the app; the code only shows an address for people to scan | Nothing | n/a |

Keys the settings file can hold for later providers (`openaiApiKey`, `claudeApiKey`) are not used by any code on `main` (the OpenAI speech provider is parked in PR #4).

## Transcripts on this computer

Recognised speech is kept in memory while the app runs. It is written to a kept service log only when "Include what was said" is ticked for that log (More → Library → Service log; off every time), and then stays there, searchable, until the log is deleted. Short fragments can also appear in the app's own log files (see the consent text).

## Not yet done

- An offline network capture on a real desktop (PRD release evidence for NFR-09): run the app through a service with a packet capture (Wireshark or `tcpdump`) and confirm that only the rows above appear. Acceptance row 10an.
- Consent before cloud transcription: done for Deepgram (asked once per computer before the first cloud session; says what is sent, to whom, and offers local recognition instead). Any provider added by PR #4 must go through the same gate.
