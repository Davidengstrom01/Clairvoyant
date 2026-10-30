//! Thin layer over the `git` CLI. Git stays the source of truth: everything here
//! runs a git command and parses its porcelain output.

mod status;
mod worktree;

use std::path::Path;
use std::process::Command;

use crate::error::{Error, Result};

pub use status::{AheadBehind, ChangeKind, FileChange, WorktreeStatus, status};
pub use worktree::{Worktree, list_worktrees};

pub fn run(cwd: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        // The dashboard reads constantly; it must never take index.lock and
        // race with git commands the user (or an agent) runs in the same worktree.
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()?;

    if !output.status.success() {
        return Err(Error::Git {
            args: args.join(" "),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        });
    }
    String::from_utf8(output.stdout).map_err(|e| Error::Parse(e.to_string()))
}

/// Resolves any path inside a repo (main or linked worktree) to the repo's main worktree.
pub fn main_worktree(path: &Path) -> Result<std::path::PathBuf> {
    let worktrees = list_worktrees(path).map_err(|e| match e {
        Error::Git { .. } => Error::NotARepo(path.display().to_string()),
        other => other,
    })?;
    worktrees
        .into_iter()
        .next()
        .map(|wt| wt.path)
        .ok_or_else(|| Error::Parse("`git worktree list` returned no worktrees".into()))
}
