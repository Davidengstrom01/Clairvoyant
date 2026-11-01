use std::path::Path;
use std::thread;

use serde::Serialize;

use crate::error::{Error, Result};
use crate::git::{self, Operation, Worktree, WorktreeStatus};

/// One dashboard card: a worktree plus its pending changes.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeSummary {
    #[serde(flatten)]
    pub worktree: Worktree,
    /// `None` for bare and prunable worktrees, which have no working files to inspect.
    pub status: Option<WorktreeStatus>,
    pub operation: Option<Operation>,
    /// Unix seconds of the latest commit, stage or file edit.
    pub last_activity: Option<i64>,
    /// A status failure for one worktree must not hide the rest of the repo.
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoOverview {
    pub worktrees: Vec<WorktreeSummary>,
    pub last_fetch: Option<i64>,
    pub default_branch: Option<String>,
}

pub fn repo_overview(repo: &Path) -> Result<RepoOverview> {
    let worktrees = git::list_worktrees(repo)?;

    // Statuses are independent, and on a large monorepo each one takes a while.
    let worktrees = thread::scope(|scope| {
        let handles: Vec<_> = worktrees
            .into_iter()
            .map(|worktree| scope.spawn(move || summarize(worktree)))
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().expect("status thread panicked"))
            .collect()
    });
    Ok(RepoOverview {
        worktrees,
        last_fetch: git::last_fetch(repo)?,
        default_branch: git::default_branch(repo),
    })
}

/// Refreshes a single card, e.g. after a file in that worktree changed.
pub fn worktree_summary(repo: &Path, path: &Path) -> Result<WorktreeSummary> {
    let worktree = git::list_worktrees(repo)?
        .into_iter()
        .find(|wt| wt.path == path)
        .ok_or_else(|| {
            Error::Refused(format!("{} is not a worktree of this repo", path.display()))
        })?;
    Ok(summarize(worktree))
}

fn summarize(worktree: Worktree) -> WorktreeSummary {
    let mut summary = WorktreeSummary {
        worktree,
        status: None,
        operation: None,
        last_activity: None,
        error: None,
    };
    if summary.worktree.bare || summary.worktree.prunable.is_some() {
        return summary;
    }
    let path = summary.worktree.path.clone();
    let result = git::status(&path).and_then(|status| Ok((status, git::git_dirs(&path)?)));
    match result {
        Ok((status, (git_dir, _))) => {
            summary.operation = git::operation(&git_dir);
            summary.last_activity = git::last_activity(&path, &git_dir, &status.files);
            summary.status = Some(status);
        }
        Err(e) => summary.error = Some(e.to_string()),
    }
    summary
}
