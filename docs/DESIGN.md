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
| App config | `~/Library/Application Support/dev.clairvoyant.desktop/repos.json` |

Every git call sets `GIT_OPTIONAL_LOCKS=0` (the dashboard never takes
`index.lock` while you or an agent run git in the same worktree),
`GIT_TERMINAL_PROMPT=0` and `GIT_EDITOR=true` (no prompt or editor can hang
the app), and the login shell's `PATH`, resolved once at startup, so hooks
that need node/npx/dotnet work when the app is launched from Finder.
Commands that take file paths add `--literal-pathspecs`; it is not set
globally because `GIT_LITERAL_PATHSPECS` breaks `git stash push -u`.

### Code map

```
src-tauri/src/
  git/mod.rs        exec/run/run_streaming wrappers around the git CLI
  git/worktree.rs   worktree list parser; add / remove (dirty guard) / prune
  git/status.rs     `git status --porcelain=v2 --branch --show-stash -z` parser
  git/state.rs      git dirs, rebase/merge in progress, last activity
  git/diff.rs       unified diff parser, one-hunk patches, compare diffs
  git/index.rs      stage / unstage / discard, per-file and per-hunk
  git/trash.rs      undo snapshots under refs/clairvoyant/trash
  git/stash.rs      stash list / push / pop / apply
  git/commit.rs     commit + amend guard, hook output streamed
  git/branch.rs     branch list, create / delete / switch, compare
  git/remote.rs     fetch, last-fetch time
  overview.rs       dashboard data per repo / per worktree
  watch.rs          FS watcher: batches events, maps them to worktrees
  scan.rs           "scan folder" repo discovery
  config.rs         registered repos + settings, persisted as JSON
  platform.rs       macOS bits: login-shell PATH, jump-out command templates
  commands.rs       thin Tauri command handlers (all git work off the main thread)
src-tauri/tests/    integration tests against real throwaway repos
src/lib/            typed invoke wrappers + pure view logic (Vitest)
src/components/     dashboard, detail/, branches/, dialogs/
```

## Decisions

| Area | Decision |
|---|---|
| Discovery | Registered repos; worktrees discovered per repo via `git worktree list`. Optional one-off "scan folder" to bulk-add. |
| Freshness | FS watcher per worktree (FSEvents via `notify`), debounced ~300 ms, re-status only that worktree; also refresh on window focus and ⌘R. Watch `.git/` too so terminal commits/checkouts show up. |
| Remote | Manual Fetch button (per repo / all). Ahead/behind shows last-fetch age. No push, no pull, no background fetch in v1. |
| Card fields | Branch (or detached @ sha), staged/unstaged/untracked/conflicted counts, ahead/behind, last activity, stash count, rebase/merge in progress, health warnings (locked, folder missing, no upstream, upstream gone). No ticket badge. |
| Staging | File-level in v1, hunk-level in v2. No line-level. |
| Discard safety | Before any discard (file, hunk, or forced worktree removal) the affected files are committed with a scratch index into `refs/clairvoyant/trash/<ms>-<sha>`. Unlike `git stash create` this captures untracked files and deletions. "Recently discarded" restores (snapshotting what it overwrites first); entries are pruned after 14 days. Trash commits use a fixed "Clairvoyant" identity and are never signed. |
| Branch safety | Delete uses `git branch -d`; force delete needs explicit confirmation. Removing a dirty worktree is blocked unless confirmed. |
| Commit | Commit + amend. Amend is blocked when HEAD is reachable from any remote-tracking branch. Hook output streams live. No `--no-verify` button. |
| Branches view | List: checked out in which worktree, ahead/behind default branch, merged flag, last commit; filters "merged" and "not checked out". Compare view in v2. No commit graph. |
| New worktrees | Per-repo root, default `<repo-parent>/<repo>.worktrees/<branch>`, editable in the create dialog. |
| Jump-outs | Open in editor and open Claude Code are shell command templates in Settings (`{path}` = quoted worktree path; defaults `code {path}` and Ghostty running `claude`); reveal in Finder; copy path. |
| Testing | Rust integration tests on real temp repos for every parser and destructive action; Vitest for frontend logic; no E2E in v1. |

## Roadmap

### Done

- [x] Tauri + React/TS/Tailwind project, Vitest, Rust test harness
- [x] Repo registry (folder picker, "scan folder" bulk add, remove, persisted)
- [x] Dashboard cards: branch, change counts, ahead/behind, last activity, stash count, operation in progress, health warnings
- [x] FS watcher per worktree with debounce; refresh on focus and ⌘R
- [x] Worktree detail view: file lists + diff viewer
- [x] Stage / unstage / discard per file and per hunk (v2 item, done early)
- [x] Discard trash with undo toast and "Recently discarded" restore list
- [x] Stash push / pop / apply / list
- [x] Commit + safe amend with live hook output; login-shell PATH for hooks
- [x] Branches view with filters; create / safe-delete / switch branch
- [x] Branch compare view (v2 item, done early)
- [x] Create worktree (per-repo root) / remove worktree (dirty guard) / prune missing
- [x] Manual Fetch with last-fetch age
- [x] Jump-outs: editor, Claude Code, Finder, copy path; Settings dialog

### Out of scope

Cross-worktree change moves, push/pull, commit graph, line-level staging,
in-app conflict resolution (conflicts are flagged; resolve in your editor),
ticket badges, Windows/Linux.

## Open issues

- **Default Claude Code command is unverified.** `open -na Ghostty --args
  --working-directory={path} -e claude` depends on how your Ghostty version
  handles `-e` when launched through `open`; adjust it in Settings if needed.
- **No end-to-end UI tests.** The UI was checked by hand against a mocked
  backend; the git layer is covered by integration tests.
- **Types are mirrored by hand** between `src-tauri` and `src/lib/types.ts`.
  Consider generating them (`ts-rs` or `specta`) once the surface grows.
