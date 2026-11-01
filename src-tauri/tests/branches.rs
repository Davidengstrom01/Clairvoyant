mod common;

use std::fs;

use clairvoyant_lib::error::Error;
use clairvoyant_lib::git::{self, AheadBehind, Branch};
use clairvoyant_lib::overview;
use common::TestRepo;

fn find<'a>(branches: &'a [Branch], name: &str) -> &'a Branch {
    branches
        .iter()
        .find(|b| b.name == name)
        .unwrap_or_else(|| panic!("{name} not in {branches:#?}"))
}

#[test]
fn branch_list_knows_worktrees_merges_and_distance_from_default() {
    let repo = TestRepo::with_remote();
    repo.git(&["branch", "merged-already"]);
    let linked = repo.sibling("feature");
    repo.git(&["worktree", "add", "-b", "feature", linked.to_str().unwrap()]);
    fs::write(linked.join("f.txt"), "x\n").unwrap();
    common::git(&linked, &["add", "."]);
    common::git(&linked, &["commit", "-m", "feature work"]);

    let branches = git::branches(&repo.root).unwrap();

    assert_eq!(
        git::default_branch(&repo.root).as_deref(),
        Some("origin/main")
    );
    let main = find(&branches, "main");
    assert_eq!(main.worktree.as_deref(), Some(repo.root.as_path()));
    assert_eq!(main.upstream.as_deref(), Some("origin/main"));
    let feature = find(&branches, "feature");
    assert_eq!(feature.worktree.as_deref(), Some(linked.as_path()));
    assert_eq!(
        feature.vs_default,
        Some(AheadBehind {
            ahead: 1,
            behind: 0
        })
    );
    assert_eq!(feature.subject, "feature work");
    assert!(!feature.merged);
    let merged = find(&branches, "merged-already");
    assert!(merged.merged);
    assert_eq!(merged.worktree, None);
    let origin_main = find(&branches, "origin/main");
    assert!(origin_main.remote && origin_main.is_default && !origin_main.merged);
    assert!(
        branches
            .iter()
            .all(|b| b.name != "origin/HEAD" && b.name != "origin")
    );
}

#[test]
fn without_a_remote_the_default_is_local_main() {
    let repo = TestRepo::new();
    repo.git(&["branch", "topic"]);

    let branches = git::branches(&repo.root).unwrap();

    assert!(find(&branches, "main").is_default);
    assert!(find(&branches, "topic").merged);
}

#[test]
fn deleted_remote_branch_shows_as_gone_after_fetch() {
    let repo = TestRepo::with_remote();
    repo.git(&["checkout", "-b", "short-lived"]);
    repo.git(&["push", "-u", "origin", "short-lived"]);
    repo.git(&["checkout", "main"]);
    repo.git(&["push", "origin", "--delete", "short-lived"]);
    // Restore the remote-tracking ref so only a prune can reveal it is gone.
    repo.git(&["update-ref", "refs/remotes/origin/short-lived", "HEAD"]);

    git::fetch(&repo.root).unwrap();

    let branches = git::branches(&repo.root).unwrap();
    assert!(find(&branches, "short-lived").upstream_gone);
    assert!(git::last_fetch(&repo.root).unwrap().is_some());
    assert!(
        overview::repo_overview(&repo.root)
            .unwrap()
            .last_fetch
            .is_some()
    );
}

#[test]
fn create_switch_and_safely_delete_branches() {
    let repo = TestRepo::new();
    git::create_branch(&repo.root, "topic", None).unwrap();
    git::switch_branch(&repo.root, "topic", false).unwrap();
    repo.write("t.txt", "x\n");
    repo.commit_all("unmerged work");
    git::switch_branch(&repo.root, "main", false).unwrap();

    let refused = git::delete_branch(&repo.root, "topic", false);
    assert!(matches!(refused, Err(Error::Git { .. })), "{refused:?}");

    git::delete_branch(&repo.root, "topic", true).unwrap();
    assert!(
        git::branches(&repo.root)
            .unwrap()
            .iter()
            .all(|b| b.name != "topic")
    );
}

#[test]
fn invalid_branch_names_are_refused() {
    let repo = TestRepo::new();
    for name in ["-D", "has space", "a..b"] {
        assert!(
            matches!(
                git::create_branch(&repo.root, name, None),
                Err(Error::Refused(_))
            ),
            "{name}"
        );
    }
}

#[test]
fn switching_to_a_remote_branch_creates_a_tracking_branch() {
    let repo = TestRepo::with_remote();
    repo.git(&["checkout", "-b", "shared"]);
    repo.git(&["push", "-u", "origin", "shared"]);
    repo.git(&["checkout", "main"]);
    repo.git(&["branch", "-D", "shared"]);

    git::switch_branch(&repo.root, "origin/shared", true).unwrap();

    let status = git::status(&repo.root).unwrap();
    assert_eq!(status.branch.as_deref(), Some("shared"));
    assert_eq!(status.upstream.as_deref(), Some("origin/shared"));
}

#[test]
fn compare_lists_commits_behind_count_and_files() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-b", "topic"]);
    repo.write("added.txt", "new\n");
    repo.git(&["mv", "README.md", "MOVED.md"]);
    repo.commit_all("topic work");
    repo.git(&["checkout", "main"]);
    repo.write("main-only.txt", "x\n");
    repo.commit_all("main moves on");

    let comparison = git::compare(&repo.root, "main", "topic").unwrap();

    assert_eq!(comparison.commits.len(), 1);
    assert_eq!(comparison.commits[0].subject, "topic work");
    assert_eq!(comparison.behind, 1);
    let paths: Vec<(&str, &str)> = comparison
        .files
        .iter()
        .map(|f| (f.status.as_str(), f.path.as_str()))
        .collect();
    assert_eq!(paths, vec![("R", "MOVED.md"), ("A", "added.txt")]);
    assert_eq!(comparison.files[0].orig_path.as_deref(), Some("README.md"));

    let diff = git::compare_diff(&repo.root, "main", "topic", "added.txt").unwrap();
    assert_eq!(diff.hunks[0].lines[0].text, "new");
}

#[test]
fn add_and_remove_worktrees_with_dirty_guard() {
    let repo = TestRepo::new();
    let path = repo.sibling("wt root/feature-x");

    git::add_worktree(&repo.root, &path, "feature/x", true, None).unwrap();

    let worktrees = git::list_worktrees(&repo.root).unwrap();
    assert_eq!(worktrees[1].path, path);
    assert_eq!(worktrees[1].branch.as_deref(), Some("feature/x"));

    fs::write(path.join("wip.txt"), "unsaved idea\n").unwrap();
    let refused = git::remove_worktree(&repo.root, &path, false);
    assert!(matches!(refused, Err(Error::Refused(_))), "{refused:?}");
    assert!(path.exists());

    git::remove_worktree(&repo.root, &path, true).unwrap();

    assert!(!path.exists());
    assert_eq!(git::list_worktrees(&repo.root).unwrap().len(), 1);
    // The forced removal left a copy of the work in the trash.
    let trash = git::list_trash(&repo.root).unwrap();
    assert_eq!(trash[0].paths, vec!["wip.txt"]);
}

#[test]
fn worktree_for_an_existing_branch() {
    let repo = TestRepo::new();
    repo.git(&["branch", "existing"]);
    let path = repo.sibling("existing");

    git::add_worktree(&repo.root, &path, "existing", false, None).unwrap();

    assert_eq!(
        git::status(&path).unwrap().branch.as_deref(),
        Some("existing")
    );
}

#[test]
fn main_and_locked_worktrees_are_not_removed() {
    let repo = TestRepo::new();
    let path = repo.sibling("locked");
    repo.git(&["worktree", "add", "-b", "locked", path.to_str().unwrap()]);
    repo.git(&["worktree", "lock", path.to_str().unwrap()]);

    assert!(matches!(
        git::remove_worktree(&repo.root, &repo.root, true),
        Err(Error::Refused(_))
    ));
    assert!(matches!(
        git::remove_worktree(&repo.root, &path, true),
        Err(Error::Refused(_))
    ));
    assert!(path.exists());
}

#[test]
fn removing_a_worktree_whose_folder_is_gone_prunes_it() {
    let repo = TestRepo::new();
    let path = repo.sibling("gone");
    repo.git(&["worktree", "add", "-b", "gone", path.to_str().unwrap()]);
    fs::remove_dir_all(&path).unwrap();

    git::remove_worktree(&repo.root, &path, false).unwrap();

    assert_eq!(git::list_worktrees(&repo.root).unwrap().len(), 1);
}

#[test]
fn compare_diffs_match_per_file_compare() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-b", "topic"]);
    repo.write("src/a b.ts", "export const a = 1;\n");
    repo.write("src/ü.rs", "fn main() {}\n");
    repo.git(&["mv", "README.md", "DOCS.md"]);
    repo.commit_all("topic work");

    let diffs = git::compare_diffs(&repo.root, "main", "topic").unwrap();

    let paths: Vec<&str> = diffs.iter().map(|d| d.path.as_str()).collect();
    assert_eq!(paths, vec!["DOCS.md", "src/a b.ts", "src/ü.rs"]);
    assert_eq!(diffs[0].orig_path.as_deref(), Some("README.md"));
    // Seen as a rename, which a single-path diff can't do (it shows an added file).
    assert!(
        diffs[0]
            .diff
            .header
            .iter()
            .any(|l| l == "rename from README.md")
    );
    for d in &diffs[1..] {
        assert_eq!(
            d.diff,
            git::compare_diff(&repo.root, "main", "topic", &d.path).unwrap(),
            "{}",
            d.path
        );
    }
    assert!(matches!(
        git::compare_diffs(&repo.root, "--output=x", "topic"),
        Err(Error::Refused(_))
    ));
}
