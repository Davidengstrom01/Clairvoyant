mod common;

use std::fs;

use clairvoyant_lib::error::Error;
use clairvoyant_lib::git;
use clairvoyant_lib::overview::repo_overview;
use common::TestRepo;

#[test]
fn lists_main_and_linked_worktrees() {
    let repo = TestRepo::new();
    let linked = repo.sibling("feature x");
    repo.git(&[
        "worktree",
        "add",
        "-b",
        "feature/x",
        linked.to_str().unwrap(),
    ]);

    let worktrees = git::list_worktrees(&repo.root).unwrap();

    assert_eq!(worktrees.len(), 2);
    assert_eq!(worktrees[0].path, repo.root);
    assert!(worktrees[0].is_main);
    assert_eq!(worktrees[0].branch.as_deref(), Some("main"));
    assert_eq!(worktrees[1].path, linked);
    assert!(!worktrees[1].is_main);
    assert_eq!(worktrees[1].branch.as_deref(), Some("feature/x"));
    assert_eq!(worktrees[0].head, worktrees[1].head);
    assert!(worktrees[1].head.is_some());
}

#[test]
fn same_list_from_inside_a_linked_worktree() {
    let repo = TestRepo::new();
    let linked = repo.sibling("linked");
    repo.git(&["worktree", "add", "-b", "linked", linked.to_str().unwrap()]);

    assert_eq!(
        git::list_worktrees(&linked).unwrap(),
        git::list_worktrees(&repo.root).unwrap()
    );
    assert_eq!(git::main_worktree(&linked).unwrap(), repo.root);
}

#[test]
fn reports_detached_and_locked_worktrees() {
    let repo = TestRepo::new();
    let linked = repo.sibling("detached");
    repo.git(&["worktree", "add", "--detach", linked.to_str().unwrap()]);
    repo.git(&[
        "worktree",
        "lock",
        "--reason",
        "on usb",
        linked.to_str().unwrap(),
    ]);

    let worktrees = git::list_worktrees(&repo.root).unwrap();

    assert!(worktrees[1].detached);
    assert_eq!(worktrees[1].branch, None);
    assert_eq!(worktrees[1].locked.as_deref(), Some("on usb"));
}

#[test]
fn flags_worktrees_whose_folder_was_deleted() {
    let repo = TestRepo::new();
    let linked = repo.sibling("gone");
    repo.git(&["worktree", "add", "-b", "gone", linked.to_str().unwrap()]);
    fs::remove_dir_all(&linked).unwrap();

    let worktrees = git::list_worktrees(&repo.root).unwrap();

    assert!(worktrees[1].prunable.is_some());
}

#[test]
fn overview_skips_status_for_prunable_worktrees() {
    let repo = TestRepo::new();
    let linked = repo.sibling("gone");
    repo.git(&["worktree", "add", "-b", "gone", linked.to_str().unwrap()]);
    fs::remove_dir_all(&linked).unwrap();
    repo.write("README.md", "changed\n");

    let overview = repo_overview(&repo.root).unwrap().worktrees;

    assert_eq!(overview.len(), 2);
    assert_eq!(overview[0].status.as_ref().unwrap().files.len(), 1);
    assert!(overview[1].status.is_none());
    assert!(overview[1].error.is_none());
}

#[test]
fn folder_outside_any_repo_is_rejected() {
    let dir = tempfile::tempdir().unwrap();

    assert!(matches!(
        git::main_worktree(dir.path()),
        Err(Error::NotARepo(_))
    ));
}
