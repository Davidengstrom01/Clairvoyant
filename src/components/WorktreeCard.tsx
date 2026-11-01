import type { WorktreeSummary } from "../lib/types";
import { relativeTime } from "../lib/format";
import { branchLabel, changeCounts, folderName, isClean, operationLabel, warnings } from "../lib/worktree";
import { JumpOuts } from "./JumpOuts";
import { Chip } from "./ui";

export function WorktreeCard({ summary, onOpen }: { summary: WorktreeSummary; onOpen?: () => void }) {
  const status = summary.status;
  const counts = status ? changeCounts(status.files) : null;
  const clean = isClean(summary);
  const openable = Boolean(onOpen && status);

  return (
    <article
      onClick={openable ? onOpen : undefined}
      className={`flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${
        openable ? "cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-600" : ""
      }`}
    >
      <header className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-mono text-sm font-semibold" title={branchLabel(summary)}>
            {branchLabel(summary)}
          </h3>
          {summary.isMain && <Chip>main worktree</Chip>}
        </div>
        <p className="flex gap-2 text-xs text-zinc-500">
          <span className="truncate" title={summary.path}>
            {folderName(summary.path)}
          </span>
          {summary.lastActivity !== null && (
            <span className="ml-auto shrink-0" title="Latest commit, stage or file edit">
              {relativeTime(summary.lastActivity)}
            </span>
          )}
        </p>
      </header>

      {summary.operation && (
        <div>
          <Chip tone="violet">{operationLabel[summary.operation]}</Chip>
        </div>
      )}

      {counts && (
        <div className="flex flex-wrap gap-1.5">
          {clean && <Chip>clean</Chip>}
          {counts.conflicted > 0 && <Chip tone="red">{counts.conflicted} conflicted</Chip>}
          {counts.staged > 0 && <Chip tone="green">{counts.staged} staged</Chip>}
          {counts.unstaged > 0 && <Chip tone="amber">{counts.unstaged} unstaged</Chip>}
          {counts.untracked > 0 && <Chip tone="sky">{counts.untracked} untracked</Chip>}
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
            <span title="Stashes are shared by every worktree of the repo">
              {status.stashCount} stash{status.stashCount === 1 ? "" : "es"} in repo
            </span>
          )}
        </div>
      )}

      {warnings(summary).length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {warnings(summary).map((w) => (
            <li key={w.label}>
              <Chip tone="orange" title={w.detail}>
                {w.label}
              </Chip>
            </li>
          ))}
        </ul>
      )}

      {summary.error && <p className="text-xs break-words text-red-600">{summary.error}</p>}

      {status && (
        <footer className="-mx-2 -mb-2 border-t border-zinc-100 pt-1 dark:border-zinc-800">
          <JumpOuts path={summary.path} />
        </footer>
      )}
    </article>
  );
}
