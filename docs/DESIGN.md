# Clairvoyant design

One desktop dashboard for every git worktree you're working in, so you can see
and manage pending changes across all of them without pushing anything.

These decisions were settled in a design interview (2026-10-30). Treat them as
the baseline; change them deliberately, not by drift.

## Principles

- **Git companion, not a VCS.** Git is the source of truth. Clairvoyant reads
  and drives git through the `git` CLI and owns no history of its own. The only
  state it keeps is app config (registered repos, per-repo worktree root).
- **Never push or pull.** The only network operation is a manual Fetch.
- **Never lose work.** Anything destructive is undoable or guarded.
- **Personal macOS tool.** Keep macOS-specific code in one module so going
  cross-platform later is not a rewrite.

## Architecture

| Layer | Choice |
|---|---|
| Shell | Tauri 2 |
| Frontend | React + TypeScript + Tailwind (Vite) |
| Backend | Thin Rust layer that shells out to `git` and parses porcelain output |
| Git access | `git` CLI only (no libgit2/gitoxide), so hooks, config, signing and credential helpers behave exactly like the terminal |
| App config | `~/Library/Application Support/dev.clairvoyant.app/repos.json` |

Read-only git calls set `GIT_OPTIONAL_LOCKS=0` so the dashboard never takes
`index.lock` while you or an agent are running git in the same worktree.

### Code map

```
src-tauri/src/
  git/mod.rs        run() wrapper around the git CLI, main_worktree()
  git/worktree.rs   `git worktree list --porcelain -z` parser
  git/status.rs     `git status --porcelain=v2 --branch --show-stash -z` parser
  overview.rs       worktrees + statuses for one repo (parallel per worktree)
  registry.rs       registered repos, persisted as JSON
  commands.rs       thin Tauri command handlers
src-tauri/tests/    integration tests against real throwaway repos
src/lib/            typed invoke wrappers + pure view logic (Vitest)
src/components/     dashboard UI
```

## Decisions

| Area | Decision |
|---|---|
| Discovery | Registered repos; worktrees discovered per repo via `git worktree list`. Optional one-off "scan folder" to bulk-add. |
| Freshness | FS watcher per worktree (FSEvents via `notify`), debounced ~300 ms, re-status only that worktree; also refresh on window focus and ⌘R. Watch `.git/` too so terminal commits/checkouts show up. |
| Remote | Manual Fetch button (per repo / all). Ahead/behind shows last-fetch age. No push, no pull, no background fetch in v1. |
| Card fields | Branch (or detached @ sha), staged/unstaged/untracked/conflicted counts, ahead/behind, last activity, stash count, rebase/merge in progress, health warnings (locked, folder missing, no upstream, upstream gone). No ticket badge. |
| Staging | File-level in v1, hunk-level in v2. No line-level. |
| Discard safety | Snapshot with `git stash create` into `refs/clairvoyant/trash/<timestamp>` before discarding; "Recently discarded" list restores; prune after N days. |
| Branch safety | Delete uses `git branch -d`; force delete needs explicit confirmation. Removing a dirty worktree is blocked unless confirmed. |
| Commit | Commit + amend. Amend is blocked when HEAD is already on its upstream. Hook output streams live. No `--no-verify` button. |
| Branches view | List: checked out in which worktree, ahead/behind default branch, merged flag, last commit; filters "merged" and "not checked out". Compare view in v2. No commit graph. |
| New worktrees | Per-repo root, default `<repo-parent>/<repo>.worktrees/<branch>`, editable in the create dialog. |
| Jump-outs | Open in editor (configurable command), open Claude Code in the worktree, reveal in Finder, copy path. |
| Testing | Rust integration tests on real temp repos for every parser and destructive action; Vitest for frontend logic; no E2E in v1. |

## Roadmap

### Done (scaffold)

- [x] Tauri + React/TS/Tailwind project, Vitest, Rust test harness
- [x] Repo registry (add via folder picker, remove, persisted)
- [x] Worktree list + status parsers with real-repo tests
- [x] Dashboard: worktree cards with branch, change counts, ahead/behind, stash count, health warnings
- [x] Refresh on window focus and ⌘R

### v1

- [ ] FS watcher per worktree with debounce
- [ ] Card: last activity, rebase/merge/cherry-pick in progress
- [ ] Worktree detail view: file lists + diff viewer
- [ ] Stage / unstage per file
- [ ] Discard with trash snapshot + restore list
- [ ] Stash push / pop / list
- [ ] Commit + safe amend with live hook output
- [ ] Branches view with filters; create / safe-delete / switch branch
- [ ] Create worktree (per-repo root) / remove worktree (dirty guard)
- [ ] Manual Fetch with last-fetch age
- [ ] Jump-outs: editor, Claude Code, Finder, copy path
- [ ] "Scan folder" bulk add

### v2

- [ ] Hunk-level stage / discard
- [ ] Branch compare view

### Out of scope

Cross-worktree change moves, push/pull, commit graph, line-level staging,
in-app conflict resolution (conflicts are flagged; resolve in your editor),
ticket badges, Windows/Linux.

## Open issues

- **PATH in GUI launches.** An app started from Finder/Dock does not inherit
  your shell `PATH`, so it gets `/usr/bin/git`, and commit hooks that need
  `node`/`npx` (husky, lint-staged) may fail. Before shipping commit, resolve
  the login-shell `PATH` once at startup (for example `$SHELL -lc 'echo $PATH'`)
  and pass it to every git call.
- **Types are mirrored by hand** between `src-tauri` and `src/lib/types.ts`.
  Consider generating them (`ts-rs` or `specta`) once the surface grows.
