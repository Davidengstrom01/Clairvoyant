import { invoke } from "@tauri-apps/api/core";
import type { RegisteredRepo, WorktreeSummary } from "./types";

export const listRepos = () => invoke<RegisteredRepo[]>("list_repos");

export const addRepo = (path: string) => invoke<RegisteredRepo>("add_repo", { path });

export const removeRepo = (path: string) => invoke<void>("remove_repo", { path });

export const repoOverview = (path: string) =>
  invoke<WorktreeSummary[]>("repo_overview", { path });
