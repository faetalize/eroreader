import { describe, expect, it } from "vitest";
import { pageAt, stripLayout } from "../src/content/reader/stripLayout";

describe("stripLayout", () => {
  const layout = stripLayout(
    [
      { width: 500, height: 700 },
      { width: 800, height: 400 },
      { width: 500, height: 700 },
    ],
    4,
  );

  it("stacks pages with a gap", () => {
    expect(layout.tops).toEqual([0, 704, 1108]);
    expect(layout.total).toBe(1808);
  });

  it("finds the page at a height", () => {
    expect([0, 699, 702, 704, 1107, 1108, 5000, -10].map((y) => pageAt(layout, y))).toEqual([1, 1, 1, 2, 2, 3, 3, 1]);
  });
});
