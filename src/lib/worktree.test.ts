import { describe, expect, it } from "vitest";
import type { FileChange, WorktreeStatus, WorktreeSummary } from "./types";
import { branchLabel, changeCounts, folderName, isClean, warnings } from "./worktree";

const file = (overrides: Partial<FileChange>): FileChange => ({
  path: "a.txt",
  origPath: null,
  kind: "tracked",
  staged: ".",
  unstaged: ".",
  ...overrides,
});

const status = (overrides: Partial<WorktreeStatus> = {}): WorktreeStatus => ({
  headOid: "0123456789abcdef",
  branch: "main",
  upstream: "origin/main",
  aheadBehind: { ahead: 0, behind: 0 },
  stashCount: 0,
  files: [],
  ...overrides,
});

const summary = (overrides: Partial<WorktreeSummary> = {}): WorktreeSummary => ({
  path: "/code/app",
  head: "0123456789abcdef",
  branch: "main",
  isMain: true,
  bare: false,
  detached: false,
  locked: null,
  prunable: null,
  status: status(),
  error: null,
  ...overrides,
});

describe("changeCounts", () => {
  it("counts each bucket like git status", () => {
    const counts = changeCounts([
      file({ staged: "A" }),
      file({ unstaged: "M" }),
      file({ staged: "M", unstaged: "M" }),
      file({ kind: "renamed", staged: "R" }),
      file({ kind: "untracked", unstaged: "?" }),
      file({ kind: "conflicted", staged: "U", unstaged: "U" }),
    ]);

    expect(counts).toEqual({ staged: 3, unstaged: 2, untracked: 1, conflicted: 1 });
  });
});

describe("branchLabel", () => {
  it("prefers the live status branch", () => {
    expect(branchLabel(summary({ branch: "stale", status: status({ branch: "fresh" }) }))).toBe(
      "fresh",
    );
  });

  it("shows a short sha when detached", () => {
    expect(branchLabel(summary({ branch: null, status: status({ branch: null }) }))).toBe(
      "detached @ 0123456",
    );
  });

  it("labels bare repos", () => {
    expect(branchLabel(summary({ bare: true, status: null }))).toBe("bare repository");
  });
});

describe("warnings", () => {
  it("is empty for a healthy tracked branch", () => {
    expect(warnings(summary())).toEqual([]);
  });

  it("distinguishes no upstream from a deleted upstream", () => {
    expect(warnings(summary({ status: status({ upstream: null, aheadBehind: null }) }))).toEqual([
      { label: "no upstream" },
    ]);
    expect(warnings(summary({ status: status({ aheadBehind: null }) }))).toEqual([
      { label: "upstream gone", detail: "origin/main" },
    ]);
  });

  it("does not nag about upstreams on a detached head", () => {
    expect(warnings(summary({ status: status({ branch: null, upstream: null }) }))).toEqual([]);
  });

  it("reports missing folders and locks", () => {
    expect(
      warnings(summary({ prunable: "gitdir file points to non-existent location", locked: "", status: null })),
    ).toEqual([
      { label: "folder missing", detail: "gitdir file points to non-existent location" },
      { label: "locked", detail: undefined },
    ]);
  });
});

describe("isClean", () => {
  it("needs a status to be clean", () => {
    expect(isClean(summary())).toBe(true);
    expect(isClean(summary({ status: null }))).toBe(false);
    expect(isClean(summary({ status: status({ files: [file({ unstaged: "M" })] }) }))).toBe(false);
  });
});

describe("folderName", () => {
  it("takes the last segment", () => {
    expect(folderName("/code/my app/")).toBe("my app");
  });
});
