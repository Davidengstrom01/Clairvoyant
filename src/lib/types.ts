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
  error: string | null;
}

export interface RegisteredRepo {
  path: string;
  worktreeRoot?: string;
}
