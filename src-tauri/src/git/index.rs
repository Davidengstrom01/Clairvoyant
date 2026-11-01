use std::fs;
use std::path::Path;

use serde::Deserialize;

use super::{DiffSource, LITERAL, Opts, exec, file_diff, run, snapshot, succeeds};
use crate::error::{Error, Result};

pub fn stage(worktree: &Path, paths: &[&str]) -> Result<()> {
    let mut args = vec![LITERAL, "add", "-A", "--"];
    args.extend(paths);
    run(worktree, &args)?;
    Ok(())
}

/// For a staged rename, pass both the old and the new path.
pub fn unstage(worktree: &Path, paths: &[&str]) -> Result<()> {
    // Before the first commit there is no HEAD to restore the index from.
    let mut args = if succeeds(worktree, &["rev-parse", "--verify", "--quiet", "HEAD"])? {
        vec![LITERAL, "restore", "--staged", "--"]
    } else {
        vec![LITERAL, "rm", "--cached", "--quiet", "-r", "--"]
    };
    args.extend(paths);
    run(worktree, &args)?;
    Ok(())
}

/// Throws away unstaged changes (back to the staged version) and deletes
/// untracked files, after snapshotting them to the trash. Returns the trash id.
pub fn discard(worktree: &Path, tracked: &[&str], untracked: &[&str]) -> Result<String> {
    let all: Vec<&str> = tracked.iter().chain(untracked).copied().collect();
    if all.is_empty() {
        return Err(Error::Refused("nothing to discard".into()));
    }
    let id = snapshot(worktree, &all)?;
    if !tracked.is_empty() {
        let mut args = vec![LITERAL, "restore", "--worktree", "--"];
        args.extend(tracked);
        run(worktree, &args)?;
    }
    for path in untracked {
        let file = worktree.join(path);
        if file.is_file() || file.is_symlink() {
            fs::remove_file(file)?;
        }
    }
    Ok(id)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HunkAction {
    Stage,
    Unstage,
    Discard,
}

/// Applies one hunk, identified by its `@@` header so a stale UI can't apply
/// the wrong change. Returns the trash id when the hunk was discarded.
pub fn apply_hunk(
    worktree: &Path,
    path: &str,
    hunk_header: &str,
    action: HunkAction,
) -> Result<Option<String>> {
    let source = match action {
        HunkAction::Unstage => DiffSource::Staged,
        HunkAction::Stage | HunkAction::Discard => DiffSource::Unstaged,
    };
    let diff = file_diff(worktree, path, None, source)?;
    if diff.combined || diff.binary {
        return Err(Error::Refused(format!(
            "{path} can only be changed as a whole file"
        )));
    }
    let hunk = diff
        .hunks
        .iter()
        .find(|h| h.header == hunk_header)
        .ok_or_else(|| {
            Error::Refused(format!(
                "{path} changed since it was shown; refresh and try again"
            ))
        })?;
    let patch = diff.hunk_patch(hunk);

    let mut trash_id = None;
    let args: &[&str] = match action {
        HunkAction::Stage => &["apply", "--cached", "--whitespace=nowarn", "-"],
        HunkAction::Unstage => &["apply", "--cached", "--reverse", "--whitespace=nowarn", "-"],
        HunkAction::Discard => {
            trash_id = Some(snapshot(worktree, &[path])?);
            &["apply", "--reverse", "--whitespace=nowarn", "-"]
        }
    };
    exec(
        worktree,
        args,
        &Opts {
            input: Some(patch.as_bytes()),
            ..Opts::default()
        },
    )?;
    Ok(trash_id)
}
