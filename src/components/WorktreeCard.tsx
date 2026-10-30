import type { WorktreeSummary } from "../lib/types";
import { branchLabel, changeCounts, folderName, isClean, warnings } from "../lib/worktree";

const chip = "rounded px-1.5 py-0.5 text-xs font-medium tabular-nums";

export function WorktreeCard({ summary }: { summary: WorktreeSummary }) {
  const status = summary.status;
  const counts = status ? changeCounts(status.files) : null;
  const clean = isClean(summary);

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <header className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-mono text-sm font-semibold" title={branchLabel(summary)}>
            {branchLabel(summary)}
          </h3>
          {summary.isMain && (
            <span className={`${chip} bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300`}>
              main worktree
            </span>
          )}
        </div>
        <p className="truncate text-xs text-zinc-500" title={summary.path}>
          {folderName(summary.path)}
        </p>
      </header>

      {counts && (
        <div className="flex flex-wrap gap-1.5">
          {clean && (
            <span className={`${chip} bg-zinc-100 text-zinc-500 dark:bg-zinc-800`}>clean</span>
          )}
          {counts.conflicted > 0 && (
            <span className={`${chip} bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300`}>
              {counts.conflicted} conflicted
            </span>
          )}
          {counts.staged > 0 && (
            <span className={`${chip} bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300`}>
              {counts.staged} staged
            </span>
          )}
          {counts.unstaged > 0 && (
            <span className={`${chip} bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300`}>
              {counts.unstaged} unstaged
            </span>
          )}
          {counts.untracked > 0 && (
            <span className={`${chip} bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300`}>
              {counts.untracked} untracked
            </span>
          )}
        </div>
      )}

      {status && (status.aheadBehind || status.stashCount > 0) && (
        <div className="flex flex-wrap gap-3 text-xs text-zinc-600 dark:text-zinc-400">
          {status.aheadBehind && (
            <span className="tabular-nums" title={`compared with ${status.upstream}`}>
              ↑{status.aheadBehind.ahead} ↓{status.aheadBehind.behind} {status.upstream}
            </span>
          )}
          {status.stashCount > 0 && (
            <span>
              {status.stashCount} stash{status.stashCount === 1 ? "" : "es"}
            </span>
          )}
        </div>
      )}

      {warnings(summary).length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {warnings(summary).map((w) => (
            <li
              key={w.label}
              title={w.detail}
              className={`${chip} border border-orange-300 text-orange-700 dark:border-orange-800 dark:text-orange-300`}
            >
              {w.label}
            </li>
          ))}
        </ul>
      )}

      {summary.error && <p className="text-xs break-words text-red-600">{summary.error}</p>}
    </article>
  );
}
