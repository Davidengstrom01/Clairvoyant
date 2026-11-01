use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::{AheadBehind, run, succeeds};
use crate::error::{Error, Result};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    /// Short name: `feature/x` locally, `origin/feature/x` for remote-tracking branches.
    pub name: String,
    pub remote: bool,
    pub head: String,
    pub upstream: Option<String>,
    /// The upstream was deleted on the remote (after a fetch with prune).
    pub upstream_gone: bool,
    /// The worktree that has this branch checked out.
    pub worktree: Option<PathBuf>,
    pub last_commit_time: i64,
    pub subject: String,
    pub is_default: bool,
    /// Compared with the default branch; `None` when there is no default branch.
    pub vs_default: Option<AheadBehind>,
    /// Fully merged into the default branch, so safe to delete.
    pub merged: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub sha: String,
    pub time: i64,
    pub subject: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparedFile {
    /// Git's name-status letter: A, M, D, R, C, T.
    pub status: String,
    pub path: String,
    pub orig_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    /// Commits on `head` that `base` doesn't have, newest first.
    pub commits: Vec<CommitInfo>,
    /// How many commits `base` has that `head` doesn't.
    pub behind: u32,
    /// Files a pull request from `head` into `base` would change.
    pub files: Vec<ComparedFile>,
}

/// The branch others merge into: `origin/HEAD` when known, else a local main/master.
pub fn default_branch(repo: &Path) -> Option<String> {
    if let Ok(out) = run(
        repo,
        &[
            "symbolic-ref",
            "--quiet",
            "--short",
            "refs/remotes/origin/HEAD",
        ],
    ) {
        return Some(out.trim().to_owned());
    }
    ["main", "master"]
        .into_iter()
        .find(|name| {
            succeeds(
                repo,
                &[
                    "show-ref",
                    "--verify",
                    "--quiet",
                    &format!("refs/heads/{name}"),
                ],
            )
            .unwrap_or(false)
        })
        .map(str::to_owned)
}

pub fn branches(repo: &Path) -> Result<Vec<Branch>> {
    let default = default_branch(repo);
    let mut format = [
        "%(refname)",
        "%(refname:short)",
        "%(objectname)",
        "%(upstream:short)",
        "%(upstream:track,nobracket)",
        "%(worktreepath)",
        "%(committerdate:unix)",
        "%(contents:subject)",
    ]
    .join("%00");
    if let Some(default) = &default {
        format.push_str(&format!("%00%(ahead-behind:{default})"));
    }
    let out = run(
        repo,
        &[
            "for-each-ref",
            &format!("--format={format}"),
            "refs/heads",
            "refs/remotes",
        ],
    )?;
    let merged: HashSet<String> = match &default {
        Some(default) => run(
            repo,
            &[
                "for-each-ref",
                &format!("--merged={default}"),
                "--format=%(refname)",
                "refs/heads",
                "refs/remotes",
            ],
        )?
        .lines()
        .map(str::to_owned)
        .collect(),
        None => HashSet::new(),
    };

    let mut branches = Vec::new();
    for line in out.lines() {
        let f: Vec<&str> = line.split('\0').collect();
        if f.len() < 8 {
            return Err(Error::Parse(format!("for-each-ref: {line}")));
        }
        // `origin/HEAD` is a pointer to the default branch, not a branch.
        if f[0].starts_with("refs/remotes/") && f[0].ends_with("/HEAD") {
            continue;
        }
        // The local branch tracking the default (local `main` for `origin/main`)
        // is a default too: never a cleanup candidate.
        let is_default = default.is_some()
            && (default.as_deref() == Some(f[1]) || default.as_deref() == Some(f[3]));
        branches.push(Branch {
            name: f[1].to_owned(),
            remote: f[0].starts_with("refs/remotes/"),
            head: f[2].to_owned(),
            upstream: non_empty(f[3]),
            upstream_gone: f[4] == "gone",
            worktree: non_empty(f[5]).map(PathBuf::from),
            last_commit_time: f[6].parse().unwrap_or_default(),
            subject: f[7].to_owned(),
            is_default,
            vs_default: f.get(8).and_then(|ab| parse_ahead_behind(ab)),
            merged: !is_default && merged.contains(f[0]),
        });
    }
    Ok(branches)
}

fn non_empty(s: &str) -> Option<String> {
    (!s.is_empty()).then(|| s.to_owned())
}

fn parse_ahead_behind(s: &str) -> Option<AheadBehind> {
    let (ahead, behind) = s.split_once(' ')?;
    Some(AheadBehind {
        ahead: ahead.parse().ok()?,
        behind: behind.parse().ok()?,
    })
}

pub(crate) fn validate_branch_name(repo: &Path, name: &str) -> Result<()> {
    if name.starts_with('-') || !succeeds(repo, &["check-ref-format", "--branch", name])? {
        return Err(Error::Refused(format!(
            "`{name}` is not a valid branch name"
        )));
    }
    Ok(())
}

pub fn create_branch(repo: &Path, name: &str, start: Option<&str>) -> Result<()> {
    validate_branch_name(repo, name)?;
    let mut args = vec!["branch", "--no-track", name];
    args.extend(start);
    run(repo, &args)?;
    Ok(())
}

/// `force: false` uses `git branch -d`, which refuses to delete unmerged work.
pub fn delete_branch(repo: &Path, name: &str, force: bool) -> Result<()> {
    validate_branch_name(repo, name)?;
    run(repo, &["branch", if force { "-D" } else { "-d" }, name])?;
    Ok(())
}

/// Switching to a remote-tracking branch creates a local branch tracking it.
pub fn switch_branch(worktree: &Path, name: &str, remote: bool) -> Result<()> {
    if remote {
        run(worktree, &["switch", "--track", name])?;
    } else {
        validate_branch_name(worktree, name)?;
        run(worktree, &["switch", name])?;
    }
    Ok(())
}

pub fn compare(repo: &Path, base: &str, head: &str) -> Result<Comparison> {
    for rev in [base, head] {
        if rev.starts_with('-') {
            return Err(Error::Refused(format!("`{rev}` is not a branch")));
        }
    }
    let log = run(
        repo,
        &[
            "log",
            "--format=%H%x00%ct%x00%s",
            &format!("{base}..{head}"),
        ],
    )?;
    let commits = log
        .lines()
        .filter_map(|line| {
            let mut f = line.splitn(3, '\0');
            Some(CommitInfo {
                sha: f.next()?.to_owned(),
                time: f.next()?.parse().ok()?,
                subject: f.next()?.to_owned(),
            })
        })
        .collect();
    let behind = run(repo, &["rev-list", "--count", &format!("{head}..{base}")])?
        .trim()
        .parse()
        .map_err(|_| Error::Parse("rev-list --count".into()))?;

    let names = run(
        repo,
        &[
            "diff",
            "--name-status",
            "-z",
            "--find-renames",
            &format!("{base}...{head}"),
        ],
    )?;
    let files = super::diff::parse_name_status(&names)?
        .into_iter()
        .map(|n| ComparedFile {
            status: n.status,
            path: n.path,
            orig_path: n.orig_path,
        })
        .collect();
    Ok(Comparison {
        commits,
        behind,
        files,
    })
}
