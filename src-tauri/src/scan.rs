//! One-off "scan folder" to find repos to register in bulk.

use std::fs;
use std::path::{Path, PathBuf};

/// Folders that never contain repos worth listing but can be huge.
const SKIP: [&str; 7] = [
    "node_modules",
    "target",
    "vendor",
    "bin",
    "obj",
    "dist",
    "build",
];

/// Finds main worktrees (folders with a `.git` directory) up to `max_depth`
/// levels below `root`. Does not descend into repos it finds.
pub fn scan(root: &Path, max_depth: usize) -> Vec<PathBuf> {
    let mut found = Vec::new();
    visit(root, max_depth, &mut found);
    found.sort();
    found
}

fn visit(dir: &Path, depth_left: usize, found: &mut Vec<PathBuf>) {
    // A `.git` file marks a linked worktree or submodule; those come with their main repo.
    if dir.join(".git").is_dir() {
        found.push(dir.to_owned());
        return;
    }
    if depth_left == 0 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let is_dir = entry.file_type().is_ok_and(|t| t.is_dir());
        if is_dir && !name.starts_with('.') && !SKIP.contains(&name.as_ref()) {
            visit(&entry.path(), depth_left - 1, found);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_repos_but_not_inside_them_or_skipped_folders() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for repo in [
            "a",
            "group/b",
            "group/b/nested",
            "node_modules/c",
            "deep/1/2/3/d",
        ] {
            fs::create_dir_all(root.join(repo).join(".git")).unwrap();
        }
        fs::create_dir_all(root.join("linked")).unwrap();
        fs::write(root.join("linked/.git"), "gitdir: elsewhere").unwrap();

        assert_eq!(scan(root, 3), vec![root.join("a"), root.join("group/b")]);
    }
}
