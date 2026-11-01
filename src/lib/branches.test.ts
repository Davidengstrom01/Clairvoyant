import { describe, expect, it } from "vitest";
import { defaultFilter, filterBranches, localName } from "./branches";
import type { Branch } from "./types";

const branch = (overrides: Partial<Branch>): Branch => ({
  name: "b",
  remote: false,
  head: "abc",
  upstream: null,
  upstreamGone: false,
  worktree: null,
  lastCommitTime: 0,
  subject: "",
  isDefault: false,
  vsDefault: null,
  merged: false,
  ...overrides,
});

describe("filterBranches", () => {
  const all = [
    branch({ name: "old", lastCommitTime: 1, merged: true }),
    branch({ name: "main", lastCommitTime: 2, isDefault: true, worktree: "/code/app" }),
    branch({ name: "recent", lastCommitTime: 3 }),
    branch({ name: "origin/recent", remote: true, lastCommitTime: 3 }),
  ];
  const names = (f: Partial<typeof defaultFilter>) =>
    filterBranches(all, { ...defaultFilter, ...f }).map((b) => b.name);

  it("shows local branches, default first, then newest", () => {
    expect(names({})).toEqual(["main", "recent", "old"]);
  });

  it("finds cleanup candidates", () => {
    expect(names({ mergedOnly: true })).toEqual(["old"]);
    expect(names({ notCheckedOut: true })).toEqual(["recent", "old"]);
  });

  it("scopes and searches", () => {
    expect(names({ scope: "remote" })).toEqual(["origin/recent"]);
    expect(names({ scope: "all", query: "REC" })).toEqual(["recent", "origin/recent"]);
  });
});

describe("localName", () => {
  it("drops the remote", () => {
    expect(localName("origin/feature/x")).toBe("feature/x");
    expect(localName("main")).toBe("main");
  });
});
