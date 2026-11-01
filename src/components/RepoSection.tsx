import { ask } from "@tauri-apps/plugin-dialog";
import { removeWorktree } from "../lib/api";
import { relativeTime } from "../lib/format";
import { useGuard } from "../lib/notify";
import type { RegisteredRepo, RepoOverview } from "../lib/types";
import { folderName } from "../lib/worktree";
import { Button } from "./ui";
import { WorktreeCard } from "./WorktreeCard";

export interface RepoState {
  loading: boolean;
  fetching?: boolean;
  overview?: RepoOverview;
  error?: string;
}

interface Props {
  repo: RegisteredRepo;
  state: RepoState | undefined;
  onOpenWorktree: (path: string) => void;
  onNewWorktree: () => void;
  onFetch: () => void;
  onRemove: () => void;
}

export function RepoSection({ repo, state, onOpenWorktree, onNewWorktree, onFetch, onRemove }: Props) {
  const guard = useGuard();
  const overview = state?.overview;
  const missing = overview?.worktrees.filter((w) => w.prunable !== null) ?? [];

  async function pruneMissing() {
    for (const wt of missing) {
      await guard(() => removeWorktree(repo.path, wt.path, false));
    }
  }

  async function confirmRemove() {
    const ok = await ask(`Stop showing ${folderName(repo.path)}? Nothing on disk is touched.`, {
      title: "Remove repo",
      kind: "warning",
    });
    if (ok) onRemove();
  }

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">{folderName(repo.path)}</h2>
        <span className="truncate text-xs text-zinc-500" title={repo.path}>
          {repo.path}
        </span>
        {state?.loading && <span className="text-xs text-zinc-400">refreshing…</span>}
        <div className="ml-auto flex items-center gap-1">
          <span className="text-xs text-zinc-500" title="Ahead/behind counts are only as fresh as the last fetch">
            {overview?.lastFetch ? `fetched ${relativeTime(overview.lastFetch)}` : "never fetched"}
          </span>
          <Button size="sm" variant="ghost" onClick={onFetch} disabled={state?.fetching}>
            {state?.fetching ? "Fetching…" : "Fetch"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onNewWorktree}>
            New worktree
          </Button>
          {missing.length > 0 && (
            <Button size="sm" variant="ghost" onClick={pruneMissing} title="Forget worktrees whose folder was deleted">
              Prune {missing.length} missing
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={confirmRemove}>
            Remove
          </Button>
        </div>
      </header>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-3">
        {overview?.worktrees.map((summary) => (
          <WorktreeCard key={summary.path} summary={summary} onOpen={() => onOpenWorktree(summary.path)} />
        ))}
      </div>
    </section>
  );
}
