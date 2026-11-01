import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { addRepo, fetchRepo, listRepos, removeRepo, repoOverview, worktreeSummary } from "./lib/api";
import { NotifyProvider, useGuard, useNotify } from "./lib/notify";
import type { RegisteredRepo, RepoChange } from "./lib/types";
import { folderName } from "./lib/worktree";
import { BranchesView } from "./components/branches/BranchesView";
import { WorktreeDetail } from "./components/detail/WorktreeDetail";
import { CreateWorktreeDialog } from "./components/dialogs/CreateWorktreeDialog";
import { ScanDialog } from "./components/dialogs/ScanDialog";
import { SettingsDialog } from "./components/dialogs/SettingsDialog";
import { RepoSection, type RepoState } from "./components/RepoSection";
import { Button } from "./components/ui";

type View =
  | { kind: "dashboard" }
  | { kind: "worktree"; repo: string; path: string }
  | { kind: "branches"; repo: string };

type Dialog = { kind: "settings" } | { kind: "scan"; root: string } | { kind: "worktree"; repo: string };

export default function App() {
  return (
    <NotifyProvider>
      <Shell />
    </NotifyProvider>
  );
}

/**
 * Runs at most one task per key at a time. A request that arrives while one is
 * running schedules a single rerun, so bursts of file events can't pile up.
 */
function useCoalesce() {
  const pending = useRef(new Map<string, boolean>());
  return useCallback((key: string, task: () => Promise<void>) => {
    if (pending.current.has(key)) {
      pending.current.set(key, true);
      return;
    }
    void (async () => {
      do {
        pending.current.set(key, false);
        await task();
      } while (pending.current.get(key));
      pending.current.delete(key);
    })();
  }, []);
}

function Shell() {
  const guard = useGuard();
  const notify = useNotify();
  const coalesce = useCoalesce();
  const [repos, setRepos] = useState<RegisteredRepo[]>([]);
  const [states, setStates] = useState<Record<string, RepoState>>({});
  // Bumped per repo and per worktree path whenever fresh data arrives.
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [view, setView] = useState<View>({ kind: "dashboard" });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const reposRef = useRef(repos);
  reposRef.current = repos;

  const patchState = useCallback(
    (repo: string, patch: (s: RepoState) => RepoState) =>
      setStates((all) => ({ ...all, [repo]: patch(all[repo] ?? { loading: false }) })),
    [],
  );

  const bump = useCallback(
    (keys: string[]) =>
      setVersions((v) => Object.fromEntries([...Object.entries(v), ...keys.map((k) => [k, (v[k] ?? 0) + 1])])),
    [],
  );

  const refreshRepo = useCallback(
    (repo: string) =>
      coalesce(repo, async () => {
        patchState(repo, (s) => ({ ...s, loading: true }));
        try {
          const overview = await repoOverview(repo);
          patchState(repo, (s) => ({ ...s, loading: false, overview, error: undefined }));
          bump([repo, ...overview.worktrees.map((w) => w.path)]);
        } catch (e) {
          patchState(repo, (s) => ({ ...s, loading: false, error: String(e) }));
        }
      }),
    [coalesce, patchState, bump],
  );

  const refreshWorktree = useCallback(
    (repo: string, path: string) =>
      coalesce(`${repo}\0${path}`, async () => {
        try {
          const summary = await worktreeSummary(repo, path);
          patchState(repo, (s) =>
            s.overview
              ? { ...s, overview: { ...s.overview, worktrees: s.overview.worktrees.map((w) => (w.path === path ? summary : w)) } }
              : s,
          );
          bump([path]);
        } catch {
          // The worktree may have just been removed; the repo view will tell.
          refreshRepo(repo);
        }
      }),
    [coalesce, patchState, bump, refreshRepo],
  );

  const refreshAll = useCallback(() => reposRef.current.forEach((r) => refreshRepo(r.path)), [refreshRepo]);

  useEffect(() => {
    listRepos().then(setRepos, (e) => notify({ message: String(e), tone: "error" }));
  }, [notify]);

  useEffect(refreshAll, [repos, refreshAll]);

  useEffect(() => {
    const unlisten = listen<RepoChange[]>("repo-changed", (e) => {
      for (const change of e.payload) {
        if (change.worktree) refreshWorktree(change.repo, change.worktree);
        else refreshRepo(change.repo);
      }
    });
    return () => void unlisten.then((stop) => stop());
  }, [refreshRepo, refreshWorktree]);

  // The watcher covers most changes; focus and ⌘R are the backstop.
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

  async function fetch(repo: string) {
    patchState(repo, (s) => ({ ...s, fetching: true }));
    const done = await guard(() => fetchRepo(repo));
    patchState(repo, (s) => ({ ...s, fetching: false }));
    if (done !== undefined) notify({ message: `Fetched ${folderName(repo)}`, tone: "info" });
    refreshRepo(repo);
  }

  async function handleAdd() {
    const picked = await open({ directory: true, title: "Add a git repository" });
    if (typeof picked !== "string") return;
    const repo = await guard(() => addRepo(picked));
    if (repo) setRepos((prev) => (prev.some((r) => r.path === repo.path) ? prev : [...prev, repo]));
  }

  async function handleScan() {
    const root = await open({ directory: true, title: "Scan a folder for repositories" });
    if (typeof root === "string") setDialog({ kind: "scan", root });
  }

  async function handleRemove(path: string) {
    const done = await guard(() => removeRepo(path));
    if (done === undefined) return;
    setRepos((prev) => prev.filter((r) => r.path !== path));
    setView({ kind: "dashboard" });
  }

  const reloadRepos = () => guard(listRepos).then((list) => list && setRepos(list));
  const openWorktree = (repo: string, path: string) => setView({ kind: "worktree", repo, path });

  const tab = (kind: "dashboard" | "branches", label: string) => (
    <Button
      size="sm"
      variant={view.kind === kind || (kind === "dashboard" && view.kind === "worktree") ? "secondary" : "ghost"}
      disabled={kind === "branches" && repos.length === 0}
      onClick={() => setView(kind === "branches" ? { kind, repo: repos[0].path } : { kind })}
    >
      {label}
    </Button>
  );

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <h1 className="mr-3 text-lg font-bold tracking-tight">Clairvoyant</h1>
        {tab("dashboard", "Worktrees")}
        {tab("branches", "Branches")}
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" onClick={refreshAll} title="⌘R">
            Refresh
          </Button>
          <Button size="sm" variant="ghost" onClick={() => repos.forEach((r) => void fetch(r.path))} disabled={repos.length === 0}>
            Fetch all
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "settings" })}>
            Settings
          </Button>
          <Button size="sm" onClick={handleScan}>
            Scan folder
          </Button>
          <Button size="sm" variant="primary" onClick={handleAdd}>
            Add repo
          </Button>
        </div>
      </header>

      {view.kind === "dashboard" && (
        <main className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-6">
          {repos.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No repos yet. Add one (or scan a folder) and every worktree it has will show up here.
            </p>
          ) : (
            repos.map((repo) => (
              <RepoSection
                key={repo.path}
                repo={repo}
                state={states[repo.path]}
                onOpenWorktree={(path) => openWorktree(repo.path, path)}
                onNewWorktree={() => setDialog({ kind: "worktree", repo: repo.path })}
                onFetch={() => fetch(repo.path)}
                onRemove={() => handleRemove(repo.path)}
              />
            ))
          )}
        </main>
      )}

      {view.kind === "worktree" &&
        (() => {
          const state = states[view.repo];
          const summary = state?.overview?.worktrees.find((w) => w.path === view.path);
          if (!summary) {
            return (
              <div className="flex flex-col items-start gap-3 p-6 text-sm text-zinc-500">
                {state?.loading ? "Loading…" : "This worktree no longer exists."}
                <Button onClick={() => setView({ kind: "dashboard" })}>Back to all worktrees</Button>
              </div>
            );
          }
          return (
            <WorktreeDetail
              key={view.path}
              repo={view.repo}
              summary={summary}
              version={versions[view.path] ?? 0}
              onBack={() => setView({ kind: "dashboard" })}
              onChanged={() => refreshRepo(view.repo)}
            />
          );
        })()}

      {view.kind === "branches" && (
        <BranchesView
          repos={repos}
          repo={view.repo}
          onRepoChange={(repo) => setView({ kind: "branches", repo })}
          version={versions[view.repo] ?? 0}
          onChanged={() => refreshRepo(view.repo)}
          onOpenWorktree={(path) => openWorktree(view.repo, path)}
        />
      )}

      {dialog?.kind === "settings" && (
        <SettingsDialog repos={repos} onClose={() => setDialog(null)} onSaved={reloadRepos} />
      )}
      {dialog?.kind === "scan" && (
        <ScanDialog root={dialog.root} onClose={() => setDialog(null)} onAdded={reloadRepos} />
      )}
      {dialog?.kind === "worktree" && (
        <CreateWorktreeDialog
          repo={dialog.repo}
          onClose={() => setDialog(null)}
          onCreated={(path) => {
            refreshRepo(dialog.repo);
            openWorktree(dialog.repo, path);
          }}
        />
      )}
    </div>
  );
}
