//! Undo for discards. Before Clairvoyant throws away uncommitted work it records
//! the files in a commit under `refs/clairvoyant/trash/`, so git itself keeps a copy.
//! Unlike `git stash create`, this also captures untracked files and deletions.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::{LITERAL, Opts, exec, git_dirs, run};
use crate::error::{Error, Result};

const PREFIX: &str = "refs/clairvoyant/trash/";
const KEEP_DAYS: i64 = 14;

// Trash commits are internal bookkeeping: a fixed identity means they work even
// without user.name/email configured, and never get signed.
const IDENTITY: [(&str, &str); 4] = [
    ("GIT_AUTHOR_NAME", "Clairvoyant"),
    ("GIT_AUTHOR_EMAIL", "clairvoyant@localhost"),
    ("GIT_COMMITTER_NAME", "Clairvoyant"),
    ("GIT_COMMITTER_EMAIL", "clairvoyant@localhost"),
];

#[derive(Debug, Serialize, Deserialize)]
struct Meta {
    worktree: PathBuf,
    paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub id: String,
    pub time: i64,
    pub worktree: PathBuf,
    pub paths: Vec<String>,
}

/// Records the current worktree content of `paths` and returns the trash entry id.
pub fn snapshot(worktree: &Path, paths: &[&str]) -> Result<String> {
    let (git_dir, _) = git_dirs(worktree)?;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    // A scratch copy of the index: base the snapshot on what's staged, then add
    // the worktree versions of `paths` on top, without touching the real index.
    let scratch = git_dir.join(format!("clairvoyant-snapshot-{}.index", nanos.as_nanos()));
    let real_index = git_dir.join("index");
    if real_index.exists() {
        fs::copy(&real_index, &scratch)?;
    }
    let result = snapshot_with_index(worktree, paths, &scratch, nanos.as_millis());
    let _ = fs::remove_file(&scratch);
    result
}

fn snapshot_with_index(
    worktree: &Path,
    paths: &[&str],
    index: &Path,
    millis: u128,
) -> Result<String> {
    let index = index.to_string_lossy();
    let mut env = vec![("GIT_INDEX_FILE", index.as_ref())];
    env.extend(IDENTITY);
    let opts = Opts {
        env: &env,
        ..Opts::default()
    };

    let mut add = vec![LITERAL, "add", "-A", "--"];
    add.extend(paths);
    exec(worktree, &add, &opts)?;
    let tree = stdout(exec(worktree, &["write-tree"], &opts)?)?;

    let meta = Meta {
        worktree: worktree.to_owned(),
        paths: paths.iter().map(|p| p.to_string()).collect(),
    };
    let message = format!(
        "Clairvoyant: discarded {} file(s)\n\n{}\n",
        paths.len(),
        serde_json::to_string(&meta).map_err(|e| Error::Parse(e.to_string()))?
    );
    let head = run(worktree, &["rev-parse", "--verify", "--quiet", "HEAD"]).ok();
    let mut commit_tree = vec!["commit-tree", "--no-gpg-sign", tree.as_str(), "-F", "-"];
    if let Some(head) = head.as_deref() {
        commit_tree.extend(["-p", head.trim()]);
    }
    let commit = stdout(exec(
        worktree,
        &commit_tree,
        &Opts {
            input: Some(message.as_bytes()),
            ..opts
        },
    )?)?;

    let id = format!("{millis}-{}", &commit[..commit.len().min(8)]);
    run(worktree, &["update-ref", &format!("{PREFIX}{id}"), &commit])?;
    Ok(id)
}

fn stdout(output: std::process::Output) -> Result<String> {
    Ok(String::from_utf8(output.stdout)
        .map_err(|e| Error::Parse(e.to_string()))?
        .trim()
        .to_owned())
}

/// All trash entries in the repo, newest first. Refs are shared by every
/// worktree, so callers filter by `worktree`.
pub fn list_trash(repo: &Path) -> Result<Vec<TrashEntry>> {
    let out = run(
        repo,
        &[
            "for-each-ref",
            "--sort=-creatordate",
            "--format=%(refname)%00%(creatordate:unix)%00%(contents:body)%00",
            PREFIX,
        ],
    )?;
    let mut entries = Vec::new();
    for record in out.split("\0\n").filter(|r| !r.trim().is_empty()) {
        let mut f = record.splitn(3, '\0');
        let (Some(name), Some(time), Some(body)) = (f.next(), f.next(), f.next()) else {
            continue;
        };
        // Skip refs that someone else put in our namespace.
        let Ok(meta) = serde_json::from_str::<Meta>(body.trim()) else {
            continue;
        };
        entries.push(TrashEntry {
            id: name.trim_start_matches(PREFIX).to_owned(),
            time: time.parse().unwrap_or_default(),
            worktree: meta.worktree,
            paths: meta.paths,
        });
    }
    Ok(entries)
}

/// Puts the snapshotted files back. The files' current content is snapshotted
/// first, so a restore is itself undoable.
pub fn restore_trash(worktree: &Path, id: &str) -> Result<()> {
    let entry = list_trash(worktree)?
        .into_iter()
        .find(|e| e.id == id)
        .ok_or_else(|| Error::Refused(format!("trash entry {id} no longer exists")))?;
    let refname = format!("{PREFIX}{id}");
    let paths: Vec<&str> = entry.paths.iter().map(String::as_str).collect();

    let current: Vec<&str> = paths
        .iter()
        .copied()
        .filter(|p| fs::symlink_metadata(worktree.join(p)).is_ok())
        .collect();
    if !current.is_empty() {
        snapshot(worktree, &current)?;
    }

    let mut ls_tree = vec![
        LITERAL,
        "ls-tree",
        "-r",
        "-z",
        "--name-only",
        refname.as_str(),
        "--",
    ];
    ls_tree.extend(&paths);
    let in_snapshot = run(worktree, &ls_tree)?;
    let in_snapshot: Vec<&str> = in_snapshot.split('\0').filter(|p| !p.is_empty()).collect();

    if !in_snapshot.is_empty() {
        let source = format!("--source={refname}");
        let mut restore = vec![LITERAL, "restore", source.as_str(), "--worktree", "--"];
        restore.extend(&in_snapshot);
        run(worktree, &restore)?;
    }
    // A path missing from the snapshot was deleted when it was taken.
    for path in paths.iter().filter(|p| !in_snapshot.contains(p)) {
        let file = worktree.join(path);
        if file.is_file() {
            fs::remove_file(file)?;
        }
    }
    run(worktree, &["update-ref", "-d", &refname])?;
    Ok(())
}

/// Drops trash older than two weeks.
pub fn prune_trash(repo: &Path) -> Result<()> {
    let cutoff = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
        - KEEP_DAYS * 24 * 60 * 60;
    for entry in list_trash(repo)?.into_iter().filter(|e| e.time < cutoff) {
        run(
            repo,
            &["update-ref", "-d", &format!("{PREFIX}{}", entry.id)],
        )?;
    }
    Ok(())
}
