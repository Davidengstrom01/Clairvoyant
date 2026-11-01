import { useCallback, useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { branches as loadBranches, deleteBranch } from "../../lib/api";
import { defaultFilter, filterBranches, type BranchFilter } from "../../lib/branches";
import { relativeTime } from "../../lib/format";
import { useGuard } from "../../lib/notify";
import type { Branch, RegisteredRepo } from "../../lib/types";
import { folderName } from "../../lib/worktree";
import { CreateWorktreeDialog } from "../dialogs/CreateWorktreeDialog";
import { NewBranchDialog } from "../dialogs/NewBranchDialog";
import { Button, Chip, inputClass } from "../ui";
import { ComparePanel } from "./ComparePanel";

interface Props {
  repos: RegisteredRepo[];
  repo: string;
  onRepoChange: (repo: string) => void;
  /** Bumped when the repo changed on disk. */
  version: number;
  onChanged: () => void;
  onOpenWorktree: (path: string) => void;
}

export function BranchesView({ repos, repo, onRepoChange, version, onChanged, onOpenWorktree }: Props) {
  const guard = useGuard();
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [filter, setFilter] = useState<BranchFilter>(defaultFilter);
  const [comparing, setComparing] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: "branch" } | { kind: "worktree"; branch: Branch } | null>(null);

  const reload = useCallback(() => {
    guard(() => loadBranches(repo)).then((b) => setBranches(b ?? []));
  }, [repo, guard]);

  useEffect(reload, [reload, version]);
  useEffect(() => setComparing(null), [repo]);

  const shown = filterBranches(branches ?? [], filter);
  const defaultName = branches?.find((b) => b.isDefault)?.name;

  async function remove(branch: Branch) {
    const ok = await ask(`Delete branch ${branch.name}?`, { title: "Delete branch", kind: "warning", okLabel: "Delete" });
    if (!ok) return;
    try {
      await deleteBranch(repo, branch.name, false);
    } catch (e) {
      // `git branch -d` refused: the branch has commits nothing else contains.
      const force = await ask(
        `${branch.name} has commits that aren't merged anywhere. Deleting it makes them hard to recover.\n\n${String(e)}\n\nDelete anyway?`,
        { title: "Branch not merged", kind: "warning", okLabel: "Force delete" },
      );
      if (!force) return;
      await guard(() => deleteBranch(repo, branch.name, true));
    }
    reload();
    onChanged();
  }

  const toggle = (key: "mergedOnly" | "notCheckedOut") => setFilter((f) => ({ ...f, [key]: !f[key] }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <select className={inputClass} value={repo} onChange={(e) => onRepoChange(e.target.value)}>
          {repos.map((r) => (
            <option key={r.path} value={r.path}>
              {folderName(r.path)}
            </option>
          ))}
        </select>
        {(["local", "remote", "all"] as const).map((scope) => (
          <Button
            key={scope}
            size="sm"
            variant={filter.scope === scope ? "secondary" : "ghost"}
            onClick={() => setFilter((f) => ({ ...f, scope }))}
          >
            {scope[0].toUpperCase() + scope.slice(1)}
          </Button>
        ))}
        <Button size="sm" variant={filter.mergedOnly ? "secondary" : "ghost"} onClick={() => toggle("mergedOnly")}>
          Merged into {defaultName ?? "default"}
        </Button>
        <Button size="sm" variant={filter.notCheckedOut ? "secondary" : "ghost"} onClick={() => toggle("notCheckedOut")}>
          Not checked out
        </Button>
        <input
          className={`${inputClass} w-48`}
          placeholder="Search"
          value={filter.query}
          onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
        />
        <Button size="sm" className="ml-auto" onClick={() => setDialog({ kind: "branch" })} disabled={!branches}>
          New branch
        </Button>
      </div>

      <div className={`min-h-0 overflow-y-auto ${comparing ? "max-h-[40%]" : "flex-1"}`}>
        {branches === null ? (
          <p className="p-4 text-sm text-zinc-500">Loading…</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-950">
              <tr>
                <th className="px-4 py-1.5 font-medium">Branch</th>
                <th className="px-2 font-medium">Worktree</th>
                <th className="px-2 font-medium" title={`Compared with ${defaultName}`}>
                  vs {defaultName ?? "default"}
                </th>
                <th className="px-2 font-medium">Last commit</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((b) => (
                <tr key={b.name} className="border-t border-zinc-100 dark:border-zinc-900">
                  <td className="px-4 py-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono">{b.name}</span>
                      {b.isDefault && <Chip>default</Chip>}
                      {b.merged && <Chip tone="green">merged</Chip>}
                      {b.upstreamGone && (
                        <Chip tone="orange" title={`${b.upstream} was deleted on the remote`}>
                          upstream gone
                        </Chip>
                      )}
                    </div>
                  </td>
                  <td className="px-2">
                    {b.worktree && (
                      <button className="text-xs text-sky-700 hover:underline dark:text-sky-400" onClick={() => onOpenWorktree(b.worktree!)}>
                        {folderName(b.worktree)}
                      </button>
                    )}
                  </td>
                  <td className="px-2 text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                    {b.vsDefault && !b.isDefault && `↑${b.vsDefault.ahead} ↓${b.vsDefault.behind}`}
                  </td>
                  <td className="max-w-md px-2">
                    <div className="flex gap-2 text-xs">
                      <span className="shrink-0 text-zinc-400">{relativeTime(b.lastCommitTime)}</span>
                      <span className="truncate" title={b.subject}>
                        {b.subject}
                      </span>
                    </div>
                  </td>
                  <td className="px-4">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setComparing(b.name)}>
                        Compare
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={b.worktree !== null || b.isDefault}
                        onClick={() => setDialog({ kind: "worktree", branch: b })}
                      >
                        Worktree
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={b.remote || b.worktree !== null || b.isDefault}
                        title={b.remote ? "Remote branches are deleted on the remote, not here" : undefined}
                        onClick={() => remove(b)}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {comparing && branches && (
        <ComparePanel repo={repo} head={comparing} branches={branches} onClose={() => setComparing(null)} />
      )}

      {dialog?.kind === "branch" && branches && (
        <NewBranchDialog repo={repo} branches={branches} onClose={() => setDialog(null)} onDone={reload} />
      )}
      {dialog?.kind === "worktree" && (
        <CreateWorktreeDialog
          repo={repo}
          branch={dialog.branch}
          onClose={() => setDialog(null)}
          onCreated={(path) => {
            onChanged();
            onOpenWorktree(path);
          }}
        />
      )}
    </div>
  );
}
