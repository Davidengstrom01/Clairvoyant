import { describe, expect, it } from "vitest";
import { highlightHunks, languageFor } from "./highlight";
import type { DiffLine, FileDiff } from "./types";

describe("languageFor", () => {
  it("maps extensions case-insensitively", () => {
    expect(languageFor("src/App.TSX")).toBe("tsx");
    expect(languageFor("Api/Program.cs")).toBe("csharp");
    expect(languageFor("Api/Api.csproj")).toBe("xml");
    expect(languageFor("src-tauri/src/lib.rs")).toBe("rust");
  });

  it("falls back to plain text", () => {
    expect(languageFor("Makefile")).toBeNull();
    expect(languageFor("notes.weird")).toBeNull();
    expect(languageFor(".gitignore")).toBeNull();
  });
});

const line = (kind: DiffLine["kind"], text: string): DiffLine => ({ kind, text, oldLine: null, newLine: null });

const diffOf = (...lines: DiffLine[]): FileDiff => ({
  header: [],
  hunks: [{ header: "@@ -1 +1 @@", lines }],
  binary: false,
  combined: false,
  truncated: false,
});

describe("highlightHunks", () => {
  it("returns tokens line for line with both theme colours", async () => {
    const diff = diffOf(
      line("removed", "const a = 1;"),
      line("added", 'const a = "two";\r'),
      line("noNewline", " No newline at end of file"),
    );

    const [hunk] = (await highlightHunks(diff, "a.ts"))!;

    expect(hunk).toHaveLength(3);
    expect(hunk[0]!.map((t) => t.content).join("")).toBe("const a = 1;");
    expect(hunk[1]!.map((t) => t.content).join("")).toBe('const a = "two";');
    expect(hunk[2]).toBeNull();
    const keyword = hunk[0]!.find((t) => t.content === "const")!;
    expect(keyword.light).toMatch(/^#/);
    expect(keyword.dark).toMatch(/^#/);
    expect(keyword.light).not.toBe(keyword.dark);
  });

  it("skips unknown, binary and conflicted files", async () => {
    const diff = diffOf(line("added", "x"));
    expect(await highlightHunks(diff, "Makefile")).toBeNull();
    expect(await highlightHunks({ ...diff, binary: true }, "a.ts")).toBeNull();
    expect(await highlightHunks({ ...diff, combined: true }, "a.ts")).toBeNull();
  });
});
