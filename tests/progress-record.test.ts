import { describe, expect, it } from "vitest";
import { emptyProgress, hasProgress, normalizeProgress } from "../src/shared/progress";

const gallery = { gid: 7654321, token: "abcdef0123", host: "exhentai.org", title: "Sample Gallery Title", pageCount: 219 };

describe("normalizeProgress", () => {
  it("keeps a valid record as it is", () => {
    const record = { ...emptyProgress(gallery), page: 34, furthest: 60, updatedAt: 1, repairPoints: [12, 40] };
    expect(normalizeProgress(record)).toEqual(record);
  });

  it("knows how far a record from before furthest was kept got: its page, or the end if finished", () => {
    expect(normalizeProgress({ ...gallery, page: 34 })).toMatchObject({ page: 34, furthest: 34 });
    expect(normalizeProgress({ ...gallery, page: 12, finished: true })).toMatchObject({ page: 12, furthest: 219 });
    expect(normalizeProgress({ ...gallery, page: 50, furthest: 20 })).toMatchObject({ furthest: 50 }); // never behind the page
    expect(normalizeProgress({ ...gallery, page: 5, furthest: 900 })).toMatchObject({ furthest: 219 });
  });

  it("rejects what isn't a record", () => {
    for (const value of [null, 3, "x", {}, { gid: "1", token: "a", host: "h" }, { gid: 0, token: "a", host: "h" }]) {
      expect(normalizeProgress(value)).toBeNull();
    }
  });

  it("repairs bad fields", () => {
    expect(normalizeProgress({ ...gallery, page: 500, finished: "yes", repairPoints: [40, 12, 12, -1, 2.5, "x"] })).toMatchObject({
      page: 219,
      finished: false,
      repairPoints: [12, 40],
      rtl: false,
    });
  });
});

describe("hasProgress", () => {
  it("is true once a page was read or the gallery was finished", () => {
    expect(hasProgress(null)).toBe(false);
    expect(hasProgress(emptyProgress(gallery))).toBe(false);
    expect(hasProgress({ ...emptyProgress(gallery), page: 1 })).toBe(true);
    expect(hasProgress({ ...emptyProgress(gallery), finished: true })).toBe(true);
  });
});
