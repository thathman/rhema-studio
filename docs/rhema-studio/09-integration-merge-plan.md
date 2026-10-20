# 09 — Integration Merge Plan

Nothing is merged until the owner says so. This document is the exact procedure.

## Branches and PRs at the gate

| PR | Branch | Base | Head | Commits on top of base |
|---|---|---|---|---|
| #3 Language integration | `feature/language-integration` | `main` (7cbb027) | 862fc97 | 8 |
| #1 Studio foundation | `feature/rhema-studio-foundation` | `feature/language-integration` | 0bc1c54 | 2 |
| #2 Content persistence | `feature/rhema-studio-content` | `feature/rhema-studio-foundation` | 9c7c1c2 | 6 |
| #4 Speech (Codex delta) | `feature/speech-language-openai` | `feature/language-integration` | 2705de0 | 1 |

Each PR's diff against its base contains only its own commits (verified with
`git log base..head` and `git diff --stat base head`; the counts above are from that).
No commit appears in two branches.

## Strategy: merge commits, not squash or rebase

Use GitHub's **"Create a merge commit"** for all four. Reasons:

- The stacked branches share history. After a merge commit, `main` contains the
  base PR's commits as ancestors, so the next PR's diff against `main` is exactly its
  own commits. No rebase, no force-push, no duplicate changes.
- Squash or rebase-merge would create new SHAs on `main`; the dependent branches
  would still carry the old SHAs, their diffs against `main` would show the base PR's
  changes again, and each dependent would need `git rebase --onto main` plus a
  force-push before it could merge. That is avoidable churn and a place to lose work.
- CI already passed on these exact heads. A merge commit keeps them intact.

Repository settings checked: merge commits allowed; *delete branch on merge* is off.
Keep it off until step 5.

## Procedure

Run each step only after the previous one is confirmed.

1. **Merge #3** (`feature/language-integration` → `main`) with a merge commit.
   Confirm the push-triggered CI run on `main` is green.
2. **Retarget #1 and #4 to `main`**:
   `gh pr edit 1 --base main` and `gh pr edit 4 --base main`.
   Their "Files changed" must now show only their own commits (2 and 1). Editing the
   base does not re-run CI; the earlier runs on the same heads stand, and the merge
   commit on `main` will run CI again.
3. **Merge #1** (`feature/rhema-studio-foundation` → `main`) with a merge commit.
   Confirm CI on `main`.
4. **Retarget #2 to `main`**: `gh pr edit 2 --base main`. Files changed shows 6
   commits. Then **merge #2** with a merge commit. Confirm CI on `main`.
5. Only now delete `feature/language-integration`, `feature/rhema-studio-foundation`
   and `feature/rhema-studio-content`. Deleting earlier would retarget or close open
   dependents.
6. **#4** is independent of #1/#2. Merge it after #3 whenever the owner has decided
   the open questions on it (model bundling, Metal, default model). If it is still
   open after step 5, keep `feature/language-integration` until #4 is merged or
   retargeted.
7. Tag nothing. Releases remain a separate, explicitly authorised step.

If a merge shows conflicts at any step (none expected: each PR is `MERGEABLE` against
its base today), stop and rebase that one branch onto the new `main` with
`git rebase main`, run CI, and continue. Do not resolve conflicts in the GitHub editor.

## Upstream

`openbezal/rhema` `main` is unchanged by this. The fork's `main` diverges by these
four PRs; a later upstream sync is a normal merge of upstream into the fork.
