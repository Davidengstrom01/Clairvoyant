use std::path::Path;

use serde::Serialize;

use super::run;
use crate::error::{Error, Result};

/// Stashes live in the shared refs, so every worktree of a repo sees the same list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    pub index: u32,
    pub time: i64,
    /// e.g. `On feature/x: half-done refactor` or `WIP on main: abc123 subject`.
    pub message: String,
}

pub fn stash_list(repo: &Path) -> Result<Vec<Stash>> {
    let out = run(repo, &["stash", "list", "--format=%gd%x00%ct%x00%gs"])?;
    out.lines()
        .map(|line| {
            let bad = || Error::Parse(format!("stash list: {line}"));
            let mut f = line.splitn(3, '\0');
            let index = f
                .next()
                .and_then(|r| r.strip_prefix("stash@{")?.strip_suffix('}')?.parse().ok())
                .ok_or_else(bad)?;
            let time = f.next().and_then(|t| t.parse().ok()).ok_or_else(bad)?;
            Ok(Stash {
                index,
                time,
                message: f.next().unwrap_or_default().to_owned(),
            })
        })
        .collect()
}

pub fn stash_push(worktree: &Path, message: Option<&str>, include_untracked: bool) -> Result<()> {
    let mut args = vec!["stash", "push"];
    if include_untracked {
        args.push("--include-untracked");
    }
    if let Some(message) = message.filter(|m| !m.trim().is_empty()) {
        args.extend(["-m", message]);
    }
    run(worktree, &args)?;
    Ok(())
}

/// On a conflict git keeps the stash, so nothing is lost.
pub fn stash_pop(worktree: &Path, index: u32) -> Result<()> {
    run(worktree, &["stash", "pop", &format!("stash@{{{index}}}")])?;
    Ok(())
}

pub fn stash_apply(worktree: &Path, index: u32) -> Result<()> {
    run(worktree, &["stash", "apply", &format!("stash@{{{index}}}")])?;
    Ok(())
}
