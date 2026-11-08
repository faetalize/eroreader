import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parsePageHash, ReaderHistory, REPLACE_THROTTLE_MS, withPageHash } from "../src/content/reader/history";
import { fakeHistory } from "./reader-fakes";

const GALLERY = "https://e-hentai.org/g/1/abc/?p=2";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("parsePageHash", () => {
  it("reads #page=N only", () => {
    expect(parsePageHash("#page=34")).toBe(34);
    expect(["", "#page=0", "#page=x", "#pages=3", "#page=3&x"].map(parsePageHash)).toEqual([null, null, null, null, null]);
  });
});

describe("withPageHash", () => {
  it("sets or clears the hash and keeps the rest", () => {
    expect(withPageHash(new URL(GALLERY), 5).href).toBe(`${GALLERY}#page=5`);
    expect(withPageHash(new URL(`${GALLERY}#page=5`), null).href).toBe(GALLERY);
  });
});

describe("ReaderHistory", () => {
  it("pushes exactly one entry, and page changes replace it", () => {
    const h = fakeHistory(GALLERY);
    const reader = new ReaderHistory(h.history, h.url);
    reader.opened(3, true);
    reader.pageChanged(4);
    vi.advanceTimersByTime(REPLACE_THROTTLE_MS);
    reader.pageChanged(5);
    vi.advanceTimersByTime(REPLACE_THROTTLE_MS);
    expect(h.entries.map((e) => e.url)).toEqual([GALLERY, `${GALLERY}#page=5`]);
    expect(h.calls).toEqual([`push ${GALLERY}#page=3`, `replace ${GALLERY}#page=4`, `replace ${GALLERY}#page=5`]);
  });

  it("writes a burst of page changes once", () => {
    const h = fakeHistory(GALLERY);
    const reader = new ReaderHistory(h.history, h.url);
    reader.opened(1, true);
    for (let page = 2; page <= 30; page++) reader.pageChanged(page);
    vi.advanceTimersByTime(REPLACE_THROTTLE_MS);
    expect(h.calls).toEqual([`push ${GALLERY}#page=1`, `replace ${GALLERY}#page=30`]);
  });

  it("steps back to the gallery's entry when it pushed the reader's", () => {
    const h = fakeHistory(GALLERY);
    const reader = new ReaderHistory(h.history, h.url);
    reader.opened(3, true);
    expect(reader.leave()).toBe("back");
    expect(h.url().href).toBe(GALLERY);
  });

  it("removes the hash instead when the reader opened from a pasted link", () => {
    const h = fakeHistory(`${GALLERY}#page=3`);
    const reader = new ReaderHistory(h.history, h.url);
    reader.opened(3, false);
    expect(reader.leave()).toBe("replaced");
    expect(h.entries.map((e) => e.url)).toEqual([GALLERY]);
  });

  it("still steps back after a refresh, since the entry keeps its state", () => {
    const h = fakeHistory(GALLERY);
    new ReaderHistory(h.history, h.url).opened(3, true);
    const afterRefresh = new ReaderHistory(h.history, h.url);
    afterRefresh.opened(3, false);
    expect(afterRefresh.leave()).toBe("back");
  });

  it("never writes a pending page change after Back closed the reader", () => {
    const h = fakeHistory(GALLERY);
    const reader = new ReaderHistory(h.history, h.url);
    reader.opened(3, true);
    reader.pageChanged(4);
    h.history.back(); // the user pressed Back
    reader.cancel();
    vi.advanceTimersByTime(REPLACE_THROTTLE_MS);
    expect(h.entries[0]!.url).toBe(GALLERY);
  });
});
