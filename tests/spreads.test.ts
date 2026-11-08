import { describe, expect, it } from "vitest";
import { computeSpreads, SpreadIndex } from "../src/content/reader/spreads";
import { FIT, spreadDisplay } from "../src/content/reader/zoom";

const none = () => false;
const show = (spreads: number[][]) => spreads.map((s) => s.join("-")).join(" ");

describe("computeSpreads", () => {
  it("keeps the cover alone and pairs the rest", () => {
    expect(show(computeSpreads(9, none, false, []))).toBe("1 2-3 4-5 6-7 8-9");
    expect(show(computeSpreads(8, none, false, []))).toBe("1 2-3 4-5 6-7 8");
  });

  it("pairs from the first page with the offset", () => {
    expect(show(computeSpreads(8, none, true, []))).toBe("1-2 3-4 5-6 7-8");
  });

  it("shows wide pages alone, restarting the pairing after them", () => {
    expect(show(computeSpreads(10, (p) => p === 5, false, []))).toBe("1 2-3 4 5 6-7 8-9 10");
  });

  it("flips the pairing from a re-pair point that starts a pair", () => {
    expect(show(computeSpreads(10, none, false, [6]))).toBe("1 2-3 4-5 6 7-8 9-10");
  });

  it("flips the pairing from a re-pair point that ends a pair", () => {
    expect(show(computeSpreads(10, none, false, [7]))).toBe("1 2-3 4-5 6 7-8 9-10");
    expect(show(computeSpreads(10, none, false, [5]))).toBe("1 2-3 4 5-6 7-8 9-10");
  });

  it("applies several re-pair points, each from its own page", () => {
    expect(show(computeSpreads(12, none, false, [4, 9]))).toBe("1 2-3 4 5-6 7-8 9 10-11 12");
  });

  it("handles tiny galleries", () => {
    expect(computeSpreads(0, none, false, [])).toEqual([]);
    expect(show(computeSpreads(1, none, false, []))).toBe("1");
    expect(show(computeSpreads(1, none, true, []))).toBe("1");
  });
});

describe("SpreadIndex", () => {
  const index = new SpreadIndex(computeSpreads(9, none, false, []), 9);

  it("finds a page's spread and its neighbours", () => {
    expect(index.of(3)).toEqual([2, 3]);
    expect(index.next(3)).toEqual([4, 5]);
    expect(index.prev(2)).toEqual([1]);
    expect(index.prev(1)).toBeNull();
    expect(index.next(9)).toBeNull();
  });
});

describe("spreadDisplay", () => {
  it("fits two pages side by side at a common height", () => {
    const sizes = spreadDisplay([{ width: 1000, height: 1400 }, { width: 500, height: 700 }], { width: 1400, height: 700 }, FIT);
    expect(sizes).toEqual([{ width: 500, height: 700 }, { width: 500, height: 700 }]);
  });

  it("is the same as a single page for one page", () => {
    expect(spreadDisplay([{ width: 1280, height: 1810 }], { width: 1000, height: 800 }, FIT)).toEqual([{ width: 566, height: 800 }]);
  });
});
