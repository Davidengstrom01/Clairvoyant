use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use super::{FileChange, run};
use crate::error::{Error, Result};

/// A multi-step git operation left in progress in a worktree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Operation {
    Rebase,
    Merge,
    CherryPick,
    Revert,
}

/// The worktree's own git dir (`.git/worktrees/<name>` for linked worktrees)
/// and the repo-wide common dir that holds refs and objects.
pub fn git_dirs(worktree: &Path) -> Result<(PathBuf, PathBuf)> {
    let out = run(
        worktree,
        &[
            "rev-parse",
            "--absolute-git-dir",
            "--path-format=absolute",
            "--git-common-dir",
        ],
    )?;
    let mut lines = out.lines();
    match (lines.next(), lines.next()) {
        (Some(git_dir), Some(common)) => Ok((git_dir.into(), common.into())),
        _ => Err(Error::Parse(format!("rev-parse git dirs: {out}"))),
    }
}

pub fn operation(git_dir: &Path) -> Option<Operation> {
    if git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists() {
        Some(Operation::Rebase)
    } else if git_dir.join("MERGE_HEAD").exists() {
        Some(Operation::Merge)
    } else if git_dir.join("CHERRY_PICK_HEAD").exists() {
        Some(Operation::CherryPick)
    } else if git_dir.join("REVERT_HEAD").exists() {
        Some(Operation::Revert)
    } else {
        None
    }
}

/// Unix seconds of the latest sign of work: the HEAD commit, the index
/// (stage/checkout), or a pending file's modification time.
pub fn last_activity(worktree: &Path, git_dir: &Path, files: &[FileChange]) -> Option<i64> {
    let commit_time = run(worktree, &["log", "-1", "--format=%ct"])
        .ok()
        .and_then(|out| out.trim().parse::<i64>().ok());
    let index_time = mtime(&git_dir.join("index"));
    let file_times = files.iter().filter_map(|f| mtime(&worktree.join(&f.path)));
    commit_time
        .into_iter()
        .chain(index_time)
        .chain(file_times)
        .max()
}

pub(crate) fn mtime(path: &Path) -> Option<i64> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    Some(modified.duration_since(UNIX_EPOCH).ok()?.as_secs() as i64)
}
