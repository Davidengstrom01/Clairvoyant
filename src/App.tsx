import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { addRepo, listRepos, removeRepo, repoOverview } from "./lib/api";
import type { RegisteredRepo } from "./lib/types";
import { RepoSection, type RepoOverview } from "./components/RepoSection";

export default function App() {
  const [repos, setRepos] = useState<RegisteredRepo[]>([]);
  const [overviews, setOverviews] = useState<Record<string, RepoOverview>>({});
  const [error, setError] = useState<string | null>(null);

  const refreshRepo = useCallback(async (path: string) => {
    setOverviews((prev) => ({ ...prev, [path]: { ...prev[path], loading: true } }));
    try {
      const worktrees = await repoOverview(path);
      setOverviews((prev) => ({ ...prev, [path]: { loading: false, worktrees } }));
    } catch (e) {
      setOverviews((prev) => ({ ...prev, [path]: { loading: false, error: String(e) } }));
    }
  }, []);

  const refreshAll = useCallback(
    () => repos.forEach((repo) => void refreshRepo(repo.path)),
    [repos, refreshRepo],
  );

  useEffect(() => {
    listRepos().then(setRepos, (e) => setError(String(e)));
  }, []);

  useEffect(refreshAll, [refreshAll]);

  // TODO: replace focus/⌘R-only freshness with per-worktree file watching (see docs/DESIGN.md).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "r") {
        e.preventDefault();
        refreshAll();
      }
    };
    window.addEventListener("focus", refreshAll);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("focus", refreshAll);
      window.removeEventListener("keydown", onKey);
    };
  }, [refreshAll]);

  async function handleAdd() {
    const picked = await open({ directory: true, title: "Add a git repository" });
    if (typeof picked !== "string") return;
    try {
      const repo = await addRepo(picked);
      setError(null);
      setRepos((prev) => (prev.some((r) => r.path === repo.path) ? prev : [...prev, repo]));
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleRemove(path: string) {
    await removeRepo(path);
    setRepos((prev) => prev.filter((r) => r.path !== path));
  }

  return (
    <main className="flex min-h-screen flex-col gap-6 p-6">
      <header className="flex items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight">Clairvoyant</h1>
        <button
          onClick={refreshAll}
          className="ml-auto rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
          title="Refresh (⌘R)"
        >
          Refresh
        </button>
        <button
          onClick={handleAdd}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Add repo
        </button>
      </header>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {repos.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No repos yet. Add one and every worktree it has will show up here.
        </p>
      ) : (
        repos.map((repo) => (
          <RepoSection
            key={repo.path}
            repo={repo}
            overview={overviews[repo.path]}
            onRemove={() => void handleRemove(repo.path)}
          />
        ))
      )}
    </main>
  );
}
