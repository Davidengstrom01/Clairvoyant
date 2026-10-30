# Clairvoyant

One dashboard for every git worktree you're working in. See branches and
pending changes across all your repos and worktrees, and manage them locally
without pushing anything.

Clairvoyant is a companion to git, not a replacement: it runs the `git` CLI
under the hood, so your hooks, config and signing all behave as usual.

See [docs/DESIGN.md](docs/DESIGN.md) for the design decisions and roadmap.

## Development

Prerequisites: Node, Rust (stable) and Xcode Command Line Tools.

```bash
npm install
npm run tauri dev      # run the app
npm test               # frontend unit tests (Vitest)
npm run test:rust      # Rust unit + integration tests
npm run build          # typecheck + build the frontend
npm run tauri build    # build the .app bundle
```

If `cargo` isn't found and Rust came from Homebrew's `rustup`, add
`/opt/homebrew/opt/rustup/bin` to your `PATH`.
