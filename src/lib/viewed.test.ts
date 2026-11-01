import { describe, expect, it } from "vitest";
import type { FileDiff } from "./types";
import { fingerprint, loadStore, pruned, toggledMark } from "./viewed";

const diff = (text: string, header = ["diff --git a/f b/f", "index 111..222 100644"]): FileDiff => ({
  header,
  hunks: [{ header: "@@ -1 +1 @@", lines: [{ kind: "added", text, oldLine: null, newLine: 1 }] }],
  binary: false,
  combined: false,
  truncated: false,
});

describe("fingerprint", () => {
  it("is stable for the same diff and changes with any edit", () => {
    expect(fingerprint(diff("a"))).toBe(fingerprint(diff("a")));
    expect(fingerprint(diff("a"))).not.toBe(fingerprint(diff("b")));
    expect(fingerprint(diff("a"))).not.toBe(fingerprint(diff("a ")));
  });

  it("notices binary or deferred changes through the header's blob hashes", () => {
    const empty = (index: string): FileDiff => ({ ...diff(""), hunks: [], header: ["diff --git a/f b/f", index] });
    expect(fingerprint(empty("index 111..222"))).not.toBe(fingerprint(empty("index 111..333")));
  });
});

describe("marks", () => {
  it("toggles on and off", () => {
    const on = toggledMark({}, "a.ts", "x1");
    expect(on).toEqual({ "a.ts": "x1" });
    expect(toggledMark(on, "a.ts", "x1")).toEqual({});
  });

  it("re-marking after a change stores the new fingerprint", () => {
    expect(toggledMark({ "a.ts": "old" }, "a.ts", "new")).toEqual({ "a.ts": "new" });
  });

  it("prunes files that left the list or whose diff changed", () => {
    const prints = new Map([
      ["kept.ts", "same"],
      ["edited.ts", "after"],
    ]);
    expect(pruned({ "kept.ts": "same", "edited.ts": "before", "gone.ts": "x" }, prints)).toEqual({ "kept.ts": "same" });
  });

  it("loads nothing, without throwing, when storage is unavailable", () => {
    // Vitest runs in Node, where localStorage doesn't exist.
    expect(loadStore("any")).toEqual({});
  });
});
