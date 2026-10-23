# Rhema MCP (issue #252) — what is built

AI assistants that speak the Model Context Protocol can read this church's Rhema Studio to help
plan a service. MCP-001 reads; MCP-002 lets an assistant propose a whole service as a **draft** that people review.

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

- **Opt-in:** every tool answers "turn it on in Settings → AI assistants" until `mcpEnabled` is on in
  the app's settings file.
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
| `rhema_get_service` | The run of show in order: phases (rule, role, start time), groups, items (kind, title or reference, planned minutes, end by, notes) |
| `rhema_search_songs` | Library songs and hymn-book hymns (kind `song` / `hymn`) by title, number or words, without lyrics |
| `rhema_list_translations` | Installed Bible editions |
| `rhema_lookup_bible_reference` | Exact verse text for "Romans 8:28", "1 Cor 13:4-7", "Psalm 23" (ranges up to 50 verses) |
| `rhema_validate_service_draft` | Checks a proposed service without saving: songs and hymns matched to the library (id, exact title, other title, hymn number), references looked up in the installed editions, missing items listed, errors to fix, planned minutes |
| `rhema_create_service_draft` | Saves a checked proposal as `ai-drafts/<id>.json` in the data folder (never the services database), with the assistant's name and the time; at most 50 wait at once |
| `rhema_list_looks_and_scenes` | The church's looks (built-in and its own, from Design) and congregation scenes, by name, for suggestions in a draft (MCP-004) |
| `rhema_list_service_drafts` | The drafts waiting for review: id, title, date, items, made / revised, by which assistant (MCP-003) |
| `rhema_update_service_draft` | Replaces a waiting draft with a revised one (same id, checked like create, `updated_at` set); refused once people removed it; services people already saved from it are never touched (MCP-003) |

## Prompts (MCP-003)

Ready-made requests an assistant offers (in Claude Desktop, under the + / prompts menu):

| Prompt | Arguments | What it asks the assistant to do |
| --- | --- | --- |
| `draft_service` | occasion; optional date, start time, length in minutes, a template to start from | Plan a timed service from the library and installed Bibles, check it, save it as a draft and say what it assumed |
| `reuse_service` | a past service; optional changes | Propose this week's version of it as a draft |
| `check_service` | a service | Report its timing against its phases and anything missing; change nothing |

## Drafts (MCP-002)

- A proposal has a title, a date, assumptions and phases (pre-service loop, warm-up, main service
  with its start time, post-service loop) of items: `song`, `hymn`, `bible`, `slide`. The assistant
  cannot invent content: a song or hymn not in the library becomes a **missing** placeholder, a
  reference must exist in an installed edition, and slides carry only the assistant's own words
  (announcements, prayer points), never lyrics.
- **Prepare → AI drafts** lists what is waiting (who proposed it, when, items, minutes, what is
  missing, assumptions). **Open as a new service** puts it in the rundown as an unsaved service,
  asking first if the rundown has items; every item is marked "prepared by AI draft · <assistant>",
  missing ones say what to source. People edit it and save it as a service; approval is the
  ordinary approval. Nothing is saved, approved, shown or sent to OBS by opening a draft.
- **Look and scene suggestions (MCP-004):** any item may carry `suggested_look` and
  `suggested_scene`, names from `rhema_list_looks_and_scenes`. The check warns when the church has no
  look or scene by that name. Prepare → AI drafts shows them beside the item ("Welcome (look:
  Thanksgiving gold, scene: Bible and lyrics)") for people to apply by hand; they are never stored in
  the service, so nothing about the screens changes by opening a draft.
- The only file the MCP server writes is the draft; it still cannot change a saved service.
