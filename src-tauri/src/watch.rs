//! Keeps the dashboard fresh: watches every worktree folder and each repo's
//! common git dir, batches the events, and reports which worktree or repo changed.

use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher as _};
use serde::Serialize;

use crate::error::{Error, Result};

/// A batch ends after this much quiet...
const QUIET: Duration = Duration::from_millis(300);
/// ...or after this long, so a build that never stops writing still refreshes.
const MAX_WAIT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WatchedRepo {
    pub repo: PathBuf,
    pub common_dir: PathBuf,
    pub worktrees: Vec<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub repo: PathBuf,
    /// `None` means repo-wide: refs, HEAD, the index or the worktree list changed.
    pub worktree: Option<PathBuf>,
}

pub struct Watcher {
    watcher: Mutex<RecommendedWatcher>,
    watched: Mutex<HashSet<PathBuf>>,
    repos: Arc<Mutex<Vec<WatchedRepo>>>,
}

impl Watcher {
    pub fn start(on_changes: impl Fn(Vec<Change>) + Send + 'static) -> Result<Self> {
        let (tx, rx) = mpsc::channel::<PathBuf>();
        let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            if let Ok(event) = event {
                for path in event.paths {
                    let _ = tx.send(path);
                }
            }
        })
        .map_err(|e| Error::Io(std::io::Error::other(e)))?;
        let repos = Arc::new(Mutex::new(Vec::new()));

        let worker_repos = Arc::clone(&repos);
        thread::spawn(move || {
            while let Ok(first) = rx.recv() {
                let mut paths = vec![first];
                let started = Instant::now();
                while started.elapsed() < MAX_WAIT {
                    match rx.recv_timeout(QUIET) {
                        Ok(path) => paths.push(path),
                        Err(RecvTimeoutError::Timeout) => break,
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                }
                let repos = worker_repos.lock().unwrap().clone();
                let changes = collapse(paths.iter().filter_map(|p| classify(&repos, p)));
                if !changes.is_empty() {
                    on_changes(changes);
                }
            }
        });

        Ok(Self {
            watcher: Mutex::new(watcher),
            watched: Mutex::new(HashSet::new()),
            repos,
        })
    }

    /// Replaces the watched set, only touching folders that were added or removed.
    pub fn set_repos(&self, repos: Vec<WatchedRepo>) {
        let mut desired = HashSet::new();
        for repo in &repos {
            desired.extend(repo.worktrees.iter().cloned());
            // The main worktree's recursive watch usually covers the common dir already.
            if !repo
                .worktrees
                .iter()
                .any(|wt| repo.common_dir.starts_with(wt))
            {
                desired.insert(repo.common_dir.clone());
            }
        }
        let mut watcher = self.watcher.lock().unwrap();
        let mut watched = self.watched.lock().unwrap();
        for gone in watched.difference(&desired) {
            let _ = watcher.unwatch(gone);
        }
        // Folders that fail to watch (deleted, no permission) are retried next sync.
        *watched = desired
            .into_iter()
            .filter(|path| {
                watched.contains(path) || watcher.watch(path, RecursiveMode::Recursive).is_ok()
            })
            .collect();
        *self.repos.lock().unwrap() = repos;
    }
}

/// Maps a changed path to what needs refreshing, or `None` for noise.
pub fn classify(repos: &[WatchedRepo], path: &Path) -> Option<Change> {
    for repo in repos {
        if let Ok(rel) = path.strip_prefix(&repo.common_dir) {
            let first = rel.components().next();
            let noisy = matches!(first, Some(Component::Normal(c)) if c == "objects" || c == "logs")
                || path.extension().is_some_and(|ext| ext == "lock");
            return (!noisy).then(|| Change {
                repo: repo.repo.clone(),
                worktree: None,
            });
        }
    }
    // Worktrees can be nested (e.g. `.claude/worktrees/x` inside the main one): the deepest match wins.
    let (repo, worktree) = repos
        .iter()
        .flat_map(|repo| repo.worktrees.iter().map(move |wt| (repo, wt)))
        .filter(|(_, wt)| path.starts_with(wt))
        .max_by_key(|(_, wt)| wt.components().count())?;
    let rel = path.strip_prefix(worktree).ok()?;
    if rel.components().any(|c| c.as_os_str() == "node_modules") {
        return None;
    }
    Some(Change {
        repo: repo.repo.clone(),
        worktree: Some(worktree.clone()),
    })
}

/// Dedupes, and drops worktree changes covered by a repo-wide change.
fn collapse(changes: impl Iterator<Item = Change>) -> Vec<Change> {
    let all: HashSet<Change> = changes.collect();
    let repo_wide: HashSet<&PathBuf> = all
        .iter()
        .filter(|c| c.worktree.is_none())
        .map(|c| &c.repo)
        .collect();
    let mut result: Vec<Change> = all
        .iter()
        .filter(|c| c.worktree.is_none() || !repo_wide.contains(&c.repo))
        .cloned()
        .collect();
    result.sort_by(|a, b| (&a.repo, &a.worktree).cmp(&(&b.repo, &b.worktree)));
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repos() -> Vec<WatchedRepo> {
        vec![WatchedRepo {
            repo: "/code/app".into(),
            common_dir: "/code/app/.git".into(),
            worktrees: vec![
                "/code/app".into(),
                "/code/app/.claude/worktrees/pr-1".into(),
                "/code/app.worktrees/feature".into(),
            ],
        }]
    }

    fn change(worktree: Option<&str>) -> Option<Change> {
        Some(Change {
            repo: "/code/app".into(),
            worktree: worktree.map(PathBuf::from),
        })
    }

    #[test]
    fn file_edits_map_to_the_deepest_worktree() {
        let repos = repos();
        assert_eq!(
            classify(&repos, Path::new("/code/app/src/a.rs")),
            change(Some("/code/app"))
        );
        assert_eq!(
            classify(&repos, Path::new("/code/app/.claude/worktrees/pr-1/x.ts")),
            change(Some("/code/app/.claude/worktrees/pr-1"))
        );
        assert_eq!(
            classify(&repos, Path::new("/code/app.worktrees/feature/b.rs")),
            change(Some("/code/app.worktrees/feature"))
        );
    }

    #[test]
    fn git_dir_changes_are_repo_wide_except_noise() {
        let repos = repos();
        assert_eq!(
            classify(&repos, Path::new("/code/app/.git/refs/heads/main")),
            change(None)
        );
        assert_eq!(
            classify(&repos, Path::new("/code/app/.git/worktrees/feature/HEAD")),
            change(None)
        );
        assert_eq!(
            classify(&repos, Path::new("/code/app/.git/objects/ab/cdef")),
            None
        );
        assert_eq!(
            classify(&repos, Path::new("/code/app/.git/index.lock")),
            None
        );
    }

    #[test]
    fn ignores_node_modules_and_unknown_paths() {
        let repos = repos();
        assert_eq!(
            classify(&repos, Path::new("/code/app/node_modules/x/index.js")),
            None
        );
        assert_eq!(classify(&repos, Path::new("/elsewhere/file")), None);
    }

    #[test]
    fn repo_wide_change_absorbs_worktree_changes() {
        let changes = collapse(
            [change(Some("/code/app")), change(None), change(None)]
                .into_iter()
                .flatten(),
        );
        assert_eq!(changes, vec![change(None).unwrap()]);
    }
}
