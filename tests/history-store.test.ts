import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { fetchCover } from "../src/background/cover";
import { openDb, request } from "../src/background/db";
import { clearHistory, computeStats, deleteEntries, deleteSearches, putCover, recordVisit, removeCovers, updateEntries } from "../src/background/historyStore";
import { getProgress, putProgress } from "../src/background/progressStore";
import { DB_NAME, MIGRATIONS } from "../src/background/schema";
import { recentSearches, recordSearch } from "../src/background/searchStore";
import { normalizeVisit, QUOTA_WARNING_BYTES, totalBytes, type GalleryEntry } from "../src/shared/history";
import { emptyProgress } from "../src/shared/progress";

const visit = (gid: number, title = "Sample Gallery") => ({
  gid,
  token: "abcdef0123",
  host: "exhentai.org",
  title,
  titleJpn: "サンプル",
  category: "Doujinshi",
  tags: ["language:english", "artist:sample artist"],
  pageCount: 24,
  coverUrl: "https://s.exhentai.org/w/00/000/00000-samplecv.webp",
});
const open = () => openDb(DB_NAME, MIGRATIONS, new IDBFactory());
const entry = async (db: IDBDatabase, gid: number) => (await request(db.transaction("galleries").objectStore("galleries").get(gid))) as GalleryEntry | undefined;

describe("history store", () => {
  it("records a visit with what the gallery page shows, counting visits", async () => {
    const db = await open();
    expect(await recordVisit(db, visit(7), 1000)).toEqual({ hasCover: false });
    await recordVisit(db, visit(7, "Renamed Gallery"), 2000);
    expect(await entry(db, 7)).toMatchObject({ title: "Renamed Gallery", tags: ["language:english", "artist:sample artist"], firstVisit: 1000, lastVisit: 2000, visits: 2 });
    expect((await entry(db, 7))!.size).toBeGreaterThan(100);
    expect(await entry(db, 7)).not.toHaveProperty("coverUrl");
    db.close();
  });

  it("knows when the gallery already has a cover", async () => {
    const db = await open();
    await recordVisit(db, visit(7), 1);
    await putCover(db, 7, new Blob(["x".repeat(500)], { type: "image/webp" }), 1);
    expect(await recordVisit(db, visit(7), 2)).toEqual({ hasCover: true });
    db.close();
  });

  it("counts entries and covers separately", async () => {
    const db = await open();
    await recordVisit(db, visit(1), 1);
    await recordVisit(db, visit(2), 1);
    await putCover(db, 1, new Blob(["x".repeat(500)]), 1);
    const stats = await computeStats(db);
    expect(stats).toMatchObject({ entries: 2, covers: 1, coverBytes: 500 });
    expect(stats.entryBytes).toBe((await entry(db, 1))!.size + (await entry(db, 2))!.size);
    expect(totalBytes({ entries: 0, entryBytes: QUOTA_WARNING_BYTES, covers: 0, coverBytes: 1 })).toBeGreaterThan(QUOTA_WARNING_BYTES);
    db.close();
  });

  it("removes covers but keeps entries, or removes both, and always keeps reading progress", async () => {
    const db = await open();
    for (const gid of [1, 2, 3]) {
      await recordVisit(db, visit(gid), 1);
      await putCover(db, gid, new Blob(["x"]), 1);
    }
    await putProgress(db, { ...emptyProgress({ gid: 2, token: "t", host: "exhentai.org", title: "T", pageCount: 9 }), page: 3 });
    await removeCovers(db, [1]);
    await deleteEntries(db, [2]);
    expect(await computeStats(db)).toMatchObject({ entries: 2, covers: 1 });
    expect(await entry(db, 1)).toBeDefined();
    expect(await getProgress(db, 2)).not.toBeNull();
    db.close();
  });

  it("refreshes details without touching visits", async () => {
    const db = await open();
    await recordVisit(db, visit(7), 1000);
    expect(await updateEntries(db, [{ gid: 7, title: "New Title", tags: ["other:new"], firstVisit: 5, visits: 99 }, { gid: 8, title: "Not here" }])).toBe(1);
    expect(await entry(db, 7)).toMatchObject({ title: "New Title", tags: ["other:new"], firstVisit: 1000, visits: 1 });
    db.close();
  });

  it("clears everything, with or without reading progress", async () => {
    const db = await open();
    await recordVisit(db, visit(1), 1);
    await recordSearch(db, { host: "exhentai.org", query: "q", cats: 0, url: "https://exhentai.org/?f_search=q" }, 1);
    await putProgress(db, { ...emptyProgress({ gid: 1, token: "t", host: "exhentai.org", title: "T", pageCount: 9 }), page: 3 });
    await clearHistory(db, { progress: false });
    expect(await computeStats(db)).toMatchObject({ entries: 0 });
    expect(await recentSearches(db, "exhentai.org", 10)).toEqual([]);
    expect(await getProgress(db, 1)).not.toBeNull();
    await clearHistory(db, { progress: true });
    expect(await getProgress(db, 1)).toBeNull();
    db.close();
  });

  it("deletes single searches", async () => {
    const db = await open();
    await recordSearch(db, { host: "exhentai.org", query: "q", cats: 0, url: "https://exhentai.org/?f_search=q" }, 1);
    const [search] = await recentSearches(db, "exhentai.org", 10);
    await deleteSearches(db, [search!.key]);
    expect(await recentSearches(db, "exhentai.org", 10)).toEqual([]);
    db.close();
  });

  it("upgrades a database from before history, keeping progress and searches", async () => {
    const factory = new IDBFactory();
    const old = await openDb(DB_NAME, MIGRATIONS.slice(0, 2), factory);
    await putProgress(old, { ...emptyProgress({ gid: 1, token: "t", host: "exhentai.org", title: "T", pageCount: 9 }), page: 3 });
    old.close();
    const db = await openDb(DB_NAME, MIGRATIONS, factory);
    expect(await getProgress(db, 1)).not.toBeNull();
    await recordVisit(db, visit(1), 1);
    db.close();
  });

  it("refuses what isn't a visit", async () => {
    const db = await open();
    await expect(recordVisit(db, { gid: "x" }, 1)).rejects.toThrow();
    expect(normalizeVisit({ ...visit(1), tags: ["a", 2], pageCount: -1 })).toMatchObject({ tags: ["a"], pageCount: 0 });
    db.close();
  });
});

describe("fetchCover", () => {
  it("asks the HTTP cache first, with the normal session", async () => {
    const fetchFn = vi.fn(async () => new Response(new Blob(["img"])));
    await fetchCover("https://s.exhentai.org/w/cover.webp", fetchFn as unknown as typeof fetch);
    expect(fetchFn).toHaveBeenCalledWith("https://s.exhentai.org/w/cover.webp", { cache: "force-cache", credentials: "include" });
  });

  it("fails on an HTTP error", async () => {
    await expect(fetchCover("u", (async () => new Response("", { status: 404 })) as unknown as typeof fetch)).rejects.toThrow();
  });
});
