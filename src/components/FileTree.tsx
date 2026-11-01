import type { ReactNode } from "react";
import { buildTree, type TreeFolder, type TreeNode } from "../lib/tree";

interface Props<T extends { path: string }> {
  items: T[];
  /** Folder paths that are folded; owned by the parent so it survives refreshes. */
  collapsed: Set<string>;
  onToggle: (folderPath: string) => void;
  /** Renders one file row; apply `indent` as left padding so rows line up with folders. */
  renderFile: (item: T, name: string, indent: number) => ReactNode;
  folderActions?: (folder: TreeFolder<T>) => ReactNode;
  /** Folders whose every file is viewed get a check. */
  isViewed?: (item: T) => boolean;
}

const indentFor = (depth: number) => 12 + depth * 14;

export function FileTree<T extends { path: string }>({
  items,
  collapsed,
  onToggle,
  renderFile,
  folderActions,
  isViewed,
}: Props<T>) {
  const render = (nodes: TreeNode<T>[], depth: number): ReactNode =>
    nodes.map((node) => {
      if (node.kind === "file") return renderFile(node.item, node.name, indentFor(depth));
      const open = !collapsed.has(node.path);
      const allViewed = isViewed !== undefined && node.items.every(isViewed);
      return (
        <li key={`dir:${node.path}`}>
          <div
            role="button"
            aria-expanded={open}
            onClick={() => onToggle(node.path)}
            style={{ paddingLeft: indentFor(depth) - 2 }}
            className="group flex cursor-pointer items-center gap-1 py-0.5 pr-3 text-sm text-zinc-600 select-none hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            <span className={`inline-block w-3 text-[10px] transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
            <span className="min-w-0 truncate font-medium" title={node.path}>
              {node.name}
            </span>
            <span className="text-xs text-zinc-400 tabular-nums">{node.items.length}</span>
            {allViewed && (
              <span className="text-xs text-emerald-600" title="All files viewed">
                ✓
              </span>
            )}
            {folderActions && (
              <span className="ml-auto flex gap-1 invisible group-hover:visible" onClick={(e) => e.stopPropagation()}>
                {folderActions(node)}
              </span>
            )}
          </div>
          {open && <ul>{render(node.children, depth + 1)}</ul>}
        </li>
      );
    });

  return <ul className="overflow-y-auto">{render(buildTree(items), 0)}</ul>;
}

/** Toggle helper for a `Set<string>` held in state. */
export function toggled(set: Set<string>, path: string): Set<string> {
  const next = new Set(set);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}
