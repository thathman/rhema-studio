# Rhema MCP (issue #252) — what is built

AI assistants that speak the Model Context Protocol can read this church's Rhema Studio to help
plan a service. MCP-001 reads; MCP-002 lets an assistant propose a whole service as a **draft** that people review;
MCP-006 offers the same data as read-only **resources**. Why it is built this way (stdio, opt-in, drafts only, no
lyrics, revisions, text as data, remote access left to the owner): `24-adr-0003-mcp.md`.

## How it runs

- The assistant starts Rhema as a subprocess with `Rhema --mcp` and talks JSON-RPC over stdin and
  stdout (one message per line). No window opens and the running app is not touched (the
  `--mcp` check runs before the single-instance plugin).
- Configuration for the assistant (Settings → AI assistants shows it with this computer's path):

  ```json
  { "mcpServers": { "rhema-studio": { "command": "/Applications/Rhema.app/Contents/MacOS/Rhema", "args": ["--mcp"] } } }
  ```

- `--data <dir>` and `--bible <file>` override where it looks (tests and development).

## Rules

- **Opt-in, read on every call:** every tool and every resource read answers "turn it on in Settings → AI
  assistants" until `mcpEnabled` is on in the app's settings file. The switch (and the church's name)
  is read from the settings file again before every tool call, resource read and resource list, so
  turning it off refuses the assistant's very next request, with no restart.
- **Rate limit:** at most 30 tool calls and resource reads a minute per assistant (one `--mcp`
  process). Over it, a tool answers with the plain error "Too many requests: Rhema answers at most 30
  a minute. Wait a minute, then ask again." and a resource read with JSON-RPC error `-32003`. Lists
  (`tools/list`, `resources/list`, `prompts/list`) are not counted.
- **Protocol versions:** `initialize` answers with the version the client asks for when it is one
  Rhema speaks (`2025-06-18`, `2025-03-26`, `2024-11-05`), otherwise with the newest; the client
  decides whether to go on.
- **Never live:** no tool or resource can put anything on a screen, take an item, switch OBS or a
  camera, or change a setting. Steps a draft plans for an item's Take run only when a person Takes it.
- **Read-only:** the content database is opened with SQLite's read-only flag
  (`ContentDb::open_read_only`, which also refuses a database from a newer Rhema) and the Bible
  database is immutable. Nothing can change a service, a song, a setting or a screen.
- **Scripture only from the installed editions** (`rhema_lookup_bible_reference`); **no lyrics**:
  songs and hymns are described by title, other titles, numbers, authors and licence.
- **Local:** Rhema sends nothing anywhere. An online assistant does send its own conversation (and
  what these tools return) to its provider; Settings says so.

## Tools

| Tool | Returns |
| --- | --- |
| `rhema_get_capabilities` | Church name, read-only flag, counts, installed editions, the rules |
| `rhema_list_services` | Services and templates (id, title, date, items, approved revision) |
| `rhema_get_service` | The run of show in order: phases (rule, role, start time), groups, items (kind, title or reference, planned minutes, end by, notes, `assignees`). `release: "approved"` gives the approved release from the service's history instead of the working copy, with `changedSinceApproval` |
| `rhema_search_songs` | Library songs and hymn-book hymns (kind `song` / `hymn`) by title, number or words, without lyrics |
| `rhema_list_translations` | Installed Bible editions |
| `rhema_get_song` | One song or hymn: arrangements (name, default, order as section labels), languages, key, tempo, copyright, CCLI number, licence, licence note and `licenceWarning` (no licence; CCLI with no number; custom with no note). No lyrics |
| `rhema_get_church_profile` | Church name, time zone (the Setup's, else this computer's; `timeZoneFrom` says which), campus, service languages, Brand Kit colours, fonts and ministry looks (never the logo), cameras by name and label (never their links) |
| `rhema_list_outputs` | Each output and feed: id, name, kind (screen, NDI feed, browser feed), role, language, what it follows (`shows`, or "whatever is put live"), its scene by name, lower thirds, ticker, NDI name. Never a feed token, a TV's address or a monitor name |
| `rhema_list_media` | The media library by id, name and kind only |
| `rhema_lookup_bible_reference` | Exact verse text for "Romans 8:28", "1 Cor 13:4-7", "Psalm 23" (ranges up to 50 verses) |
| `rhema_validate_service_draft` | Checks a proposed service without saving: songs and hymns matched to the library (id, exact title, other title, hymn number), references looked up in the installed editions, missing items listed, errors to fix, planned minutes |
| `rhema_create_service_draft` | Saves a checked proposal as `ai-drafts/<id>.json` in the data folder (never the services database), with the assistant's name and the time; at most 50 wait at once |
| `rhema_list_looks_and_scenes` | The church's looks (built-in and its own, from Design) and congregation scenes, by name, for suggestions in a draft (MCP-004) |
| `rhema_list_service_drafts` | The drafts waiting for review: id, title, date, items, revision, made / revised, by which assistant (MCP-003) |
| `rhema_get_service_draft` | One waiting draft as saved: phases, groups, items with end-by times, assumptions, revision (MCP-005) |
| `rhema_update_service_draft` | Replaces a waiting draft with a revised one (same id, checked like create, `updated_at` set). Needs the `revision` the assistant read; if the draft changed since, nothing is saved and the error says to read it again (MCP-005). Refused once people removed it; services people already saved from it are never touched (MCP-003) |

## Resources (MCP-006)

Read-only documents an assistant can open by address (in Claude Desktop, the + / attach menu lists
them). The server advertises `resources` (no subscriptions, no change notifications) and answers
`resources/list`, `resources/templates/list` and `resources/read`; each read is one
`application/json` text.

| Resource | Contains |
| --- | --- |
| `rhema://services` | Saved services and templates, not archived, newest first: id, its `uri`, title, date, template, approved (and the approved revision) |
| `rhema://services/{id}` | One service's run of show: `phases` (name, rule, role, start time), each with its own `items` and its `groups` (name, items); an item has kind, title (or reference and translation for a verse), song id, planned minutes, end by. No lyrics, no slide text, no notes |
| `rhema://songs` | Every song and hymn (up to 5000, `truncated` says if there are more): id, title, other titles, kind `song` / `hymn`, numbers, languages. No lyrics, no first line |
| `rhema://translations` | Installed Bible editions (abbreviation, title, language) |
| `rhema://looks` | Look names (built-in and the church's own) and scene names |
| `rhema://drafts` | Drafts waiting for review, as `rhema_list_service_drafts` |
| `rhema://drafts/{id}` | One waiting draft as saved, with its revision, as `rhema_get_service_draft` |
| `rhema://church` | As `rhema_get_church_profile` |
| `rhema://outputs` | As `rhema_list_outputs` |
| `rhema://media` | As `rhema_list_media` |
| `rhema://songs/{id}` | As `rhema_get_song` |
| `rhema://services/{id}/approved` | The approved release as `rhema://services/{id}` (phases and groups), with `release`, `revision`, `approvedAt`, `approvedBy`, `changedSinceApproval`; error `-32002` when there is none |

- `resources/list` gives the eight fixed resources and, with access on, each service (up to 50) and
  each waiting draft by its own address. With access off it gives only the eight fixed ones (no
  church data) and every read is refused with error `-32001` and "turn it on in Settings → AI
  assistants".
- `resources/templates/list` gives `rhema://services/{id}`, `rhema://drafts/{id}`,
  `rhema://services/{id}/approved` and `rhema://songs/{id}`.
- A service's run of show carries each item's `assignees` (or its one "prepared by" line).
- An address Rhema does not have (an unknown service or draft id, any other `rhema://` path, any
  other scheme) is error `-32002` "Resource not found", with the address in `data.uri`.
- Tests (`mcp.rs`): `resources_are_listed_with_templates_and_advertised`,
  `every_resource_reads_and_none_hands_out_lyrics` (every listed resource read whole and searched
  for the test songs' lyric lines in English and Yorùbá, and a slide's text),
  `unknown_resources_are_not_found_and_access_off_refuses`.

## Prompts (MCP-003)

Ready-made requests an assistant offers (in Claude Desktop, under the + / prompts menu):

| Prompt | Arguments | What it asks the assistant to do |
| --- | --- | --- |
| `draft_service` | occasion; optional date, start time, length in minutes, a template to start from | Plan a timed service from the library and installed Bibles, check it, save it as a draft and say what it assumed |
| `reuse_service` | a past service; optional changes | Propose this week's version of it as a draft |
| `check_service` | a service | Report its timing against its phases and anything missing; change nothing |
| `bilingual_worship` | optional occasion, languages (default "Yorùbá and English"), date, start time | Plan worship in two languages: songs with words in both (each with its `languages` in order), readings with a `translation` and a `second_translation`, slides in both languages with tone marks kept; never translate Scripture or lyrics |

## Drafts (MCP-002)

- A proposal has a title, a date, assumptions and phases (pre-service loop, warm-up, main service
  with its start time, post-service loop) of items: `song`, `hymn`, `bible`, `slide`. The assistant
  cannot invent content: a song or hymn not in the library becomes a **missing** placeholder, a
  reference must exist in an installed edition, and slides carry only the assistant's own words
  (announcements, prayer points), never lyrics.
- **Prepare → AI drafts** lists what is waiting (who proposed it, when, items, minutes, what is
  missing, assumptions). **Open as a new service** puts it in the rundown as an unsaved service,
  asking first if the rundown has items; every item is marked "prepared by AI draft · <assistant>" (its one person under People),
  missing ones say what to source. People edit it and save it as a service; approval is the
  ordinary approval. Nothing is saved, approved, shown or sent to OBS by opening a draft.
- **Look and scene suggestions (MCP-004):** any item may carry `suggested_look` and
  `suggested_scene`, names from `rhema_list_looks_and_scenes`. The check warns when the church has no
  look or scene by that name. Prepare → AI drafts shows them beside the item ("Welcome (look:
  Thanksgiving gold, scene: Bible and lyrics)"). Opening the draft sets each one the church has (by
  name, any case) as the item's planned look and scene (#299 6.6), shown under Preview; one it lacks
  is marked "(none here by that name)" and left out. They stay a plan: nothing about the screens
  changes by opening a draft, and a scene is taken only if a person arms it for their own Take.
- The only file the MCP server writes is the draft; it still cannot change a saved service.

## Timing, groups, choosing items and revisions (MCP-005)

- **Finish-by times:** any item may carry `end_by` ("HH:MM", 24-hour), e.g. the sermon by 11:20.
  The check warns, never silently, when a time is not HH:MM (it is left out), is before its phase
  starts, or is earlier than the item's planned finish from the phase's start time and the planned
  minutes before it (a time well before the start counts as the next day, for services around
  midnight). Opening the draft puts it on the item, where Present shows "by 11:20".
- **Groups:** any item may carry `group` (a name). Items next to each other with the same group sit
  under one group heading in the phase (`{type: "group"}` headers in the run of show). The run of
  show has no "end of group", so an ungrouped item after a group would join it: the check warns.
- Drafts saved before these fields open exactly as before.
- **Choosing items:** in Prepare → AI drafts, **Choose items** lists every item with a tick box under
  its phase and group; a group's box ticks or unticks all of it. Only ticked items go into the
  rundown ("Open 5 of 7 items in the rundown"); phases stay.
- **Compared with the open service:** when a service is open, each draft says what opening it would
  change, matched by name: new items, items not in the draft, and items with a different planned
  length or finish-by time ("Sermon 30 min → 40 min, by 11:15"). It counts only the ticked items.
- **Revisions:** a draft is revision 1 when saved and one more each time it is revised; drafts from
  before this are revision 0. `rhema_update_service_draft` needs the revision the assistant read
  (from `rhema_get_service_draft` or the list); a draft revised by someone else since is not
  overwritten, and the error tells the assistant to read it again.
- **Yorùbá and other text** is stored and returned byte for byte (tone marks, underdots, combining
  marks, not normalised). **Text that looks like orders or markup** ("ignore previous instructions",
  `<script>`) is only words: stored and returned as given, shown as text in Prepare, and nothing
  acts on it. Tests: `mcp.rs` (`yoruba_tone_marks_and_underdots_come_back_exactly`,
  `instructions_hidden_in_a_draft_stay_words_and_change_nothing`), `ai-drafts.test.tsx`.

## Gap batch: plans per item, warnings, opened drafts, backups (#252)

- **More per item:** `stage_message` (one line for the stage screens only, at most 120 characters),
  `go_live_cue` (`timer.start`, `timer.fresh`, `timer.pause`, `stage.clearMessage`: none changes the
  congregation's screens; `src/types/queue.ts` GO_LIVE_CUES, a frontend test keeps the lists the
  same), `camera` (a church camera by name or label, kept by name), `on_take` (`scene`: a church
  scene; `obs_scene`: an OBS scene name; `bible_feeds_only`: readings only), `second_translation`
  (bible: an installed edition other than the first), `languages` and `arrangement` (song or hymn:
  checked against the song). Anything unknown is named in a warning and left out. Opening the draft
  sets them on the item (`on_live`, `camera`, `on_take` steps for scenes this church has,
  `secondary_translation`, the song's `languages` and `arrangement_id`); the Take steps run only when a
  person Takes the item in Present.
- **Licence warnings:** a song or hymn with no licence recorded, CCLI with no number, or custom
  permission with no note is warned about in the check.
- **Warnings saved:** the check's `warnings` are saved in the draft; Prepare → AI drafts shows them
  ("The check found 2 things to look at").
- **AI suggestions:** slides the assistant wrote open with `ai_suggestion` (the assistant's name, saved
  in the item's payload). The rundown shows **AI suggestion**; the item editor says who wrote it and
  has **Accept**, which clears the mark. Library items and missing-song placeholders are not marked.
- **Opened:** opening a draft calls `ai_draft_mark_opened` (status `opened`, `opened_at`, `opened_by`
  = the operator's name). It stays listed (Opened … by …; Open again), does not count against the 50
  waiting or the button's count, and `rhema_update_service_draft` refuses it ("people opened this
  draft … propose a new draft").
- **Backups:** Back up now puts the drafts in the installation part (`aiDrafts`); a restore puts back,
  through `ai_drafts_restore`, each well-formed draft (v 1, a draft id, phases, under 2 MB) that is not
  here already, until 50 wait; the ones here stay. The restore preview says how many would be added.
- Tests (`mcp.rs`, `mcp_drafts.rs`): `turning_access_off_refuses_the_very_next_call`,
  `calls_over_the_minute_s_limit_get_a_plain_error`, `initialize_answers_with_a_version_it_speaks`,
  `church_outputs_media_and_songs_read_without_secrets`, `the_approved_release_is_read_not_the_working_copy`,
  `a_draft_carries_stage_lines_cues_cameras_take_steps_and_two_languages`,
  `an_opened_draft_stops_waiting_and_cannot_be_revised`, `drafts_from_a_backup_come_back_once`; every
  listed resource is also searched for feed and camera secrets, the logo, TV addresses and monitor
  names. Vitest: `ai-drafts.test.ts`, `ai-drafts.test.tsx`, `installation-export.test.ts`,
  `service-structure.test.ts`, `builtin-looks.test.ts`.
