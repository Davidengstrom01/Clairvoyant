use std::path::Path;
use std::thread;

use serde::{Deserialize, Serialize};

use super::{ChangeKind, LITERAL, Opts, exec, run};
use crate::error::{Error, Result};

/// Beyond this many lines a diff is cut short; the UI says so.
const MAX_LINES: usize = 10_000;

/// Across all files of one list; later files are sent without hunks and
/// loaded on demand, so a huge change set can't stall the window.
const MAX_TOTAL_LINES: usize = 20_000;

/// Which side of a file's pending changes to diff.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiffSource {
    /// Worktree vs index.
    Unstaged,
    /// Index vs HEAD.
    Staged,
    /// A new file that git doesn't track yet.
    Untracked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LineKind {
    Context,
    Added,
    Removed,
    /// `\ No newline at end of file`
    NoNewline,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: LineKind,
    /// The line without its diff prefix.
    pub text: String,
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    /// The `@@ ... @@` line; also identifies the hunk when staging it.
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    /// `diff --git`, `index`, `---`, `+++` lines; needed to rebuild a one-hunk patch.
    pub header: Vec<String>,
    pub hunks: Vec<Hunk>,
    pub binary: bool,
    /// A conflicted file's combined diff; its hunks can't be staged individually.
    pub combined: bool,
    pub truncated: bool,
}

impl Hunk {
    fn patch_lines(&self) -> impl Iterator<Item = String> + '_ {
        std::iter::once(self.header.clone()).chain(self.lines.iter().map(|line| {
            let prefix = match line.kind {
                LineKind::Context => ' ',
                LineKind::Added => '+',
                LineKind::Removed => '-',
                LineKind::NoNewline => '\\',
            };
            format!("{prefix}{}", line.text)
        }))
    }
}

impl FileDiff {
    /// A patch containing only the given hunk, for `git apply`.
    pub fn hunk_patch(&self, hunk: &Hunk) -> String {
        let mut patch = self
            .header
            .iter()
            .cloned()
            .chain(hunk.patch_lines())
            .collect::<Vec<_>>()
            .join("\n");
        patch.push('\n');
        patch
    }
}

// Pin output details that user config could otherwise change (prefixes, colour,
// external diff tools), because hunk patches are fed back to `git apply`.
const DIFF_FLAGS: [&str; 5] = [
    "--no-color",
    "--no-ext-diff",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--find-renames",
];

pub fn file_diff(
    worktree: &Path,
    path: &str,
    orig_path: Option<&str>,
    source: DiffSource,
) -> Result<FileDiff> {
    let mut args = vec![LITERAL, "diff"];
    if source == DiffSource::Staged {
        args.push("--cached");
    }
    args.extend(DIFF_FLAGS);
    let mut ok_codes: &[i32] = &[];
    match source {
        DiffSource::Untracked => {
            // --no-index exits 1 when the files differ, which they always do here.
            args.extend(["--no-index", "--", "/dev/null", path]);
            ok_codes = &[1];
        }
        _ => {
            args.push("--");
            args.extend(orig_path);
            args.push(path);
        }
    }
    let output = exec(
        worktree,
        &args,
        &Opts {
            ok_codes,
            ..Opts::default()
        },
    )?;
    parse(&String::from_utf8_lossy(&output.stdout))
}

/// What a pull request from `head` into `base` would change in one file.
pub fn compare_diff(repo: &Path, base: &str, head: &str, path: &str) -> Result<FileDiff> {
    let range = format!("{base}...{head}");
    let mut args = vec![LITERAL, "diff"];
    args.extend(DIFF_FLAGS);
    args.extend([range.as_str(), "--", path]);
    let output = exec(repo, &args, &Opts::default())?;
    parse(&String::from_utf8_lossy(&output.stdout))
}

/// One entry of `git diff --name-status -z`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NameStatus {
    /// A, M, D, R, C, T or U.
    pub status: String,
    pub path: String,
    /// Source path of a rename or copy.
    pub orig_path: Option<String>,
}

pub(crate) fn parse_name_status(out: &str) -> Result<Vec<NameStatus>> {
    let mut fields = out.split('\0').filter(|f| !f.is_empty());
    let mut entries = Vec::new();
    while let Some(status) = fields.next() {
        let letter = status.get(..1).unwrap_or_default().to_owned();
        let mut next = || {
            fields
                .next()
                .map(str::to_owned)
                .ok_or_else(|| Error::Parse(format!("name-status: {status}")))
        };
        let first = next()?;
        entries.push(if letter == "R" || letter == "C" {
            NameStatus {
                status: letter,
                path: next()?,
                orig_path: Some(first),
            }
        } else {
            NameStatus {
                status: letter,
                path: first,
                orig_path: None,
            }
        });
    }
    Ok(entries)
}

/// One file's diff in a list of all changed files.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathDiff {
    pub path: String,
    pub orig_path: Option<String>,
    /// Name-status letter, or `?` for an untracked file.
    pub status: String,
    pub diff: FileDiff,
    /// Past the size budget: no hunks were sent; fetch this file on its own.
    pub deferred: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeDiffs {
    /// Worktree vs index, followed by untracked files.
    pub unstaged: Vec<PathDiff>,
    /// Index vs HEAD.
    pub staged: Vec<PathDiff>,
}

/// Starts of per-file sections in a multi-file patch. Diff content lines all
/// begin with a space, `+`, `-` or `\`, so these markers can't occur inside one.
fn split_files(patch: &str) -> Vec<&str> {
    let mut starts = Vec::new();
    let mut offset = 0;
    for line in patch.split_inclusive('\n') {
        if line.starts_with("diff --git ")
            || line.starts_with("diff --cc ")
            || line.starts_with("* Unmerged path ")
        {
            starts.push(offset);
        }
        offset += line.len();
    }
    starts
        .iter()
        .enumerate()
        .map(|(i, &start)| &patch[start..starts.get(i + 1).copied().unwrap_or(patch.len())])
        .collect()
}

/// Every file of one `git diff` in a single patch, paired with paths from a
/// `--name-status -z` run with the same flags (same files, same order, and
/// NUL-safe paths, so quoted names in patch headers never need parsing).
/// If the two disagree, each file is diffed on its own via `fallback`.
fn diff_all(
    cwd: &Path,
    extra: &[&str],
    fallback: impl Fn(&NameStatus) -> Result<FileDiff>,
) -> Result<Vec<PathDiff>> {
    let mut args = vec!["diff"];
    args.extend(DIFF_FLAGS);
    args.extend(extra);
    let names = parse_name_status(&run(
        cwd,
        &[args.as_slice(), &["--name-status", "-z"]].concat(),
    )?)?;
    let patch = exec(cwd, &args, &Opts::default())?;
    let patch = String::from_utf8_lossy(&patch.stdout);
    let chunks = split_files(&patch);

    names
        .iter()
        .enumerate()
        .map(|(i, name)| {
            let diff = if chunks.len() == names.len() {
                parse(chunks[i])?
            } else {
                fallback(name)?
            };
            Ok(PathDiff {
                path: name.path.clone(),
                orig_path: name.orig_path.clone(),
                status: name.status.clone(),
                diff,
                deferred: false,
            })
        })
        .collect()
}

/// Strips hunks from files once the running line count passes `MAX_TOTAL_LINES`.
fn apply_budget(diffs: &mut [PathDiff]) {
    let mut total = 0;
    for entry in diffs {
        total += entry
            .diff
            .hunks
            .iter()
            .map(|h| h.lines.len())
            .sum::<usize>();
        if total > MAX_TOTAL_LINES {
            entry.diff.hunks.clear();
            entry.deferred = true;
        }
    }
}

/// All pending changes of a worktree, for the scrollable review pane.
pub fn worktree_diffs(worktree: &Path) -> Result<WorktreeDiffs> {
    let mut unstaged = diff_all(worktree, &[], |n| {
        file_diff(worktree, &n.path, None, DiffSource::Unstaged)
    })?;
    let untracked: Vec<String> = super::status(worktree)?
        .files
        .into_iter()
        .filter(|f| f.kind == ChangeKind::Untracked)
        .map(|f| f.path)
        .collect();
    // `git diff` can't show untracked files; diff each against /dev/null, a few at a time.
    for batch in untracked.chunks(8) {
        let diffs: Vec<Result<FileDiff>> = thread::scope(|scope| {
            let handles: Vec<_> = batch
                .iter()
                .map(|path| {
                    scope.spawn(move || file_diff(worktree, path, None, DiffSource::Untracked))
                })
                .collect();
            handles
                .into_iter()
                .map(|h| h.join().expect("diff thread panicked"))
                .collect()
        });
        for (path, diff) in batch.iter().zip(diffs) {
            unstaged.push(PathDiff {
                path: path.clone(),
                orig_path: None,
                status: "?".into(),
                diff: diff?,
                deferred: false,
            });
        }
    }
    let mut staged = diff_all(worktree, &["--cached"], |n| {
        file_diff(
            worktree,
            &n.path,
            n.orig_path.as_deref(),
            DiffSource::Staged,
        )
    })?;
    apply_budget(&mut unstaged);
    apply_budget(&mut staged);
    Ok(WorktreeDiffs { unstaged, staged })
}

/// Every file a pull request from `head` into `base` would change.
pub fn compare_diffs(repo: &Path, base: &str, head: &str) -> Result<Vec<PathDiff>> {
    for rev in [base, head] {
        if rev.starts_with('-') {
            return Err(Error::Refused(format!("`{rev}` is not a branch")));
        }
    }
    let range = format!("{base}...{head}");
    let mut diffs = diff_all(repo, &[range.as_str()], |n| {
        compare_diff(repo, base, head, &n.path)
    })?;
    apply_budget(&mut diffs);
    Ok(diffs)
}

pub(crate) fn parse(out: &str) -> Result<FileDiff> {
    let mut diff = FileDiff::default();
    let mut counters = (0u32, 0u32);
    let mut total = 0;
    if out.is_empty() {
        return Ok(diff);
    }

    // Split on \n only: `str::lines` would also strip \r and corrupt CRLF files.
    for line in out.strip_suffix('\n').unwrap_or(out).split('\n') {
        if line.starts_with("@@") {
            let (combined, old, new) = parse_hunk_header(line)?;
            diff.combined |= combined;
            counters = (old, new);
            diff.hunks.push(Hunk {
                header: line.to_owned(),
                lines: Vec::new(),
            });
            continue;
        }
        let Some(hunk) = diff.hunks.last_mut() else {
            diff.binary |= line.starts_with("Binary files") || line == "GIT binary patch";
            diff.header.push(line.to_owned());
            continue;
        };
        total += 1;
        if total > MAX_LINES {
            diff.truncated = true;
            break;
        }
        let line = if diff.combined {
            combined_line(line)
        } else {
            let (prefix, text) = line.split_at(line.len().min(1));
            let (old, new) = &mut counters;
            let (kind, old_line, new_line) = match prefix {
                "+" => (LineKind::Added, None, Some(bump(new))),
                "-" => (LineKind::Removed, Some(bump(old)), None),
                "\\" => (LineKind::NoNewline, None, None),
                _ => (LineKind::Context, Some(bump(old)), Some(bump(new))),
            };
            DiffLine {
                kind,
                text: text.to_owned(),
                old_line,
                new_line,
            }
        };
        hunk.lines.push(line);
    }
    Ok(diff)
}

fn bump(counter: &mut u32) -> u32 {
    *counter += 1;
    *counter - 1
}

/// Returns (is_combined, old_start, new_start) from `@@ -a,b +c,d @@` or `@@@ -a,b -c,d +e,f @@@`.
fn parse_hunk_header(line: &str) -> Result<(bool, u32, u32)> {
    let bad = || Error::Parse(format!("hunk header: {line}"));
    let combined = line.starts_with("@@@");
    let ranges: Vec<&str> = line
        .split(' ')
        .skip(1)
        .take_while(|p| !p.starts_with("@@"))
        .collect();
    let start = |range: &str| -> Result<u32> {
        let range = range.get(1..).ok_or_else(bad)?;
        range
            .split(',')
            .next()
            .unwrap_or_default()
            .parse()
            .map_err(|_| bad())
    };
    let old = ranges.first().ok_or_else(bad).and_then(|r| start(r))?;
    let new = ranges.last().ok_or_else(bad).and_then(|r| start(r))?;
    Ok((combined, old, new))
}

/// Combined diffs have one prefix column per parent; show them as plain lines.
fn combined_line(line: &str) -> DiffLine {
    let (prefix, text) = line.split_at(line.len().min(2));
    let kind = if prefix.contains('+') {
        LineKind::Added
    } else if prefix.contains('-') {
        LineKind::Removed
    } else {
        LineKind::Context
    };
    DiffLine {
        kind,
        text: text.to_owned(),
        old_line: None,
        new_line: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_line_numbers_and_no_newline_marker() {
        let out = "diff --git a/f b/f\nindex 1..2 100644\n--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@ fn x\n keep\n-old\n+new\n\\ No newline at end of file\n";
        let diff = parse(out).unwrap();

        assert_eq!(diff.header.len(), 4);
        let lines = &diff.hunks[0].lines;
        assert_eq!((lines[0].old_line, lines[0].new_line), (Some(1), Some(1)));
        assert_eq!(
            (lines[1].kind, lines[1].old_line),
            (LineKind::Removed, Some(2))
        );
        assert_eq!(
            (lines[2].kind, lines[2].new_line),
            (LineKind::Added, Some(2))
        );
        assert_eq!(lines[3].kind, LineKind::NoNewline);
    }

    #[test]
    fn rebuilds_a_one_hunk_patch_byte_for_byte() {
        let out =
            "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\r\n+b\r\n@@ -9 +9 @@\n-c\n+d\n";
        let diff = parse(out).unwrap();

        assert_eq!(
            diff.hunk_patch(&diff.hunks[0]),
            "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\r\n+b\r\n"
        );
    }

    #[test]
    fn splits_a_multi_file_patch_at_file_headers_only() {
        let patch = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-diff --git a/fake b/fake\n+y\ndiff --cc c\n@@@ -1,1 -1,1 +1,1 @@@\n++z\n* Unmerged path u\n";
        let chunks = split_files(patch);

        assert_eq!(chunks.len(), 3);
        assert!(chunks[0].contains("-diff --git a/fake b/fake"));
        assert!(chunks[1].starts_with("diff --cc c"));
        assert_eq!(chunks[2], "* Unmerged path u\n");
    }

    #[test]
    fn name_status_handles_renames_and_spaces() {
        let names = parse_name_status("M\0a b.txt\0R100\0old.md\0new.md\0").unwrap();

        assert_eq!(
            names[0],
            NameStatus {
                status: "M".into(),
                path: "a b.txt".into(),
                orig_path: None
            }
        );
        assert_eq!(names[1].path, "new.md");
        assert_eq!(names[1].orig_path.as_deref(), Some("old.md"));
        assert!(parse_name_status("R100\0only-one\0").is_err());
    }

    #[test]
    fn budget_defers_files_past_the_limit() {
        let file = |lines: usize| PathDiff {
            path: "f".into(),
            orig_path: None,
            status: "M".into(),
            diff: FileDiff {
                hunks: vec![Hunk {
                    header: "@@ -1 +1 @@".into(),
                    lines: vec![
                        DiffLine {
                            kind: LineKind::Added,
                            text: String::new(),
                            old_line: None,
                            new_line: None
                        };
                        lines
                    ],
                }],
                ..FileDiff::default()
            },
            deferred: false,
        };
        let mut diffs = vec![file(MAX_TOTAL_LINES - 5), file(3), file(10), file(1)];

        apply_budget(&mut diffs);

        let deferred: Vec<bool> = diffs.iter().map(|d| d.deferred).collect();
        assert_eq!(deferred, vec![false, false, true, true]);
        assert!(diffs[2].diff.hunks.is_empty());
    }

    #[test]
    fn empty_output_is_an_empty_diff() {
        assert_eq!(parse("").unwrap(), FileDiff::default());
    }
}
