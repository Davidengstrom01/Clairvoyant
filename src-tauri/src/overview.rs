use std::path::Path;
use std::thread;

use serde::Serialize;

use crate::error::Result;
use crate::git::{self, Worktree, WorktreeStatus};

/// One dashboard card: a worktree plus its pending changes.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeSummary {
    #[serde(flatten)]
    pub worktree: Worktree,
    /// `None` for bare and prunable worktrees, which have no working files to inspect.
    pub status: Option<WorktreeStatus>,
    /// A status failure for one worktree must not hide the rest of the repo.
    pub error: Option<String>,
}

pub fn repo_overview(repo: &Path) -> Result<Vec<WorktreeSummary>> {
    let worktrees = git::list_worktrees(repo)?;

    // Statuses are independent, and on a large monorepo each one takes a while.
    let summaries = thread::scope(|scope| {
        let handles: Vec<_> = worktrees
            .into_iter()
            .map(|worktree| {
                scope.spawn(move || {
                    if worktree.bare || worktree.prunable.is_some() {
                        return WorktreeSummary {
                            worktree,
                            status: None,
                            error: None,
                        };
                    }
                    match git::status(&worktree.path) {
                        Ok(status) => WorktreeSummary {
                            worktree,
                            status: Some(status),
                            error: None,
                        },
                        Err(e) => WorktreeSummary {
                            worktree,
                            status: None,
                            error: Some(e.to_string()),
                        },
                    }
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().expect("status thread panicked"))
            .collect()
    });
    Ok(summaries)
}
