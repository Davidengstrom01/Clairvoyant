import { useEffect, useState } from "react";
import { listTrash, restoreTrash, stashApply, stashList, stashPop } from "../../lib/api";
import { plural, relativeTime } from "../../lib/format";
import { useGuard, useNotify } from "../../lib/notify";
import type { Stash, TrashEntry } from "../../lib/types";
import { Button } from "../ui";

interface Props {
  repo: string;
  worktree: string;
  version: number;
  onChanged: () => void;
}

/** Stashes are repo-wide; popping applies to this worktree. */
export function StashPanel({ repo, worktree, version, onChanged }: Props) {
  const guard = useGuard();
  const notify = useNotify();
  const [stashes, setStashes] = useState<Stash[]>([]);

  useEffect(() => {
    stashList(repo).then(setStashes, () => setStashes([]));
  }, [repo, version]);

  async function run(action: "pop" | "apply", stash: Stash) {
    const done = await guard(() => (action === "pop" ? stashPop : stashApply)(worktree, stash.index));
    if (done !== undefined) {
      notify({ message: `${action === "pop" ? "Popped" : "Applied"} stash@{${stash.index}}`, tone: "info" });
    }
    onChanged();
  }

  if (stashes.length === 0) return <p className="px-3 py-2 text-xs text-zinc-400">No stashes in this repo</p>;
  return (
    <ul className="overflow-y-auto">
      {stashes.map((stash) => (
        <li key={stash.index} className="flex items-center gap-2 px-3 py-1.5 text-sm">
          <span className="min-w-0 flex-1">
            <span className="block truncate" title={stash.message}>
              {stash.message}
            </span>
            <span className="text-xs text-zinc-400">
              stash@{"{"}
              {stash.index}
              {"}"} · {relativeTime(stash.time)}
            </span>
          </span>
          <Button size="sm" onClick={() => run("apply", stash)} title="Apply and keep the stash">
            Apply
          </Button>
          <Button size="sm" onClick={() => run("pop", stash)} title="Apply and drop the stash">
            Pop
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function TrashPanel({ repo, worktree, version, onChanged }: Props) {
  const guard = useGuard();
  const notify = useNotify();
  const [entries, setEntries] = useState<TrashEntry[]>([]);

  useEffect(() => {
    listTrash(repo, worktree).then(setEntries, () => setEntries([]));
  }, [repo, worktree, version]);

  async function restore(entry: TrashEntry) {
    const done = await guard(() => restoreTrash(worktree, entry.id));
    if (done !== undefined) notify({ message: `Restored ${plural(entry.paths.length, "file")}`, tone: "info" });
    onChanged();
  }

  if (entries.length === 0) {
    return <p className="px-3 py-2 text-xs text-zinc-400">Nothing discarded in the last 14 days</p>;
  }
  return (
    <ul className="overflow-y-auto">
      {entries.map((entry) => (
        <li key={entry.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
          <span className="min-w-0 flex-1">
            <span className="block truncate" title={entry.paths.join("\n")}>
              {entry.paths.join(", ")}
            </span>
            <span className="text-xs text-zinc-400">{relativeTime(entry.time)}</span>
          </span>
          <Button size="sm" onClick={() => restore(entry)} title="Put these files back as they were">
            Restore
          </Button>
        </li>
      ))}
    </ul>
  );
}
