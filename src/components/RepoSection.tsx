import type { RegisteredRepo, WorktreeSummary } from "../lib/types";
import { folderName } from "../lib/worktree";
import { WorktreeCard } from "./WorktreeCard";

export interface RepoOverview {
  loading: boolean;
  worktrees?: WorktreeSummary[];
  error?: string;
}

interface Props {
  repo: RegisteredRepo;
  overview: RepoOverview | undefined;
  onRemove: () => void;
}

export function RepoSection({ repo, overview, onRemove }: Props) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-baseline gap-3">
        <h2 className="text-lg font-semibold">{folderName(repo.path)}</h2>
        <span className="truncate text-xs text-zinc-500" title={repo.path}>
          {repo.path}
        </span>
        {overview?.loading && <span className="text-xs text-zinc-400">refreshing…</span>}
        <button
          onClick={onRemove}
          className="ml-auto text-xs text-zinc-500 hover:text-red-600"
          title="Stop showing this repo (nothing on disk is touched)"
        >
          Remove
        </button>
      </header>

      {overview?.error && <p className="text-sm text-red-600">{overview.error}</p>}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3">
        {overview?.worktrees?.map((summary) => (
          <WorktreeCard key={summary.path} summary={summary} />
        ))}
      </div>
    </section>
  );
}
