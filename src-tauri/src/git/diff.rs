use std::path::Path;

use serde::{Deserialize, Serialize};

use super::{LITERAL, Opts, exec};
use crate::error::{Error, Result};

/// Beyond this many lines a diff is cut short; the UI says so.
const MAX_LINES: usize = 10_000;

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
    fn empty_output_is_an_empty_diff() {
        assert_eq!(parse("").unwrap(), FileDiff::default());
    }
}
