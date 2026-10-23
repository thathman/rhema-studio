# Rhema MCP (issue #252) — what is built

AI assistants that speak the Model Context Protocol can read this church's Rhema Studio to help
plan a service. This is the first, read-only part (MCP-001); creating drafts for the church to
review comes next.

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

## Next (MCP-002)

A draft-writing tool that turns an assistant's proposed run of show into a **draft** in Prepare,
marked "AI-assisted", with every item linked to library content or flagged as missing, for the
church to review, edit and approve. No tool will ever approve, take anything live or change OBS.
