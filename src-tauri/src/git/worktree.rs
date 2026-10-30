use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{Error, Result};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: PathBuf,
    pub head: Option<String>,
    /// Short branch name; `None` when detached or bare.
    pub branch: Option<String>,
    pub is_main: bool,
    pub bare: bool,
    pub detached: bool,
    /// `Some("")` when locked without a reason.
    pub locked: Option<String>,
    /// Set when the worktree's folder is gone and `git worktree prune` would remove it.
    pub prunable: Option<String>,
}

impl Worktree {
    fn new(path: &str) -> Self {
        Self {
            path: PathBuf::from(path),
            head: None,
            branch: None,
            is_main: false,
            bare: false,
            detached: false,
            locked: None,
            prunable: None,
        }
    }
}

pub fn list_worktrees(repo: &Path) -> Result<Vec<Worktree>> {
    parse(&super::run(
        repo,
        &["worktree", "list", "--porcelain", "-z"],
    )?)
}

/// Records are NUL-separated `key[ value]` fields; an empty field ends a worktree.
fn parse(out: &str) -> Result<Vec<Worktree>> {
    let mut worktrees = Vec::new();
    let mut current: Option<Worktree> = None;

    for field in out.split('\0') {
        if field.is_empty() {
            worktrees.extend(current.take());
            continue;
        }
        let (key, value) = match field.split_once(' ') {
            Some((key, value)) => (key, Some(value)),
            None => (field, None),
        };
        if key == "worktree" {
            worktrees.extend(current.take());
            current = Some(Worktree::new(value.unwrap_or_default()));
            continue;
        }
        let wt = current
            .as_mut()
            .ok_or_else(|| Error::Parse(format!("worktree field before path: {field}")))?;
        match key {
            "HEAD" => wt.head = value.map(str::to_owned),
            "branch" => {
                wt.branch = value.map(|v| v.strip_prefix("refs/heads/").unwrap_or(v).to_owned())
            }
            "detached" => wt.detached = true,
            "bare" => wt.bare = true,
            "locked" => wt.locked = Some(value.unwrap_or_default().to_owned()),
            "prunable" => wt.prunable = Some(value.unwrap_or_default().to_owned()),
            // Newer git versions may add fields; ignoring them keeps us forward compatible.
            _ => {}
        }
    }
    worktrees.extend(current.take());

    // Git always lists the main worktree first.
    if let Some(main) = worktrees.first_mut() {
        main.is_main = true;
    }
    Ok(worktrees)
}
