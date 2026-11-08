import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/background/db";
import { getManyProgress, putProgress } from "../src/background/progressStore";
import { DB_NAME, MIGRATIONS } from "../src/background/schema";
import { recentSearches, recordSearch } from "../src/background/searchStore";
import { emptyProgress } from "../src/shared/progress";
import { categoriesOff, searchFromUrl } from "../src/shared/searches";

describe("searchFromUrl", () => {
  it("reads a keyword search with its category filter", () => {
    expect(searchFromUrl(new URL("https://exhentai.org/?f_search=sample+query&f_cats=112"))).toEqual({
      search: { host: "exhentai.org", query: "sample query", cats: 112, url: "https://exhentai.org/?f_search=sample+query&f_cats=112" },
      firstPage: true,
    });
  });

  it("knows later pages of the same search, and drops the paging from its URL", () => {
    expect(searchFromUrl(new URL("https://exhentai.org/?f_search=sample+query&next=2222001"))).toEqual({
      search: { host: "exhentai.org", query: "sample query", cats: 0, url: "https://exhentai.org/?f_search=sample+query" },
      firstPage: false,
    });
  });

  it("reads tag pages", () => {
    expect(searchFromUrl(new URL("https://e-hentai.org/tag/artist:sample+artist"))?.search).toMatchObject({ query: "artist:sample artist", url: "https://e-hentai.org/tag/artist:sample+artist" });
  });

  it("isn't a search on the plain front page, favourites or other listings", () => {
    for (const url of ["https://exhentai.org/", "https://exhentai.org/?next=1", "https://exhentai.org/favorites.php?f_search=x", "https://exhentai.org/popular"]) {
      expect(searchFromUrl(new URL(url)), url).toBeNull();
    }
  });

  it("counts the categories switched off", () => {
    expect([0, 112, 1023].map(categoriesOff)).toEqual([0, 3, 10]);
  });
});

describe("search store", () => {
  const search = (query: string, host = "exhentai.org") => ({ host, query, cats: 0, url: `https://${host}/?f_search=${query}` });

  it("counts uses and lists the most recent first, per site", async () => {
    const db = await openDb(DB_NAME, MIGRATIONS, new IDBFactory());
    await recordSearch(db, search("a"), 1);
    await recordSearch(db, search("b"), 2);
    await recordSearch(db, search("a"), 3);
    await recordSearch(db, search("c", "e-hentai.org"), 4);
    const recent = await recentSearches(db, "exhentai.org", 10);
    expect(recent.map((e) => [e.query, e.uses, e.lastUsed])).toEqual([["a", 2, 3], ["b", 1, 2]]);
    expect(await recentSearches(db, "exhentai.org", 1)).toHaveLength(1);
    await expect(recordSearch(db, { host: 1 }, 5)).rejects.toThrow();
    db.close();
  });

  it("upgrades a database made before searches existed, keeping progress", async () => {
    const factory = new IDBFactory();
    const old = await openDb(DB_NAME, MIGRATIONS.slice(0, 1), factory);
    const record = { ...emptyProgress({ gid: 7, token: "t", host: "exhentai.org", title: "T", pageCount: 9 }), page: 3, furthest: 3 };
    await putProgress(old, record);
    old.close();
    const db = await openDb(DB_NAME, MIGRATIONS, factory);
    expect(await getManyProgress(db, [7, 8, 7])).toEqual([record]);
    await recordSearch(db, search("a"), 1);
    db.close();
  });
});
