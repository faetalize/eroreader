import { beforeEach, describe, expect, it } from "vitest";
import { ThumbStore, type ThumbPageData } from "../src/content/gallery/thumbStore";

const page = (thumbPage: number): ThumbPageData => ({
  thumbPage,
  thumbs: [{ page: thumbPage * 20 + 1, imgkey: "k", href: "https://e-hentai.org/s/k/1-1", filename: "a.jpg", sprite: null }],
});

beforeEach(() => sessionStorage.clear());

describe("ThumbStore", () => {
  it("keeps thumbnail pages in memory without storage", () => {
    const store = new ThumbStore(1, null);
    store.set(page(2));
    expect(store.get(2)).toEqual(page(2));
    expect(store.has(3)).toBe(false);
  });

  it("brings stored pages back after a reload", () => {
    new ThumbStore(1, sessionStorage).set(page(0));
    new ThumbStore(1, sessionStorage).set(page(4));
    const reloaded = new ThumbStore(1, sessionStorage);
    expect(reloaded.get(0)).toEqual(page(0));
    expect(reloaded.get(4)).toEqual(page(4));
    expect(new ThumbStore(2, sessionStorage).has(0)).toBe(false);
  });

  it("drops the least recently opened gallery past the cap", () => {
    for (const gid of [1, 2, 3]) new ThumbStore(gid, sessionStorage, 3).set(page(0));
    new ThumbStore(1, sessionStorage, 3); // reopening 1 makes 2 the oldest
    new ThumbStore(4, sessionStorage, 3).set(page(0));
    expect([1, 2, 3, 4].map((gid) => new ThumbStore(gid, sessionStorage, 99).has(0))).toEqual([true, false, true, true]);
  });

  it("evicts older galleries when storage is full, and keeps working in memory when that isn't enough", () => {
    new ThumbStore(1, sessionStorage).set(page(0));
    const full = {
      length: 0,
      key: () => null,
      getItem: (key: string) => sessionStorage.getItem(key),
      removeItem: (key: string) => sessionStorage.removeItem(key),
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
      clear: () => {},
    } satisfies Storage;
    const store = new ThumbStore(2, full);
    expect(() => store.set(page(0))).not.toThrow();
    expect(store.get(0)).toEqual(page(0));
  });

  it("ignores unreadable stored data", () => {
    sessionStorage.setItem("eroreader.thumbs.1.0", "{not json");
    expect(() => new ThumbStore(1, sessionStorage)).not.toThrow();
  });
});
