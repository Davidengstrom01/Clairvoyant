# Clairvoyant

Tauri 2 desktop app: a dashboard over every git worktree of the user's registered repos.
Design decisions and roadmap live in `docs/DESIGN.md` — read it before adding features, and tick roadmap items as they land.

## Commands

- `npm test` — Vitest (frontend logic in `src/lib`)
- `npm run test:rust` — Rust unit + integration tests
- `npm run build` — typecheck + Vite build
- `npm run tauri dev` — run the app
- Rust from Homebrew `rustup` is not on PATH by default: prefix with `PATH=/opt/homebrew/opt/rustup/bin:$PATH`.
- Before finishing: `cargo fmt` and `cargo clippy --all-targets` in `src-tauri/`.

## Conventions

- Git access goes through `git::run` (the `git` CLI). Do not add libgit2/gitoxide.
- Read-only git calls must keep `GIT_OPTIONAL_LOCKS=0`.
- Never add push or pull. Destructive actions must be undoable or guarded (see DESIGN.md).
- Tauri commands in `commands.rs` stay thin; logic goes in modules that `src-tauri/tests` can call directly.
- Every parser and destructive action gets an integration test that builds a real repo with `tests/common::TestRepo`.
- Rust types serialize camelCase; `src/lib/types.ts` mirrors them by hand — update both together.
