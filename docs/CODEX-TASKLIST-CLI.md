# Codex CLI Tasklist — install and track Rhema Studio work
**Owner request:** 27 October 2026. **Tool:** https://github.com/martinille/codex-tasklist

This is a **Codex CLI** productivity plugin installed in the **environment running Codex**, **not** a Rhema desktop feature, GitHub Action, a ChatGPT plugin, or a dependency of the application. The plugin's own README (v2.0.x at review) and hooks are the upstream installation authority. Review trusted code before enabling command hooks.

## 1. Install once on the actual Codex CLI machine

Check that `codex --version` works and Python 3.10+ is available (`python3 --version` on macOS/Linux/WSL; `python --version` on native Windows).

Before trusting hooks, inspect the upstream repository's `plugins/codex-tasklist/hooks/hooks.json`, `plugins/codex-tasklist/scripts/` and `LICENSE` at https://github.com/martinille/codex-tasklist. Hooks execute local Python when Codex events occur. The project is MIT-licensed; this is not a license grant for other dependencies.

From the terminal where Codex CLI is installed, run:

```sh
codex plugin marketplace add martinille/codex-tasklist
codex plugin add codex-tasklist@codex-tasklist
```

These commands register and install the *CLI plugin into the local Codex environment*. They are not made effective by merely adding this document to the repository. If the installed Codex CLI does not support `codex plugin`, report the exact CLI version and error; check official and upstream compatibility rather than silently installing random scripts.

Review/trust the plugin hooks using the CLI's actual prompts, then **end and restart the interactive Codex CLI session** so SessionStart and other hooks can initialize. Do not bypass hook trust or shell controls. Confirm the plugin is actually loaded and a task queue can be created, updated and shown. Record installed plugin/CLI/Python versions, terminal, success or exact failure; do not claim installation merely because a repo PR merged.

## 2. Display the live task panel

- **macOS/Linux/WSL**: Ask the newly restarted Codex CLI session to **"Set up the codex-tasklist launcher for me."** The installed script creates `codex-tasklist` in `~/.local/bin`. Confirm PATH. Then use `codex-tasklist` or `codex-tasklist resume` instead of `codex`, including inside the Rhema checkout. If tmux is unavailable and a panel requires it, request approval before package installation; the plugin still offers text queue commands.
- **Native Windows**: Continue launching `codex` or `codex resume`. Native WezTerm can show the task panel; other Windows terminals may only support textual queue commands. For Windows Terminal panels, the upstream guide recommends WSL + tmux, not changing Windows shell policies.
- Terminal compatibility differs. WezTerm/kitty have native adapters where supported; many macOS/Linux terminals use launcher+tmux fallback. If no panel appears, verify hooks and use the queue commands; **do not assert the plugin is broken solely because the terminal cannot split**.
- The plugin stores per-session queues locally (temporary working SQLite plus plugin-data checkpoints), not in the GitHub repository. A local panel will not be visible on a different machine just by opening GitHub. Restart/resume semantics and compatibility are covered in the upstream README.

## 3. Required Rhema Studio lead-agent task discipline

Once installed, the lead Codex CLI agent must **use and keep current the plugin's task queue** for each active Rhema implementation session:

1. At session start, consult `AGENTS.md`, `docs/FAST-DELIVERY-SUBAGENTS.md`, the latest issue/PR state and `docs/rhema-studio/32-feature-coverage-inventory.md`. Create a bounded session task queue for the **actual current work**, not 86 unscheduled copy-pasted tasks. Reference linked issue/PR IDs in titles.
2. **`pending`** = scoped not started; **`active`** = actually being worked on; **`blocked`** = concrete external dependency/failure (explain in normal Codex message); **`done`** = that specific task and verification are finished. Never mark an unmerged PR or untested hardware as accepted/shipped.
3. On finishing a subtask, resolving a blocker, opening a PR, passing/failing CI, or changing branch, update the queue *during the session*, not only in the final report. Preserve existing task IDs and update existing items rather than repeatedly duplicating them.
4. Include integration tasks: rebase onto current main; focused tests; all required CI; PR review; merge approval; native/hardware gates; factual status report. Track blockers rather than hiding them to keep the queue looking green.
5. When delegating, the lead owns the canonical session task IDs. Record each subagent's scope and its result, then update the lead queue. Do not let concurrent agents corrupt or duplicate the shared queue; the plugin uses SQLite for concurrency, but task ownership remains the lead's responsibility.
6. Each session ends with an evidence-backed summary in the existing PR/issue: completed vs blocked vs pending, PR links/commit SHAs, verification, and next dependency. **The GitHub comment/PR is the remote-visible record**, not the local plugin queue. No automatic GitHub upload is provided by this plugin.

### Example session tasks (illustrative — only use when currently relevant)

- `#482: review immutable approval manifest and CI` — active/pending based on GitHub evidence.
- `Prepare: reconcile old stacked PRs against merged #477` — pending until started.
- `QA: verify Save Draft doesn't update Live state` — pending until validated.
- `Report: update issue/PR with merged versus hardware-unverified` — pending until posted.

## 4. Acceptance and communication

The installer task is complete **only after** the actual Codex CLI environment reports:
- Codex CLI / Python / plugin versions and execution environment;
- successful plugin installation and reviewed/trusted hooks;
- a freshly started session with one real task created, marked active, then completed;
- the visible panel working **or** truthful documented terminal fallback;
- a useful task queue for the current Rhema workflow and a GitHub PR/issue progress update accessible off the machine.

Never add installed plugin binaries, transient SQLite task databases, or user-local state to the Rhema repository. Do not modify other Codex plugins or disable checks. No installation, deployment, church data mutation, merge or new releases are implied by this documentation-only PR.

**To trigger actual installation:** Give the active Codex CLI agent this direct instruction:
> Install `martinille/codex-tasklist` into the Codex CLI environment on this machine, following `docs/CODEX-TASKLIST-CLI.md`. Review and trust its hooks, restart the Codex CLI session, configure the correct launcher/panel for this terminal, create the task queue for the current Rhema work, and prove status updates work. Keep task IDs/statuses current. Report installation and panel verification explicitly, and post useful milestone summaries to the relevant GitHub PRs, because the tasklist itself is local-only.
