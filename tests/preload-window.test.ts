import { expect, it } from "vitest";
import { preloadOrder } from "../src/content/reader/preloadWindow";

it("puts the visible pages first, then ahead, then behind, within the gallery", () => {
  expect(preloadOrder([10], 100, 3, 1)).toEqual([10, 11, 12, 13, 9]);
  expect(preloadOrder([1], 100, 3, 1)).toEqual([1, 2, 3, 4]);
  expect(preloadOrder([99], 100, 3, 2)).toEqual([99, 100, 98, 97]);
  expect(preloadOrder([4, 5], 100, 2, 1)).toEqual([4, 5, 6, 7, 3]);
  expect(preloadOrder([1], 1, 3, 1)).toEqual([1]);
});
