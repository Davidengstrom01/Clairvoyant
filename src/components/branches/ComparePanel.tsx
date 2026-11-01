import { useEffect, useState } from "react";
import { compare, compareDiff } from "../../lib/api";
import { plural, relativeTime } from "../../lib/format";
import type { Branch, Comparison, FileDiff } from "../../lib/types";
import { DiffView } from "../DiffView";
import { FileTree, toggled } from "../FileTree";
import { Button, inputClass } from "../ui";

/** What a pull request from `head` into `base` would contain. Read-only. */
export function ComparePanel({
  repo,
  head,
  branches,
  onClose,
}: {
  repo: string;
  head: string;
  branches: Branch[];
  onClose: () => void;
}) {
  const [base, setBase] = useState(() => branches.find((b) => b.isDefault && b.name !== head)?.name ?? "");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    setComparison(null);
    setFile(null);
    if (!base) return;
    let current = true;
    compare(repo, base, head).then(
      (c) => current && (setComparison(c), setError(null)),
      (e) => current && setError(String(e)),
    );
    return () => {
      current = false;
    };
  }, [repo, base, head]);

  useEffect(() => {
    setDiff(null);
    if (!file) return;
    let current = true;
    compareDiff(repo, base, head, file).then(
      (d) => current && setDiff(d),
      (e) => current && setError(String(e)),
    );
    return () => {
      current = false;
    };
  }, [repo, base, head, file]);

  return (
    <div className="flex min-h-0 flex-col border-t border-zinc-200 dark:border-zinc-800">
      <header className="flex items-center gap-2 px-4 py-2 text-sm">
        <span className="font-mono font-semibold">{head}</span>
        <span className="text-zinc-500">compared with</span>
        <select className={inputClass} value={base} onChange={(e) => setBase(e.target.value)}>
          <option value="">Choose a base…</option>
          {branches
            .filter((b) => b.name !== head)
            .map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
        </select>
        {comparison && (
          <span className="text-zinc-500">
            {plural(comparison.commits.length, "commit")} ahead, {comparison.behind} behind ·{" "}
            {plural(comparison.files.length, "file")} changed
          </span>
        )}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>
          Close
        </Button>
      </header>
      {error && <p className="px-4 pb-2 text-sm text-red-600">{error}</p>}
      {comparison && (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(18rem,24rem)_1fr] border-t border-zinc-200 dark:border-zinc-800">
          <div className="min-h-0 overflow-y-auto border-r border-zinc-200 text-sm dark:border-zinc-800">
            <h4 className="px-3 pt-2 text-xs font-semibold text-zinc-500 uppercase">Commits</h4>
            <ul>
              {comparison.commits.map((c) => (
                <li key={c.sha} className="flex gap-2 px-3 py-1" title={c.sha}>
                  <span className="font-mono text-xs text-zinc-400">{c.sha.slice(0, 7)}</span>
                  <span className="min-w-0 flex-1 truncate">{c.subject}</span>
                  <span className="text-xs text-zinc-400">{relativeTime(c.time)}</span>
                </li>
              ))}
            </ul>
            <h4 className="px-3 pt-3 text-xs font-semibold text-zinc-500 uppercase">Files</h4>
            <FileTree
              items={comparison.files}
              collapsed={collapsed}
              onToggle={(folder) => setCollapsed((c) => toggled(c, folder))}
              renderFile={(f, name, indent) => (
                <li
                  key={f.path}
                  onClick={() => setFile(f.path)}
                  style={{ paddingLeft: indent }}
                  className={`flex cursor-pointer gap-2 py-0.5 pr-3 ${file === f.path ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-900"}`}
                >
                  <span className="w-3 shrink-0 text-center font-mono text-xs">{f.status}</span>
                  <span className="truncate" title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}>
                    {name}
                  </span>
                </li>
              )}
            />
          </div>
          <div className="min-h-0 overflow-y-auto">
            {diff && file ? <DiffView diff={diff} path={file} /> : <p className="p-4 text-sm text-zinc-500">Pick a file to see its diff.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
