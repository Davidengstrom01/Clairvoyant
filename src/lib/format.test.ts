import { describe, expect, it } from "vitest";
import { plural, relativeTime } from "./format";

describe("relativeTime", () => {
  const now = 1_800_000_000_000;
  const ago = (seconds: number) => relativeTime(now / 1000 - seconds, now);

  it("steps through units", () => {
    expect(ago(10)).toBe("just now");
    expect(ago(5 * 60)).toBe("5 min ago");
    expect(ago(3 * 3600)).toBe("3 h ago");
    expect(ago(12 * 86400)).toBe("12 d ago");
  });

  it("treats clock skew into the future as now", () => {
    expect(ago(-30)).toBe("just now");
  });
});

describe("plural", () => {
  it("adds an s except for one", () => {
    expect(plural(1, "file")).toBe("1 file");
    expect(plural(3, "file")).toBe("3 files");
  });
});
