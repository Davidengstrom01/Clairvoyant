mod common;

use std::fs;

use clairvoyant_lib::git::{self, DiffSource, HunkAction, LineKind};
use common::TestRepo;

/// Twenty numbered lines, so edits at the top and bottom land in separate hunks.
fn numbered(edit: impl Fn(usize) -> Option<String>) -> String {
    (1..=20)
        .map(|n| edit(n).unwrap_or_else(|| format!("line {n}")) + "\n")
        .collect()
}

fn repo_with_numbered_file() -> TestRepo {
    let repo = TestRepo::new();
    repo.write("list.txt", &numbered(|_| None));
    repo.commit_all("numbers");
    repo
}

fn staged_and_unstaged(repo: &TestRepo) -> (Vec<String>, Vec<String>) {
    let files = git::status(&repo.root).unwrap().files;
    let pick = |f: fn(&git::FileChange) -> bool| {
        files
            .iter()
            .filter(|c| f(c))
            .map(|c| c.path.clone())
            .collect()
    };
    (pick(|c| c.staged != '.'), pick(|c| c.unstaged != '.'))
}

#[test]
fn stage_and_unstage_whole_files_including_deletions() {
    let repo = TestRepo::new();
    repo.write("new file.txt", "x\n");
    fs::remove_file(repo.root.join("README.md")).unwrap();

    git::stage(&repo.root, &["new file.txt", "README.md"]).unwrap();
    assert_eq!(
        staged_and_unstaged(&repo).0,
        vec!["README.md", "new file.txt"]
    );

    git::unstage(&repo.root, &["new file.txt", "README.md"]).unwrap();
    let files = git::status(&repo.root).unwrap().files;
    assert!(files.iter().all(|f| f.staged == '.'));
}

#[test]
fn unstage_works_before_the_first_commit() {
    let repo = TestRepo::empty();
    repo.write("a.txt", "x\n");
    git::stage(&repo.root, &["a.txt"]).unwrap();

    git::unstage(&repo.root, &["a.txt"]).unwrap();

    assert_eq!(
        git::status(&repo.root).unwrap().files[0].kind,
        git::ChangeKind::Untracked
    );
}

#[test]
fn paths_are_literal_not_globs() {
    let repo = TestRepo::new();
    repo.write("*.txt", "star\n");
    repo.write("other.txt", "other\n");

    git::stage(&repo.root, &["*.txt"]).unwrap();

    assert_eq!(staged_and_unstaged(&repo).0, vec!["*.txt"]);
}

#[test]
fn discard_can_be_undone_for_edits_new_files_and_deletions() {
    let repo = TestRepo::new();
    repo.write("extra.txt", "tracked\n");
    repo.commit_all("extra");
    repo.write("README.md", "precious edit\n");
    repo.write("scratch/notes.txt", "untracked work\n");
    fs::remove_file(repo.root.join("extra.txt")).unwrap();

    let id = git::discard(
        &repo.root,
        &["README.md", "extra.txt"],
        &["scratch/notes.txt"],
    )
    .unwrap();

    assert!(git::status(&repo.root).unwrap().files.is_empty());
    let trash = git::list_trash(&repo.root).unwrap();
    assert_eq!(trash.len(), 1);
    assert_eq!(trash[0].id, id);
    assert_eq!(trash[0].worktree, repo.root);

    git::restore_trash(&repo.root, &id).unwrap();

    assert_eq!(repo.read("README.md"), "precious edit\n");
    assert_eq!(repo.read("scratch/notes.txt"), "untracked work\n");
    assert!(!repo.root.join("extra.txt").exists());
    // The restore consumed its entry and snapshotted what it overwrote.
    let trash = git::list_trash(&repo.root).unwrap();
    assert_eq!(trash.len(), 1);
    assert_ne!(trash[0].id, id);
}

#[test]
fn discard_keeps_staged_changes() {
    let repo = TestRepo::new();
    repo.write("README.md", "staged\n");
    git::stage(&repo.root, &["README.md"]).unwrap();
    repo.write("README.md", "staged then edited\n");

    git::discard(&repo.root, &["README.md"], &[]).unwrap();

    assert_eq!(repo.read("README.md"), "staged\n");
    let files = git::status(&repo.root).unwrap().files;
    assert_eq!((files[0].staged, files[0].unstaged), ('M', '.'));
}

#[test]
fn trash_is_never_attributed_to_the_user_or_their_signing_key() {
    let repo = TestRepo::new();
    repo.write("README.md", "edit\n");
    repo.git(&["config", "commit.gpgsign", "true"]);

    let id = git::discard(&repo.root, &["README.md"], &[]).unwrap();

    let author = repo.git(&[
        "log",
        "-1",
        "--format=%an",
        &format!("refs/clairvoyant/trash/{id}"),
    ]);
    assert_eq!(author.trim(), "Clairvoyant");
}

#[test]
fn trash_entries_belong_to_their_worktree() {
    let repo = TestRepo::new();
    let linked = repo.sibling("linked");
    repo.git(&["worktree", "add", "-b", "linked", linked.to_str().unwrap()]);
    fs::write(linked.join("README.md"), "linked edit\n").unwrap();

    git::discard(&linked, &["README.md"], &[]).unwrap();

    let trash = git::list_trash(&repo.root).unwrap();
    assert_eq!(trash[0].worktree, linked);
}

#[test]
fn unstaged_diff_has_hunks_with_line_numbers() {
    let repo = repo_with_numbered_file();
    repo.write("list.txt", &numbered(|n| (n == 2).then(|| "second".into())));

    let diff = git::file_diff(&repo.root, "list.txt", None, DiffSource::Unstaged).unwrap();

    assert_eq!(diff.hunks.len(), 1);
    let removed = diff.hunks[0]
        .lines
        .iter()
        .find(|l| l.kind == LineKind::Removed)
        .unwrap();
    let added = diff.hunks[0]
        .lines
        .iter()
        .find(|l| l.kind == LineKind::Added)
        .unwrap();
    assert_eq!(
        (removed.text.as_str(), removed.old_line),
        ("line 2", Some(2))
    );
    assert_eq!((added.text.as_str(), added.new_line), ("second", Some(2)));
}

#[test]
fn untracked_and_staged_diffs() {
    let repo = TestRepo::new();
    repo.write("brand new.txt", "a\nb\n");
    let untracked =
        git::file_diff(&repo.root, "brand new.txt", None, DiffSource::Untracked).unwrap();
    assert_eq!(untracked.hunks[0].lines.len(), 2);

    repo.git(&["mv", "README.md", "renamed.md"]);
    let staged = git::file_diff(
        &repo.root,
        "renamed.md",
        Some("README.md"),
        DiffSource::Staged,
    )
    .unwrap();
    assert!(staged.header.iter().any(|l| l == "rename to renamed.md"));
}

#[test]
fn binary_files_are_flagged() {
    let repo = TestRepo::new();
    fs::write(repo.root.join("img.bin"), [0u8, 159, 146, 150, 0, 1]).unwrap();
    repo.commit_all("binary");
    fs::write(repo.root.join("img.bin"), [0u8, 1, 2, 3]).unwrap();

    assert!(
        git::file_diff(&repo.root, "img.bin", None, DiffSource::Unstaged)
            .unwrap()
            .binary
    );
}

#[test]
fn stage_and_unstage_a_single_hunk() {
    let repo = repo_with_numbered_file();
    repo.write(
        "list.txt",
        &numbered(|n| match n {
            1 => Some("FIRST".into()),
            20 => Some("LAST".into()),
            _ => None,
        }),
    );
    let diff = git::file_diff(&repo.root, "list.txt", None, DiffSource::Unstaged).unwrap();
    assert_eq!(diff.hunks.len(), 2);

    git::apply_hunk(
        &repo.root,
        "list.txt",
        &diff.hunks[0].header,
        HunkAction::Stage,
    )
    .unwrap();

    let staged = git::file_diff(&repo.root, "list.txt", None, DiffSource::Staged).unwrap();
    assert_eq!(staged.hunks.len(), 1);
    assert!(staged.hunks[0].lines.iter().any(|l| l.text == "FIRST"));
    let unstaged = git::file_diff(&repo.root, "list.txt", None, DiffSource::Unstaged).unwrap();
    assert!(unstaged.hunks[0].lines.iter().any(|l| l.text == "LAST"));

    git::apply_hunk(
        &repo.root,
        "list.txt",
        &staged.hunks[0].header,
        HunkAction::Unstage,
    )
    .unwrap();

    assert!(
        git::file_diff(&repo.root, "list.txt", None, DiffSource::Staged)
            .unwrap()
            .hunks
            .is_empty()
    );
    assert_eq!(repo.read("list.txt").lines().next(), Some("FIRST"));
}

#[test]
fn discard_a_single_hunk_and_undo_it() {
    let repo = repo_with_numbered_file();
    let edited = numbered(|n| match n {
        1 => Some("FIRST".into()),
        20 => Some("LAST".into()),
        _ => None,
    });
    repo.write("list.txt", &edited);
    let diff = git::file_diff(&repo.root, "list.txt", None, DiffSource::Unstaged).unwrap();

    let id = git::apply_hunk(
        &repo.root,
        "list.txt",
        &diff.hunks[1].header,
        HunkAction::Discard,
    )
    .unwrap()
    .unwrap();

    let content = repo.read("list.txt");
    assert!(content.starts_with("FIRST\n"));
    assert!(content.ends_with("line 20\n"));

    git::restore_trash(&repo.root, &id).unwrap();
    assert_eq!(repo.read("list.txt"), edited);
}

#[test]
fn stale_hunk_is_refused() {
    let repo = repo_with_numbered_file();
    repo.write("list.txt", &numbered(|n| (n == 1).then(|| "FIRST".into())));

    let result = git::apply_hunk(&repo.root, "list.txt", "@@ -5,3 +5,3 @@", HunkAction::Stage);

    assert!(matches!(
        result,
        Err(clairvoyant_lib::error::Error::Refused(_))
    ));
}

#[test]
fn crlf_hunks_round_trip() {
    let repo = TestRepo::new();
    repo.write("win.txt", "a\r\nb\r\nc\r\n");
    repo.commit_all("crlf");
    repo.write("win.txt", "a\r\nB\r\nc\r\n");
    let diff = git::file_diff(&repo.root, "win.txt", None, DiffSource::Unstaged).unwrap();

    git::apply_hunk(
        &repo.root,
        "win.txt",
        &diff.hunks[0].header,
        HunkAction::Stage,
    )
    .unwrap();

    assert_eq!(repo.git(&["show", ":win.txt"]), "a\r\nB\r\nc\r\n");
}
