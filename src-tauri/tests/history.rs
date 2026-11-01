mod common;

use std::sync::Mutex;

use clairvoyant_lib::error::Error;
use clairvoyant_lib::git::{self, Operation};
use clairvoyant_lib::overview;
use common::TestRepo;

fn no_output(_: &str) {}

#[test]
fn stash_push_list_and_pop() {
    let repo = TestRepo::new();
    repo.write("README.md", "edit\n");
    repo.write("new.txt", "untracked\n");

    git::stash_push(&repo.root, Some("half done"), true).unwrap();

    let files = git::status(&repo.root).unwrap().files;
    assert!(files.is_empty(), "{files:#?}");
    let stashes = git::stash_list(&repo.root).unwrap();
    assert_eq!(stashes.len(), 1);
    assert_eq!(stashes[0].index, 0);
    assert!(stashes[0].message.ends_with("half done"));

    git::stash_pop(&repo.root, 0).unwrap();

    assert_eq!(repo.read("new.txt"), "untracked\n");
    assert!(git::stash_list(&repo.root).unwrap().is_empty());
}

#[test]
fn stash_apply_keeps_the_stash() {
    let repo = TestRepo::new();
    repo.write("README.md", "edit\n");
    git::stash_push(&repo.root, None, false).unwrap();

    git::stash_apply(&repo.root, 0).unwrap();

    assert_eq!(repo.read("README.md"), "edit\n");
    assert_eq!(git::stash_list(&repo.root).unwrap().len(), 1);
}

#[test]
fn commit_streams_hook_output() {
    let repo = TestRepo::new();
    let hook = repo.root.join(".git/hooks/pre-commit");
    std::fs::write(&hook, "#!/bin/sh\necho linting staged files\n").unwrap();
    std::process::Command::new("chmod")
        .args(["+x", hook.to_str().unwrap()])
        .status()
        .unwrap();
    repo.write("README.md", "edit\n");
    git::stage(&repo.root, &["README.md"]).unwrap();

    let lines = Mutex::new(Vec::new());
    let head = git::commit(&repo.root, "  Edit readme\n\n", false, &|l| {
        lines.lock().unwrap().push(l.to_owned())
    })
    .unwrap();

    assert_eq!(head, repo.head());
    assert!(
        lines
            .into_inner()
            .unwrap()
            .iter()
            .any(|l| l == "linting staged files")
    );
    assert_eq!(
        repo.git(&["log", "-1", "--format=%B"]).trim(),
        "Edit readme"
    );
}

#[test]
fn failing_hook_blocks_the_commit_and_reports_why() {
    let repo = TestRepo::new();
    let hook = repo.root.join(".git/hooks/pre-commit");
    std::fs::write(
        &hook,
        "#!/bin/sh\necho 'lint failed: 3 errors' >&2\nexit 1\n",
    )
    .unwrap();
    std::process::Command::new("chmod")
        .args(["+x", hook.to_str().unwrap()])
        .status()
        .unwrap();
    let before = repo.head();
    repo.write("README.md", "edit\n");
    git::stage(&repo.root, &["README.md"]).unwrap();

    let err = git::commit(&repo.root, "Edit", false, &no_output).unwrap_err();

    assert!(err.to_string().contains("lint failed: 3 errors"));
    assert_eq!(repo.head(), before);
}

#[test]
fn empty_message_is_refused_unless_amending() {
    let repo = TestRepo::new();
    repo.write("README.md", "edit\n");
    git::stage(&repo.root, &["README.md"]).unwrap();

    assert!(matches!(
        git::commit(&repo.root, "  ", false, &no_output),
        Err(Error::Refused(_))
    ));

    git::commit(&repo.root, "", true, &no_output).unwrap();
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]).trim(), "initial");
    assert_eq!(repo.git(&["rev-list", "--count", "HEAD"]).trim(), "1");
}

#[test]
fn amend_is_allowed_until_head_is_pushed() {
    let repo = TestRepo::with_remote();
    repo.write("local.txt", "x\n");
    git::stage(&repo.root, &["local.txt"]).unwrap();
    git::commit(&repo.root, "Local work", false, &no_output).unwrap();
    assert!(!git::head_is_published(&repo.root).unwrap());

    git::commit(&repo.root, "Local work, reworded", true, &no_output).unwrap();

    repo.git(&["push", "origin", "main"]);
    assert!(git::head_is_published(&repo.root).unwrap());
    let result = git::commit(&repo.root, "Rewrite history", true, &no_output);
    assert!(matches!(result, Err(Error::Refused(_))));
}

#[test]
fn overview_reports_rebase_in_progress_and_activity() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-b", "feature"]);
    repo.write("README.md", "feature\n");
    repo.commit_all("feature");
    repo.git(&["checkout", "main"]);
    repo.write("README.md", "main\n");
    repo.commit_all("main");
    repo.git(&["checkout", "feature"]);
    common::try_git(&repo.root, &["rebase", "main"]);

    let summary = &overview::repo_overview(&repo.root).unwrap().worktrees[0];

    assert_eq!(summary.operation, Some(Operation::Rebase));
    assert!(summary.last_activity.is_some());
}

#[test]
fn overview_reports_merge_in_progress() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-b", "other"]);
    repo.write("README.md", "theirs\n");
    repo.commit_all("theirs");
    repo.git(&["checkout", "main"]);
    repo.write("README.md", "ours\n");
    repo.commit_all("ours");
    common::try_git(&repo.root, &["merge", "other"]);

    let summary = overview::worktree_summary(&repo.root, &repo.root).unwrap();

    assert_eq!(summary.operation, Some(Operation::Merge));
}
