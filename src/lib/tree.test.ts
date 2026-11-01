import { describe, expect, it } from "vitest";
import { buildTree, folderPaths, type TreeFolder, type TreeNode } from "./tree";

const items = (...paths: string[]) => paths.map((path) => ({ path }));

/** Compact outline: folders as `name/ (count)`, files as names, children indented. */
function outline(nodes: TreeNode<{ path: string }>[], depth = 0): string[] {
  return nodes.flatMap((n) =>
    n.kind === "folder"
      ? [`${"  ".repeat(depth)}${n.name}/ (${n.items.length})`, ...outline(n.children, depth + 1)]
      : [`${"  ".repeat(depth)}${n.name}`],
  );
}

describe("buildTree", () => {
  it("lists folders before files, alphabetically", () => {
    expect(outline(buildTree(items("b.txt", "z/1.ts", "A.txt", "a/2.ts")))).toEqual([
      "a/ (1)",
      "  2.ts",
      "z/ (1)",
      "  1.ts",
      "A.txt",
      "b.txt",
    ]);
  });

  it("merges single-child folder chains", () => {
    const tree = buildTree(items("src/cart/api/get.ts", "src/cart/api/post.ts"));

    expect(outline(tree)).toEqual(["src/cart/api/ (2)", "  get.ts", "  post.ts"]);
    expect((tree[0] as TreeFolder<{ path: string }>).path).toBe("src/cart/api");
  });

  it("stops merging where a folder has files or several subfolders", () => {
    expect(outline(buildTree(items("src/a/x.ts", "src/b/y.ts", "src/root.ts")))).toEqual([
      "src/ (3)",
      "  a/ (1)",
      "    x.ts",
      "  b/ (1)",
      "    y.ts",
      "  root.ts",
    ]);
  });

  it("counts nested items and keeps the original objects", () => {
    const input = items("docs/a b/ré sumé.md", "docs/c.md");
    const [docs] = buildTree(input) as TreeFolder<{ path: string }>[];

    expect(docs.items).toHaveLength(2);
    expect(docs.items).toContain(input[0]);
    expect(folderPaths(buildTree(input))).toEqual(["docs", "docs/a b"]);
  });

  it("handles an empty list", () => {
    expect(buildTree([])).toEqual([]);
  });
});
