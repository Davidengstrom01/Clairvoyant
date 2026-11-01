use std::path::Path;

use super::{git_dirs, run, state::mtime};
use crate::error::Result;

/// Updates remote-tracking refs for every remote. This is the only network call
/// Clairvoyant makes; it never pushes or pulls, so your work is never touched.
pub fn fetch(repo: &Path) -> Result<()> {
    run(repo, &["fetch", "--all", "--prune", "--quiet"])?;
    Ok(())
}

/// Unix seconds of the last fetch, from `FETCH_HEAD` in the common git dir.
pub fn last_fetch(repo: &Path) -> Result<Option<i64>> {
    let (_, common) = git_dirs(repo)?;
    Ok(mtime(&common.join("FETCH_HEAD")))
}
