mod common;

use clairvoyant_lib::git::{self, AheadBehind, ChangeKind, FileChange};
use common::TestRepo;

fn find<'a>(files: &'a [FileChange], path: &str) -> &'a FileChange {
    files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} not in {files:#?}"))
}

#[test]
fn clean_repo_has_branch_and_no_changes() {
    let repo = TestRepo::new();

    let status = git::status(&repo.root).unwrap();

    assert_eq!(status.branch.as_deref(), Some("main"));
    assert!(status.head_oid.is_some());
    assert_eq!(status.upstream, None);
    assert_eq!(status.ahead_behind, None);
    assert_eq!(status.stash_count, 0);
    assert!(status.files.is_empty());
}

#[test]
fn repo_without_commits_has_no_head() {
    let repo = TestRepo::empty();

    let status = git::status(&repo.root).unwrap();

    assert_eq!(status.head_oid, None);
    assert_eq!(status.branch.as_deref(), Some("main"));
}

#[test]
fn separates_staged_unstaged_and_untracked() {
    let repo = TestRepo::new();
    repo.write("staged.txt", "new\n");
    repo.git(&["add", "staged.txt"]);
    repo.write("README.md", "edited\n");
    repo.write("notes/résumé draft.txt", "untracked\n");

    let files = git::status(&repo.root).unwrap().files;

    assert_eq!(files.len(), 3);
    let staged = find(&files, "staged.txt");
    assert_eq!(
        (staged.kind, staged.staged, staged.unstaged),
        (ChangeKind::Tracked, 'A', '.')
    );
    let edited = find(&files, "README.md");
    assert_eq!(
        (edited.kind, edited.staged, edited.unstaged),
        (ChangeKind::Tracked, '.', 'M')
    );
    let untracked = find(&files, "notes/résumé draft.txt");
    assert_eq!(untracked.kind, ChangeKind::Untracked);
}

#[test]
fn file_staged_then_edited_again_is_both() {
    let repo = TestRepo::new();
    repo.write("README.md", "first edit\n");
    repo.git(&["add", "README.md"]);
    repo.write("README.md", "second edit\n");

    let files = git::status(&repo.root).unwrap().files;

    assert_eq!((files[0].staged, files[0].unstaged), ('M', 'M'));
}

#[test]
fn renames_keep_their_source_path() {
    let repo = TestRepo::new();
    repo.git(&["mv", "README.md", "docs and notes.md"]);

    let files = git::status(&repo.root).unwrap().files;

    assert_eq!(files.len(), 1);
    assert_eq!(files[0].kind, ChangeKind::Renamed);
    assert_eq!(files[0].path, "docs and notes.md");
    assert_eq!(files[0].orig_path.as_deref(), Some("README.md"));
    assert_eq!(files[0].staged, 'R');
}

#[test]
fn merge_conflicts_are_reported() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-b", "other"]);
    repo.write("README.md", "theirs\n");
    repo.commit_all("theirs");
    repo.git(&["checkout", "main"]);
    repo.write("README.md", "ours\n");
    repo.commit_all("ours");
    // Exits non-zero because of the conflict.
    common::try_git(&repo.root, &["merge", "other"]);

    let files = git::status(&repo.root).unwrap().files;

    assert_eq!(files.len(), 1);
    assert_eq!(files[0].kind, ChangeKind::Conflicted);
    assert_eq!((files[0].staged, files[0].unstaged), ('U', 'U'));
}

#[test]
fn ahead_and_behind_upstream() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-b", "feature", "--track", "main"]);
    repo.write("feature.txt", "work\n");
    repo.commit_all("feature work");
    repo.git(&["checkout", "main"]);
    repo.write("main.txt", "work\n");
    repo.commit_all("main work 1");
    repo.write("main.txt", "more work\n");
    repo.commit_all("main work 2");
    repo.git(&["checkout", "feature"]);

    let status = git::status(&repo.root).unwrap();

    assert_eq!(status.upstream.as_deref(), Some("main"));
    assert_eq!(
        status.ahead_behind,
        Some(AheadBehind {
            ahead: 1,
            behind: 2
        })
    );
}

#[test]
fn upstream_that_no_longer_exists_has_no_ahead_behind() {
    let repo = TestRepo::new();
    repo.git(&["branch", "temp"]);
    repo.git(&["checkout", "-b", "feature", "--track", "temp"]);
    repo.git(&["branch", "-D", "temp"]);

    let status = git::status(&repo.root).unwrap();

    assert_eq!(status.upstream.as_deref(), Some("temp"));
    assert_eq!(status.ahead_behind, None);
}

#[test]
fn detached_head_and_stashes() {
    let repo = TestRepo::new();
    repo.write("README.md", "stash me\n");
    repo.git(&["stash"]);
    repo.git(&["checkout", "--detach"]);

    let status = git::status(&repo.root).unwrap();

    assert_eq!(status.branch, None);
    assert!(status.head_oid.is_some());
    assert_eq!(status.stash_count, 1);
}

#[test]
fn linked_worktree_has_its_own_changes() {
    let repo = TestRepo::new();
    let linked = repo.sibling("linked");
    repo.git(&["worktree", "add", "-b", "linked", linked.to_str().unwrap()]);
    std::fs::write(linked.join("only-here.txt"), "x\n").unwrap();

    assert!(git::status(&repo.root).unwrap().files.is_empty());
    let linked_status = git::status(&linked).unwrap();
    assert_eq!(linked_status.branch.as_deref(), Some("linked"));
    assert_eq!(linked_status.files[0].path, "only-here.txt");
}
