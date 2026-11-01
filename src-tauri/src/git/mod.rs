//! Thin layer over the `git` CLI. Git stays the source of truth: everything here
//! runs a git command and parses its output.

mod branch;
mod commit;
mod diff;
mod index;
mod remote;
mod stash;
mod state;
mod status;
mod trash;
mod worktree;

use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;

use crate::error::{Error, Result};

pub use branch::{
    Branch, CommitInfo, ComparedFile, Comparison, branches, compare, create_branch, default_branch,
    delete_branch, switch_branch,
};
pub use commit::{commit, head_is_published};
pub use diff::{
    DiffLine, DiffSource, FileDiff, Hunk, LineKind, PathDiff, WorktreeDiffs, compare_diff,
    compare_diffs, file_diff, worktree_diffs,
};
pub use index::{HunkAction, apply_hunk, discard, stage, unstage};
pub use remote::{fetch, last_fetch};
pub use stash::{Stash, stash_apply, stash_list, stash_pop, stash_push};
pub use state::{Operation, git_dirs, last_activity, operation};
pub use status::{AheadBehind, ChangeKind, FileChange, WorktreeStatus, status};
pub use trash::{TrashEntry, list_trash, prune_trash, restore_trash, snapshot};
pub use worktree::{Worktree, add_worktree, list_worktrees, prune_worktrees, remove_worktree};

/// Prefix for commands that take file paths: paths come from git's own output,
/// and a file named `*.rs` must not act as a glob. (Not set globally through
/// GIT_LITERAL_PATHSPECS: that breaks `git stash push --include-untracked`.)
const LITERAL: &str = "--literal-pathspecs";

static EXTRA_ENV: OnceLock<Vec<(String, String)>> = OnceLock::new();

/// Sets environment applied to every git call, once per process. The app passes
/// the login shell's PATH so hooks find node/npx; tests shut out user config.
pub fn init_env(env: Vec<(String, String)>) {
    let _ = EXTRA_ENV.set(env);
}

fn command(cwd: &Path, args: &[&str]) -> Command {
    let mut cmd = Command::new("git");
    cmd.args(args)
        .current_dir(cwd)
        // The dashboard reads constantly; it must never take index.lock and
        // race with git commands the user (or an agent) runs in the same worktree.
        .env("GIT_OPTIONAL_LOCKS", "0")
        // There is no terminal to answer prompts or run an editor; fail instead of hanging.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_EDITOR", "true")
        .stdin(Stdio::null());
    for (key, value) in EXTRA_ENV.get().into_iter().flatten() {
        cmd.env(key, value);
    }
    cmd
}

#[derive(Default)]
pub struct Opts<'a> {
    pub input: Option<&'a [u8]>,
    pub env: &'a [(&'a str, &'a str)],
    /// Exit codes besides 0 that mean success, e.g. 1 for `git diff --no-index`.
    pub ok_codes: &'a [i32],
}

pub fn exec(cwd: &Path, args: &[&str], opts: &Opts) -> Result<Output> {
    let mut cmd = command(cwd, args);
    for (key, value) in opts.env {
        cmd.env(key, value);
    }
    let output = match opts.input {
        None => cmd.output()?,
        Some(input) => {
            let mut child = cmd
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()?;
            child.stdin.take().expect("piped stdin").write_all(input)?;
            child.wait_with_output()?
        }
    };
    let code = output.status.code().unwrap_or(-1);
    if code != 0 && !opts.ok_codes.contains(&code) {
        return Err(git_error(args, &output.stderr));
    }
    Ok(output)
}

pub fn run(cwd: &Path, args: &[&str]) -> Result<String> {
    let output = exec(cwd, args, &Opts::default())?;
    String::from_utf8(output.stdout).map_err(|e| Error::Parse(e.to_string()))
}

/// Exit status only, for predicates like `merge-base --is-ancestor`.
pub fn succeeds(cwd: &Path, args: &[&str]) -> Result<bool> {
    Ok(command(cwd, args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()?
        .success())
}

/// Runs git and reports each stdout/stderr line as it arrives, so long hooks
/// (lint, tests) show progress instead of a frozen button.
pub fn run_streaming(
    cwd: &Path,
    args: &[&str],
    input: Option<&[u8]>,
    on_line: &(dyn Fn(&str) + Sync),
) -> Result<()> {
    let mut child = command(cwd, args)
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    if let Some(input) = input {
        // Dropping stdin after writing closes it so git sees EOF.
        child.stdin.take().expect("piped stdin").write_all(input)?;
    }
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let stderr_tail = Mutex::new(Vec::<String>::new());

    thread::scope(|scope| {
        scope.spawn(|| {
            for line in BufReader::new(stdout).lines().map_while(|l| l.ok()) {
                on_line(&line);
            }
        });
        scope.spawn(|| {
            for line in BufReader::new(stderr).lines().map_while(|l| l.ok()) {
                on_line(&line);
                stderr_tail.lock().unwrap().push(line);
            }
        });
    });

    if !child.wait()?.success() {
        let tail = stderr_tail.into_inner().unwrap().join("\n");
        return Err(git_error(args, tail.as_bytes()));
    }
    Ok(())
}

fn git_error(args: &[&str], stderr: &[u8]) -> Error {
    Error::Git {
        args: args.join(" "),
        stderr: String::from_utf8_lossy(stderr).trim().to_owned(),
    }
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
