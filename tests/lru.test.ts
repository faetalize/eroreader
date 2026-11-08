import { expect, it } from "vitest";
import { Lru } from "../src/shared/lru";

it("drops the least recently used entry past the cap", () => {
  const lru = new Lru<number, string>(2);
  lru.set(1, "a");
  lru.set(2, "b");
  lru.get(1);
  lru.set(3, "c");
  expect([lru.has(1), lru.has(2), lru.has(3), lru.size]).toEqual([true, false, true, 2]);
});
