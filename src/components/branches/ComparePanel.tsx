import { useEffect, useRef, useState } from "react";
import { compare, compareDiff, compareDiffs } from "../../lib/api";
import { plural, relativeTime } from "../../lib/format";
import type { Branch, Comparison, PathDiff } from "../../lib/types";
import { useViewed } from "../../lib/viewed";
import { letterColor } from "../detail/FileList";
import { DiffStack, stackKey, type DiffStackHandle } from "../DiffStack";
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
  const [diffs, setDiffs] = useState<PathDiff[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState<string | null>(null);
  const stack = useRef<DiffStackHandle>(null);
  const viewed = useViewed(`compare:${repo}:${base}...${head}`, diffs);

  useEffect(() => {
    setComparison(null);
    setDiffs(null);
    if (!base) return;
    let live = true;
    Promise.all([compare(repo, base, head), compareDiffs(repo, base, head)]).then(
      ([c, d]) => live && (setComparison(c), setDiffs(d), setError(null)),
      (e) => live && setError(String(e)),
    );
    return () => {
      live = false;
    };
  }, [repo, base, head]);

  const currentPath = current?.startsWith("files:") ? current.slice("files:".length) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-zinc-200 dark:border-zinc-800">
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
      {comparison && diffs && (
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
            <h4 className="px-3 pt-3 text-xs font-semibold text-zinc-500 uppercase">
              Files{viewed.count > 0 && ` · ${viewed.count} viewed`}
            </h4>
            <FileTree
              items={diffs}
              collapsed={collapsed}
              onToggle={(folder) => setCollapsed((c) => toggled(c, folder))}
              isViewed={(f) => viewed.isViewed(f.path)}
              renderFile={(f, name, indent) => {
                const isViewed = viewed.isViewed(f.path);
                return (
                  <li
                    key={f.path}
                    onClick={() => stack.current?.scrollTo(stackKey("files", f.path))}
                    style={{ paddingLeft: indent }}
                    className={`flex cursor-pointer items-center gap-2 py-0.5 pr-3 ${
                      currentPath === f.path ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-900"
                    }`}
                  >
                    <span className={`w-3 shrink-0 text-center font-mono text-xs ${letterColor[f.status] ?? ""}`}>
                      {f.status}
                    </span>
                    <span
                      className={`min-w-0 flex-1 truncate ${isViewed ? "text-zinc-400" : ""}`}
                      title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}
                    >
                      {name}
                    </span>
                    {isViewed && <span className="text-xs text-emerald-600">✓</span>}
                  </li>
                );
              }}
            />
          </div>
          <div className="flex min-h-0 flex-col">
            <DiffStack
              ref={stack}
              groups={[
                {
                  id: "files",
                  title: "Files",
                  files: diffs,
                  viewed,
                  loadDeferred: (d) => compareDiff(repo, base, head, d.path),
                },
              ]}
              onCurrent={setCurrent}
              empty={<p className="p-4 text-sm text-zinc-500">No file differences.</p>}
            />
          </div>
        </div>
      )}
    </div>
  );
}
