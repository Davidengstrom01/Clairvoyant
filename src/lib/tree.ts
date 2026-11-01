export interface TreeFolder<T> {
  kind: "folder";
  /** Display name; compacted chains read like `src/cart/api`. */
  name: string;
  /** Full folder path; stable across refreshes, so it keys the collapsed state. */
  path: string;
  children: TreeNode<T>[];
  /** Every item anywhere below this folder. */
  items: T[];
}

export interface TreeFile<T> {
  kind: "file";
  name: string;
  item: T;
}

export type TreeNode<T> = TreeFolder<T> | TreeFile<T>;

interface Dir<T> {
  dirs: Map<string, Dir<T>>;
  files: T[];
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * Groups items by folder: folders first, then files, each alphabetical.
 * Folders holding nothing but one subfolder are merged into a single row,
 * like VS Code's compact folders.
 */
export function buildTree<T extends { path: string }>(items: T[]): TreeNode<T>[] {
  const root: Dir<T> = { dirs: new Map(), files: [] };
  for (const item of items) {
    let dir = root;
    for (const part of item.path.split("/").slice(0, -1)) {
      let next = dir.dirs.get(part);
      if (!next) dir.dirs.set(part, (next = { dirs: new Map(), files: [] }));
      dir = next;
    }
    dir.files.push(item);
  }
  return convert(root, "");
}

function convert<T extends { path: string }>(dir: Dir<T>, prefix: string): TreeNode<T>[] {
  const folders = [...dir.dirs.entries()]
    .sort(([a], [b]) => byName(a, b))
    .map(([name, sub]): TreeFolder<T> => {
      let label = name;
      let path = prefix ? `${prefix}/${name}` : name;
      let node = sub;
      while (node.files.length === 0 && node.dirs.size === 1) {
        const [[childName, child]] = node.dirs;
        label += `/${childName}`;
        path += `/${childName}`;
        node = child;
      }
      const children = convert(node, path);
      return { kind: "folder", name: label, path, children, items: collect(children) };
    });
  const files = [...dir.files]
    .sort((a, b) => byName(basename(a.path), basename(b.path)))
    .map((item): TreeFile<T> => ({ kind: "file", name: basename(item.path), item }));
  return [...folders, ...files];
}

function collect<T>(nodes: TreeNode<T>[]): T[] {
  return nodes.flatMap((n) => (n.kind === "folder" ? n.items : [n.item]));
}

export function folderPaths<T>(nodes: TreeNode<T>[]): string[] {
  return nodes.flatMap((n) => (n.kind === "folder" ? [n.path, ...folderPaths(n.children)] : []));
}

/** Items in the order the tree shows them, for lists that must scroll in step with it. */
export function flattenTree<T>(nodes: TreeNode<T>[]): T[] {
  return nodes.flatMap((n) => (n.kind === "folder" ? flattenTree(n.children) : [n.item]));
}
