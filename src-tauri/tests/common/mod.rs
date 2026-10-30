//! Throwaway git repos for integration tests. Each test builds the exact state
//! it needs with real git commands, so parsers are checked against real output.

#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use tempfile::TempDir;

pub struct TestRepo {
    _dir: TempDir,
    /// Folder holding the repo and any linked worktrees.
    pub base: PathBuf,
    /// The main worktree. Its name has a space to keep path handling honest.
    pub root: PathBuf,
}

impl TestRepo {
    /// A repo on `main` with one commit containing `README.md`.
    pub fn new() -> Self {
        let repo = Self::empty();
        repo.write("README.md", "hello\n");
        repo.git(&["add", "."]);
        repo.git(&["commit", "-m", "initial"]);
        repo
    }

    /// A repo on `main` with no commits.
    pub fn empty() -> Self {
        let dir = tempfile::tempdir().unwrap();
        // macOS temp dirs live behind a /var -> /private/var symlink; git reports real paths.
        let base = dir.path().canonicalize().unwrap();
        let root = base.join("main repo");
        fs::create_dir(&root).unwrap();
        git(&root, &["init", "-b", "main"]);
        Self {
            _dir: dir,
            base,
            root,
        }
    }

    pub fn git(&self, args: &[&str]) -> String {
        git(&self.root, args)
    }

    pub fn write(&self, rel: &str, contents: &str) {
        let path = self.root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }

    pub fn commit_all(&self, message: &str) {
        self.git(&["add", "-A"]);
        self.git(&["commit", "-m", message]);
    }

    /// Path for a linked worktree, outside the main worktree.
    pub fn sibling(&self, name: &str) -> PathBuf {
        self.base.join(name)
    }
}

/// Runs git with the user's global and system config shut out, so a personal
/// setting (signing, hooks, default branch) can't change test outcomes.
pub fn git(cwd: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args([
            "-c",
            "user.name=Clairvoyant Test",
            "-c",
            "user.email=test@example.invalid",
        ])
        .args(args)
        .current_dir(cwd)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}
