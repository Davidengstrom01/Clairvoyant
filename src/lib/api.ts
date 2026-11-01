import { invoke } from "@tauri-apps/api/core";
import type {
  Branch,
  Comparison,
  DiffSource,
  FileDiff,
  HunkAction,
  RegisteredRepo,
  RepoOverview,
  Settings,
  Stash,
  TrashEntry,
  WorktreeSummary,
} from "./types";

// Repos and settings
export const listRepos = () => invoke<RegisteredRepo[]>("list_repos");
export const addRepo = (path: string) => invoke<RegisteredRepo>("add_repo", { path });
export const removeRepo = (path: string) => invoke<void>("remove_repo", { path });
export const setWorktreeRoot = (repo: string, root: string | null) =>
  invoke<void>("set_worktree_root", { repo, root });
export const scanFolder = (root: string) => invoke<string[]>("scan_folder", { root });
export const getSettings = () => invoke<Settings>("get_settings");
export const setSettings = (settings: Settings) => invoke<void>("set_settings", { settings });

// Dashboard
export const repoOverview = (path: string) => invoke<RepoOverview>("repo_overview", { path });
export const worktreeSummary = (repo: string, path: string) =>
  invoke<WorktreeSummary>("worktree_summary", { repo, path });
export const fetchRepo = (repo: string) => invoke<void>("fetch", { repo });

// Pending changes
export const fileDiff = (worktree: string, path: string, origPath: string | null, source: DiffSource) =>
  invoke<FileDiff>("file_diff", { worktree, path, origPath, source });
export const stage = (worktree: string, paths: string[]) => invoke<void>("stage", { worktree, paths });
export const unstage = (worktree: string, paths: string[]) =>
  invoke<void>("unstage", { worktree, paths });
/** Resolves to the trash id that undoes it. */
export const discard = (worktree: string, tracked: string[], untracked: string[]) =>
  invoke<string>("discard", { worktree, tracked, untracked });
export const applyHunk = (worktree: string, path: string, hunkHeader: string, action: HunkAction) =>
  invoke<string | null>("apply_hunk", { worktree, path, hunkHeader, action });
export const listTrash = (repo: string, worktree: string) =>
  invoke<TrashEntry[]>("list_trash", { repo, worktree });
export const restoreTrash = (worktree: string, id: string) =>
  invoke<void>("restore_trash", { worktree, id });

// Stash and commit
export const stashList = (repo: string) => invoke<Stash[]>("stash_list", { repo });
export const stashPush = (worktree: string, message: string | null, includeUntracked: boolean) =>
  invoke<void>("stash_push", { worktree, message, includeUntracked });
export const stashPop = (worktree: string, index: number) =>
  invoke<void>("stash_pop", { worktree, index });
export const stashApply = (worktree: string, index: number) =>
  invoke<void>("stash_apply", { worktree, index });
export const headIsPublished = (worktree: string) =>
  invoke<boolean>("head_is_published", { worktree });
export const commit = (worktree: string, message: string, amend: boolean) =>
  invoke<string>("commit", { worktree, message, amend });

// Branches
export const branches = (repo: string) => invoke<Branch[]>("branches", { repo });
export const createBranch = (repo: string, name: string, start: string | null) =>
  invoke<void>("create_branch", { repo, name, start });
export const deleteBranch = (repo: string, name: string, force: boolean) =>
  invoke<void>("delete_branch", { repo, name, force });
export const switchBranch = (worktree: string, name: string, remote: boolean) =>
  invoke<void>("switch_branch", { worktree, name, remote });
export const compare = (repo: string, base: string, head: string) =>
  invoke<Comparison>("compare", { repo, base, head });
export const compareDiff = (repo: string, base: string, head: string, path: string) =>
  invoke<FileDiff>("compare_diff", { repo, base, head, path });

// Worktrees
export const suggestWorktreePath = (repo: string, branch: string) =>
  invoke<string>("suggest_worktree_path", { repo, branch });
export const addWorktree = (
  repo: string,
  path: string,
  branch: string,
  newBranch: boolean,
  start: string | null,
) => invoke<void>("add_worktree", { repo, path, branch, newBranch, start });
export const removeWorktree = (repo: string, path: string, force: boolean) =>
  invoke<void>("remove_worktree", { repo, path, force });

// Jump-outs
export const openInEditor = (path: string) => invoke<void>("open_in_editor", { path });
export const openClaude = (path: string) => invoke<void>("open_claude", { path });
