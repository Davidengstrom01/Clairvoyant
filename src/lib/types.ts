// Mirrors the serde types in src-tauri. Keep in sync by hand for now.

export type ChangeKind = "tracked" | "renamed" | "conflicted" | "untracked";

export interface FileChange {
  path: string;
  origPath: string | null;
  kind: ChangeKind;
  /** Git's index (X) status letter; "." when nothing is staged. */
  staged: string;
  /** Git's worktree (Y) status letter; "." when nothing is unstaged. */
  unstaged: string;
}

export interface AheadBehind {
  ahead: number;
  behind: number;
}

export interface WorktreeStatus {
  headOid: string | null;
  branch: string | null;
  upstream: string | null;
  aheadBehind: AheadBehind | null;
  stashCount: number;
  files: FileChange[];
}

export type Operation = "rebase" | "merge" | "cherryPick" | "revert";

export interface WorktreeSummary {
  path: string;
  head: string | null;
  branch: string | null;
  isMain: boolean;
  bare: boolean;
  detached: boolean;
  locked: string | null;
  prunable: string | null;
  status: WorktreeStatus | null;
  operation: Operation | null;
  /** Unix seconds. */
  lastActivity: number | null;
  error: string | null;
}

export interface RepoOverview {
  worktrees: WorktreeSummary[];
  /** Unix seconds. */
  lastFetch: number | null;
  defaultBranch: string | null;
}

export interface RegisteredRepo {
  path: string;
  worktreeRoot?: string;
}

export interface Settings {
  editorCommand: string;
  claudeCommand: string;
}

export type DiffSource = "unstaged" | "staged" | "untracked";
export type LineKind = "context" | "added" | "removed" | "noNewline";

export interface DiffLine {
  kind: LineKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface Hunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  header: string[];
  hunks: Hunk[];
  binary: boolean;
  combined: boolean;
  truncated: boolean;
}

export type HunkAction = "stage" | "unstage" | "discard";

export interface TrashEntry {
  id: string;
  time: number;
  worktree: string;
  paths: string[];
}

export interface Stash {
  index: number;
  time: number;
  message: string;
}

export interface Branch {
  name: string;
  remote: boolean;
  head: string;
  upstream: string | null;
  upstreamGone: boolean;
  worktree: string | null;
  lastCommitTime: number;
  subject: string;
  isDefault: boolean;
  vsDefault: AheadBehind | null;
  merged: boolean;
}

export interface CommitInfo {
  sha: string;
  time: number;
  subject: string;
}

export interface ComparedFile {
  status: string;
  path: string;
  origPath: string | null;
}

export interface Comparison {
  commits: CommitInfo[];
  behind: number;
  files: ComparedFile[];
}

/** Payload of the `repo-changed` event; `worktree: null` means repo-wide. */
export interface RepoChange {
  repo: string;
  worktree: string | null;
}

/** Payload of the `commit-output` event. */
export interface CommitOutput {
  worktree: string;
  line: string;
}
