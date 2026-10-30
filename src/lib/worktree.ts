import type { FileChange, WorktreeSummary } from "./types";

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
