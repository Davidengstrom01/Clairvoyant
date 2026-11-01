import type { Branch } from "./types";

export interface BranchFilter {
  scope: "local" | "remote" | "all";
  mergedOnly: boolean;
  notCheckedOut: boolean;
  query: string;
}

export const defaultFilter: BranchFilter = {
  scope: "local",
  mergedOnly: false,
  notCheckedOut: false,
  query: "",
};

/** Default branch first, then most recently committed. */
export function filterBranches(branches: Branch[], filter: BranchFilter): Branch[] {
  const query = filter.query.trim().toLowerCase();
  return branches
    .filter((b) => filter.scope === "all" || b.remote === (filter.scope === "remote"))
    .filter((b) => !filter.mergedOnly || b.merged)
    .filter((b) => !filter.notCheckedOut || (!b.remote && b.worktree === null))
    .filter((b) => !query || b.name.toLowerCase().includes(query))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.lastCommitTime - a.lastCommitTime);
}

/** `origin/feature/x` → `feature/x`, for the local branch a remote one becomes. */
export function localName(remoteBranch: string): string {
  const slash = remoteBranch.indexOf("/");
  return slash === -1 ? remoteBranch : remoteBranch.slice(slash + 1);
}

/**
 * The branch others merge into. Both `origin/main` and the local `main`
 * tracking it are marked default; the remote one is what ahead/behind and
 * "merged" are measured against, so prefer it.
 */
export function defaultBranch(branches: Branch[]): Branch | undefined {
  return branches.find((b) => b.isDefault && b.remote) ?? branches.find((b) => b.isDefault);
}
