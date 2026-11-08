import { restoredText } from "../src/pages/app/restoredText";
import { describe, expect, it, vi } from "vitest";
import { addKey, conflictOf, isOverridden, keysOf, removeKey, resetAction } from "../src/pages/app/keyBindings";
import { compareRows, dayLabel, EMPTY_FILTER, formatBytes, matches, readState, type SortOrder } from "../src/pages/app/historyQuery";
import { apiUrlFor, batches, BATCH_GAP_MS, decodeEntities, parseGdata, refreshEntries, RefreshError } from "../src/pages/app/refresh";
import { emptyProgress } from "../src/shared/progress";
import type { GalleryEntry } from "../src/shared/history";

describe("key bindings", () => {
  it("starts from the defaults", () => {
    expect(keysOf({}, "fit")).toEqual(["f"]);
    expect(keysOf({}, "zoomIn")).toEqual(["+", "="]);
    expect(isOverridden({}, "fit")).toBe(false);
  });

  it("adds a free key", () => {
    const next = addKey({}, "fit", "x");
    expect(keysOf(next, "fit")).toEqual(["f", "x"]);
  });

  it("finds the action that already has a key, within the same table only", () => {
    expect(conflictOf({}, "filmstrip", "g")).toBe("grid");
    expect(conflictOf({}, "autoStop", "s")).toBeNull(); // the reader's quick settings: another table
    expect(conflictOf({}, "pageNext", " ")).toBe("autoPlay");
    expect(conflictOf({}, "pageNext", "Escape")).toBe("close");
  });

  it("moves a taken key to the new action", () => {
    const next = addKey({}, "filmstrip", "g");
    expect(keysOf(next, "filmstrip")).toEqual(["t", "g"]);
    expect(keysOf(next, "grid")).toEqual([]);
  });

  it("removes keys, and an action back at its defaults keeps no override", () => {
    let next = removeKey({}, "zoomIn", "=");
    expect(next).toEqual({ zoomIn: ["+"] });
    next = addKey(next, "zoomIn", "=");
    expect(next).toEqual({});
  });

  it("resets an action, taking its default keys back from wherever they went", () => {
    let next = addKey({}, "filmstrip", "g"); // grid lost G
    next = resetAction(next, "grid");
    expect(keysOf(next, "grid")).toEqual(["g"]);
    expect(keysOf(next, "filmstrip")).toEqual(["t"]);
  });
});

describe("history filters", () => {
  const entry: GalleryEntry = {
    gid: 1, token: "t", host: "exhentai.org", title: "Sample Gallery", titleJpn: "サンプル", category: "Doujinshi",
    tags: ["language:english", "artist:sample artist"], pageCount: 24, firstVisit: 1000, lastVisit: 5000, visits: 1, size: 1,
  };
  const reading = { ...emptyProgress({ gid: 1, token: "t", host: "exhentai.org", title: "", pageCount: 24 }), page: 5 };

  it("sorts by title, size, pages or visits, most recent first among equals", () => {
    const row = (gid: number, extra: Partial<GalleryEntry>, coverBytes = 0) => ({ entry: { ...entry, gid, lastVisit: gid, ...extra }, coverBytes });
    const rows = [row(1, { title: "beta 10", size: 100, pageCount: 5, visits: 1 }), row(2, { title: "Alpha", size: 50, pageCount: 9, visits: 3 }, 100), row(3, { title: "beta 9", size: 120, pageCount: 9, visits: 1 })];
    const order = (by: SortOrder) => [...rows].sort(compareRows(by)).map((r) => r.entry.gid);
    expect(order("title")).toEqual([2, 3, 1]); // case aside, and 9 before 10
    expect(order("size")).toEqual([2, 3, 1]); // the cover counts
    expect(order("pages")).toEqual([3, 2, 1]);
    expect(order("visits")).toEqual([2, 3, 1]);
  });

  it("matches by text in titles and tags", () => {
    expect(matches(entry, undefined, { ...EMPTY_FILTER, text: "SAMPLE gal" })).toBe(true);
    expect(matches(entry, undefined, { ...EMPTY_FILTER, text: "サンプル" })).toBe(true);
    expect(matches(entry, undefined, { ...EMPTY_FILTER, text: "nope" })).toBe(false);
  });

  it("matches a tag with or without its namespace", () => {
    expect(matches(entry, undefined, { ...EMPTY_FILTER, tag: "artist:sample artist" })).toBe(true);
    expect(matches(entry, undefined, { ...EMPTY_FILTER, tag: "sample artist" })).toBe(true);
    expect(matches(entry, undefined, { ...EMPTY_FILTER, tag: "sample" })).toBe(false);
  });

  it("matches by site, category, dates and reading state", () => {
    expect(matches(entry, undefined, { ...EMPTY_FILTER, sites: ["e-hentai.org"] })).toBe(false);
    expect(matches(entry, undefined, { ...EMPTY_FILTER, sites: ["e-hentai.org", "exhentai.org"] })).toBe(true);
    expect(matches(entry, undefined, { ...EMPTY_FILTER, sites: [] })).toBe(false);
    expect(matches(entry, undefined, { ...EMPTY_FILTER, category: "Manga" })).toBe(false);
    expect(matches(entry, undefined, { ...EMPTY_FILTER, from: 5000, to: 5001 })).toBe(true);
    expect(matches(entry, undefined, { ...EMPTY_FILTER, to: 5000 })).toBe(false);
    expect(matches(entry, reading, { ...EMPTY_FILTER, state: "reading" })).toBe(true);
    expect(matches(entry, undefined, { ...EMPTY_FILTER, state: "unread" })).toBe(true);
    expect(readState({ ...reading, finished: true })).toBe("finished");
  });

  it("labels days and sizes", () => {
    const now = new Date(2026, 10, 7, 15).getTime();
    expect(dayLabel(new Date(2026, 10, 7, 1).getTime(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 10, 6, 23).getTime(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 10, 1).getTime(), now, "en-US")).toBe("Sun, Nov 1, 2026");
    expect([500, 15360, 3 * 1024 ** 2, 2.5 * 1024 ** 3].map(formatBytes)).toEqual(["500 B", "15.0 KB", "3.0 MB", "2.50 GB"]);
  });
});

describe("refresh", () => {
  const gdata = (gids: number[]) => ({
    gmetadata: gids.map((gid) => ({ gid, token: "t", title: "New &amp; Improved", title_jpn: "", category: "Manga", filecount: "30", tags: ["language:english", "other:full color"] })),
  });

  it("parses the API's answer, skipping errors and decoding entities", () => {
    expect(parseGdata({ gmetadata: [...gdata([1]).gmetadata, { gid: 2, error: "Key missing" }] })).toEqual([
      { gid: 1, title: "New & Improved", titleJpn: "", category: "Manga", pageCount: 30, tags: ["language:english", "other:full color"] },
    ]);
    expect(() => parseGdata({})).toThrow();
    expect(decodeEntities("&#39;a&#x27;&quot;")).toBe("'a'\"");
  });

  it("batches 25 at a time per site, pausing between requests", async () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({ gid: i + 1, token: "t", host: i < 55 ? "exhentai.org" : "e-hentai.org" }));
    const calls: { url: string; gids: number[] }[] = [];
    const sleeps: number[] = [];
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { gidlist: [number, string][] };
      calls.push({ url, gids: body.gidlist.map(([gid]) => gid) });
      expect(init.credentials).toBe("include");
      return new Response(JSON.stringify(gdata(body.gidlist.map(([gid]) => gid))));
    });
    const updated = await refreshEntries(entries, { fetch: fetchFn as unknown as typeof fetch, save: async (u) => u.length, sleep: async (ms) => void sleeps.push(ms) });
    expect(updated).toBe(60);
    expect(calls.map((c) => [c.url, c.gids.length])).toEqual([
      [apiUrlFor("exhentai.org"), 25],
      [apiUrlFor("exhentai.org"), 25],
      [apiUrlFor("exhentai.org"), 5],
      [apiUrlFor("e-hentai.org"), 5],
    ]);
    expect(sleeps).toEqual([BATCH_GAP_MS, BATCH_GAP_MS, BATCH_GAP_MS]);
    expect(batches([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });

  it("says when ExHentai refuses, which means logged out", async () => {
    const fetchFn = async () => new Response("", { status: 200 });
    await expect(refreshEntries([{ gid: 1, token: "t", host: "exhentai.org" }], { fetch: fetchFn as unknown as typeof fetch, save: async () => 0 })).rejects.toBeInstanceOf(RefreshError);
  });
});

describe("restoredText", () => {
  const none = { added: 0, updated: 0 };
  it("names only what restoring changed", () => {
    expect(restoredText({ galleries: { added: 2, updated: 1 }, progress: none, searches: none, covers: { added: 1, updated: 0 } }, false)).toBe(
      "Restored: galleries 2 added, 1 updated; cover 1 added.",
    );
    expect(restoredText({ galleries: none, progress: none, searches: none, covers: none }, true)).toBe("Restored: settings restored.");
    expect(restoredText({ galleries: none, progress: none, searches: none, covers: none }, false)).toBe("Nothing new: everything in this backup is already here.");
  });
});
