import type { DiffSource, FileChange, Operation, WorktreeSummary } from "./types";

export interface ChangeCounts {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
}

/** A file staged and then edited again counts as both staged and unstaged, like `git status`. */
export function changeCounts(files: FileChange[]): ChangeCounts {
  const counts = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
  for (const file of files) {
    if (file.kind === "untracked") counts.untracked++;
    else if (file.kind === "conflicted") counts.conflicted++;
    else {
      if (file.staged !== ".") counts.staged++;
      if (file.unstaged !== ".") counts.unstaged++;
    }
  }
  return counts;
}

export type FileList = "staged" | "unstaged";

/** The two lists of the detail view. A partly staged file appears in both. */
export function splitFiles(files: FileChange[]): Record<FileList, FileChange[]> {
  const staged: FileChange[] = [];
  const unstaged: FileChange[] = [];
  for (const file of files) {
    const tracked = file.kind === "tracked" || file.kind === "renamed";
    if (tracked && file.staged !== ".") staged.push(file);
    if (!tracked || file.unstaged !== ".") unstaged.push(file);
  }
  return { staged, unstaged };
}

export function diffSource(file: FileChange, list: FileList): DiffSource {
  if (list === "staged") return "staged";
  return file.kind === "untracked" ? "untracked" : "unstaged";
}

/** Paths git needs to unstage a file; a staged rename needs both sides. */
export function unstagePaths(files: FileChange[]): string[] {
  return files.flatMap((f) => (f.kind === "renamed" && f.origPath ? [f.origPath, f.path] : [f.path]));
}

/** Conflicted files are resolved in the editor, never discarded from here. */
export function discardTargets(files: FileChange[]): { tracked: string[]; untracked: string[] } {
  return {
    tracked: files.filter((f) => f.kind === "tracked" || f.kind === "renamed").map((f) => f.path),
    untracked: files.filter((f) => f.kind === "untracked").map((f) => f.path),
  };
}

/** One letter for a file row, preferring the side being shown. */
export function statusLetter(file: FileChange, list: FileList): string {
  if (file.kind === "untracked") return "U";
  if (file.kind === "conflicted") return "!";
  return list === "staged" ? file.staged : file.unstaged;
}

export function isClean(summary: WorktreeSummary): boolean {
  return summary.status !== null && summary.status.files.length === 0;
}

export function branchLabel(summary: WorktreeSummary): string {
  if (summary.bare) return "bare repository";
  const branch = summary.status?.branch ?? summary.branch;
  if (branch) return branch;
  const head = summary.status?.headOid ?? summary.head;
  return head ? `detached @ ${head.slice(0, 7)}` : "detached";
}

export const operationLabel: Record<Operation, string> = {
  rebase: "rebase in progress",
  merge: "merge in progress",
  cherryPick: "cherry-pick in progress",
  revert: "revert in progress",
};

export interface Warning {
  label: string;
  detail?: string;
}

export function warnings(summary: WorktreeSummary): Warning[] {
  const result: Warning[] = [];
  if (summary.prunable !== null) {
    result.push({ label: "folder missing", detail: summary.prunable || undefined });
  }
  if (summary.locked !== null) {
    result.push({ label: "locked", detail: summary.locked || undefined });
  }
  const status = summary.status;
  if (status?.branch) {
    if (status.upstream === null) result.push({ label: "no upstream" });
    else if (status.aheadBehind === null) {
      result.push({ label: "upstream gone", detail: status.upstream });
    }
  }
  return result;
}

/** Last path segment, for compact labels. */
export function folderName(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() || path;
}
