use std::path::Path;

use serde::Serialize;

use crate::error::{Error, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Tracked,
    Renamed,
    Conflicted,
    Untracked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    /// Source path of a rename or copy.
    pub orig_path: Option<String>,
    pub kind: ChangeKind,
    /// Git's index (X) status letter; `.` when nothing is staged.
    pub staged: char,
    /// Git's worktree (Y) status letter; `.` when nothing is unstaged.
    pub unstaged: char,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct AheadBehind {
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeStatus {
    /// `None` before the first commit.
    pub head_oid: Option<String>,
    /// `None` when detached.
    pub branch: Option<String>,
    pub upstream: Option<String>,
    /// `None` without an upstream, or when the upstream branch no longer exists.
    pub ahead_behind: Option<AheadBehind>,
    pub stash_count: u32,
    pub files: Vec<FileChange>,
}

pub fn status(worktree: &Path) -> Result<WorktreeStatus> {
    let out = super::run(
        worktree,
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "--show-stash",
            "--untracked-files=all",
            "-z",
        ],
    )?;
    parse(&out)
}

/// Parses `git status --porcelain=v2 -z`. Paths may contain spaces, so each
/// entry is split into a fixed number of fields with the path last.
fn parse(out: &str) -> Result<WorktreeStatus> {
    let mut status = WorktreeStatus::default();
    let mut records = out.split('\0').filter(|r| !r.is_empty());

    while let Some(record) = records.next() {
        let bad = || Error::Parse(format!("status record: {record}"));
        match record.as_bytes()[0] {
            b'#' => parse_header(&mut status, record)?,
            b'1' => {
                let (xy, path) = xy_and_path(record, 9).ok_or_else(bad)?;
                status
                    .files
                    .push(change(ChangeKind::Tracked, xy, path, None)?);
            }
            b'2' => {
                let (xy, path) = xy_and_path(record, 10).ok_or_else(bad)?;
                // With -z the rename source is the next NUL-separated record.
                let orig = records.next().ok_or_else(bad)?;
                status
                    .files
                    .push(change(ChangeKind::Renamed, xy, path, Some(orig))?);
            }
            b'u' => {
                let (xy, path) = xy_and_path(record, 11).ok_or_else(bad)?;
                status
                    .files
                    .push(change(ChangeKind::Conflicted, xy, path, None)?);
            }
            b'?' => status.files.push(FileChange {
                path: record.get(2..).ok_or_else(bad)?.to_owned(),
                orig_path: None,
                kind: ChangeKind::Untracked,
                staged: '.',
                unstaged: '?',
            }),
            // `!` (ignored) entries are never requested.
            _ => {}
        }
    }
    Ok(status)
}

fn parse_header(status: &mut WorktreeStatus, record: &str) -> Result<()> {
    let Some((key, value)) = record.get(2..).and_then(|h| h.split_once(' ')) else {
        return Ok(());
    };
    let number = |s: &str| {
        s.parse::<u32>()
            .map_err(|_| Error::Parse(format!("status header: {record}")))
    };
    match key {
        "branch.oid" => status.head_oid = (value != "(initial)").then(|| value.to_owned()),
        "branch.head" => status.branch = (value != "(detached)").then(|| value.to_owned()),
        "branch.upstream" => status.upstream = Some(value.to_owned()),
        "branch.ab" => {
            let (ahead, behind) = value
                .split_once(' ')
                .ok_or_else(|| Error::Parse(format!("status header: {record}")))?;
            status.ahead_behind = Some(AheadBehind {
                ahead: number(ahead.trim_start_matches('+'))?,
                behind: number(behind.trim_start_matches('-'))?,
            });
        }
        "stash" => status.stash_count = number(value)?,
        _ => {}
    }
    Ok(())
}

/// Splits an entry with `n` space-separated fields into its XY code and trailing path.
fn xy_and_path(record: &str, n: usize) -> Option<(&str, &str)> {
    let fields: Vec<&str> = record.splitn(n, ' ').collect();
    (fields.len() == n).then(|| (fields[1], fields[n - 1]))
}

fn change(kind: ChangeKind, xy: &str, path: &str, orig: Option<&str>) -> Result<FileChange> {
    let mut letters = xy.chars();
    let (Some(staged), Some(unstaged)) = (letters.next(), letters.next()) else {
        return Err(Error::Parse(format!("status code: {xy}")));
    };
    Ok(FileChange {
        path: path.to_owned(),
        orig_path: orig.map(str::to_owned),
        kind,
        staged,
        unstaged,
    })
}
