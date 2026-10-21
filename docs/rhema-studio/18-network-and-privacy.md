# Network connections and privacy (NFR-09)

Rhema Studio presents with no internet connection. There is no telemetry, no analytics, no crash upload and no automatic update check. Everything the app stores (services, songs, media, logs, settings) stays in its data folder on this computer until the operator exports it.

`src/lib/network-hosts.test.ts` fails the build if code names an internet host that is not listed there with a reason, so a new connection cannot slip in unnoticed.

## Connections the app can make

| Connection | When | What is sent | Off by default? |
|---|---|---|---|
| Deepgram speech recognition (`api.deepgram.com`, upstream feature) | Only when the operator chooses Deepgram as the speech provider and enters their own API key, and starts listening | Microphone audio while listening | Yes (local Whisper is the default; speech itself is optional) |
| OBS WebSocket (address the operator types, usually this computer) | Only after "Connect to OBS" is ticked | Recording start/stop, chapter marks; the password proof, never the password | Yes |
| NDI (local network) | Only for outputs set to NDI | The output picture, to NDI receivers on the network | Yes |
| Remote control (OSC and HTTP, incoming) | Only while the operator has started a listener | Nothing leaves; devices on the network send commands in | Yes |
| Phone remote page (incoming) | Served by the HTTP listener above | The page and the live reference text to paired phones | Yes |
| QR link slides | Never by the app; the code only shows an address for people to scan | Nothing | n/a |

Keys the settings file can hold for later providers (`openaiApiKey`, `claudeApiKey`) are not used by any code on `main` (the OpenAI speech provider is parked in PR #4).

## Not yet done

- An offline network capture on a real desktop (PRD release evidence for NFR-09): run the app through a service with a packet capture (Wireshark or `tcpdump`) and confirm that only the rows above appear. Acceptance row 10an.
- Informed consent text before cloud transcription starts (PRD FR-10), which lands with the speech-provider decision (PR #4).
