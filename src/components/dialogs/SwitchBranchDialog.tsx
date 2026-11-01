import { useEffect, useState } from "react";
import { branches as loadBranches, switchBranch } from "../../lib/api";
import { defaultFilter, filterBranches } from "../../lib/branches";
import { relativeTime } from "../../lib/format";
import { useGuard } from "../../lib/notify";
import type { Branch } from "../../lib/types";
import { Modal, inputClass } from "../ui";

/** Branches checked out in another worktree can't be switched to; git forbids it. */
export function SwitchBranchDialog({
  repo,
  worktree,
  onClose,
  onDone,
}: {
  repo: string;
  worktree: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const guard = useGuard();
  const [all, setAll] = useState<Branch[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    guard(() => loadBranches(repo)).then((b) => setAll(b ?? []));
  }, [repo, guard]);

  const choices = filterBranches(all ?? [], { ...defaultFilter, scope: "all", query }).filter(
    (b) => b.worktree !== worktree,
  );

  async function pick(branch: Branch) {
    const done = await guard(() => switchBranch(worktree, branch.name, branch.remote));
    if (done !== undefined) {
      onDone();
      onClose();
    }
  }

  return (
    <Modal title="Switch branch" onClose={onClose} wide>
      <input
        autoFocus
        placeholder="Filter branches"
        className={inputClass}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {all === null ? (
        <p className="text-zinc-500">Loading…</p>
      ) : (
        <ul className="-mx-4 flex flex-col">
          {choices.map((b) => (
            <li key={b.name}>
              <button
                disabled={b.worktree !== null}
                onClick={() => pick(b)}
                className="flex w-full items-center gap-3 px-4 py-1.5 text-left hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800"
                title={b.worktree ? `Checked out in ${b.worktree}` : b.subject}
              >
                <span className="font-mono">{b.name}</span>
                {b.remote && <span className="text-xs text-zinc-400">creates a local tracking branch</span>}
                <span className="ml-auto text-xs text-zinc-400">{relativeTime(b.lastCommitTime)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
