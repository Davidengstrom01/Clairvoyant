use std::path::Path;

use super::{run, run_streaming};
use crate::error::{Error, Result};

/// True when HEAD is reachable from any remote-tracking branch, i.e. pushed.
pub fn head_is_published(worktree: &Path) -> Result<bool> {
    let Ok(out) = run(
        worktree,
        &[
            "for-each-ref",
            "--contains=HEAD",
            "--format=%(refname)",
            "refs/remotes",
        ],
    ) else {
        // No HEAD yet (before the first commit): nothing is published.
        return Ok(false);
    };
    Ok(!out.trim().is_empty())
}

/// Commits the staged changes; hooks run as usual and their output is streamed
/// to `on_line`. An amend with an empty message keeps the existing message.
/// Returns the new HEAD.
pub fn commit(
    worktree: &Path,
    message: &str,
    amend: bool,
    on_line: &(dyn Fn(&str) + Sync),
) -> Result<String> {
    let message = message.trim();
    if amend && head_is_published(worktree)? {
        return Err(Error::Refused(
            "HEAD is already pushed; amending would rewrite published history. Make a new commit instead."
                .into(),
        ));
    }
    if message.is_empty() && !amend {
        return Err(Error::Refused("write a commit message first".into()));
    }

    let mut args = vec!["commit"];
    if amend {
        args.push("--amend");
    }
    if message.is_empty() {
        args.push("--no-edit");
        run_streaming(worktree, &args, None, on_line)?;
    } else {
        args.extend(["--cleanup=strip", "-F", "-"]);
        run_streaming(worktree, &args, Some(message.as_bytes()), on_line)?;
    }
    Ok(run(worktree, &["rev-parse", "HEAD"])?.trim().to_owned())
}
