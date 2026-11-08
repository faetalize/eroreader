// @vitest-environment node
// Node, not happy-dom: its Blob survives the database's structured cloning, as a browser's does.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { BACKUP_VERSION, BackupError, exportBackup, parseBackup, restoreBackup } from "../src/background/backup";
import { openDb, request } from "../src/background/db";
import { putCover, recordVisit } from "../src/background/historyStore";
import { putProgress } from "../src/background/progressStore";
import { DB_NAME, MIGRATIONS } from "../src/background/schema";
import { recordSearch } from "../src/background/searchStore";
import { emptyProgress } from "../src/shared/progress";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/shared/settings";

const fresh = () => openDb(DB_NAME, MIGRATIONS, new IDBFactory());
const visit = (gid: number, title = `Gallery ${gid}`) => ({
  gid, token: "abcdef0123", host: "exhentai.org", title, titleJpn: "", category: "Manga", tags: ["language:english"], pageCount: 20, coverUrl: null,
});
const progress = (gid: number, page: number, updatedAt: number) => ({ ...emptyProgress({ gid, token: "t", host: "exhentai.org", title: "", pageCount: 20 }), page, updatedAt });
const all = async (db: IDBDatabase, store: string) => request(db.transaction(store).objectStore(store).getAll()) as Promise<Record<string, unknown>[]>;
const coverBytes = async (db: IDBDatabase, gid: number) => {
  const record = (await request(db.transaction("covers").objectStore("covers").get(gid))) as { blob: Blob } | undefined;
  return record ? [...new Uint8Array(await record.blob.arrayBuffer())] : null;
};

async function seeded(): Promise<IDBDatabase> {
  const db = await fresh();
  await recordVisit(db, visit(1), 1000);
  await recordVisit(db, visit(1), 2000);
  await recordVisit(db, visit(2), 3000);
  await putCover(db, 1, new Blob([new Uint8Array([0, 1, 2, 250, 251, 252])], { type: "image/webp" }), 1000);
  await putProgress(db, progress(1, 7, 5000));
  await recordSearch(db, { host: "exhentai.org", query: "sample query", cats: 0, url: "https://exhentai.org/?f_search=sample+query" }, 4000);
  return db;
}

// Through the file's text, as it would be saved and read back.
const roundTrip = async (db: IDBDatabase, settings = DEFAULT_SETTINGS) => parseBackup(JSON.stringify(await exportBackup(db, settings, 9000)));

describe("Backups", () => {
  it("restores everything into a new profile, covers included", async () => {
    const source = await seeded();
    const backup = await roundTrip(source, normalizeSettings({ ...DEFAULT_SETTINGS, preloadAhead: 5 }));
    expect(backup.exportedAt).toBe(9000);
    expect(backup.settings.preloadAhead).toBe(5);
    const target = await fresh();
    const summary = await restoreBackup(target, backup);
    expect(summary).toEqual({
      progress: { added: 1, updated: 0 },
      galleries: { added: 2, updated: 0 },
      searches: { added: 1, updated: 0 },
      covers: { added: 1, updated: 0 },
    });
    for (const store of ["progress", "galleries", "searches"]) expect(await all(target, store)).toEqual(await all(source, store));
    expect(await coverBytes(target, 1)).toEqual([0, 1, 2, 250, 251, 252]);
  });

  it("merges into what's here, never deleting and keeping the newer of each", async () => {
    const backup = await roundTrip(await seeded());
    const target = await fresh();
    await recordVisit(target, visit(1, "Renamed Since"), 500); // visited before the backup's visits
    await recordVisit(target, visit(1, "Renamed Since"), 8000); // and after
    await recordVisit(target, visit(3), 100); // only here
    await putProgress(target, progress(1, 12, 6000)); // newer than the backup's
    await putCover(target, 1, new Blob([new Uint8Array([9])], { type: "image/webp" }), 100);
    const summary = await restoreBackup(target, backup);
    const galleries = Object.fromEntries((await all(target, "galleries")).map((g) => [g.gid, g]));
    expect(Object.keys(galleries)).toEqual(["1", "2", "3"]);
    expect(galleries[1]).toMatchObject({ title: "Renamed Since", firstVisit: 500, lastVisit: 8000, visits: 2 });
    expect((await all(target, "progress"))[0]).toMatchObject({ page: 12 });
    expect(await coverBytes(target, 1)).toEqual([9]);
    expect(summary.progress).toEqual({ added: 0, updated: 0 });
    expect(summary.covers).toEqual({ added: 0, updated: 0 });
    // Restoring the same file again changes nothing.
    expect(await restoreBackup(target, backup)).toEqual({
      progress: { added: 0, updated: 0 },
      galleries: { added: 0, updated: 0 },
      searches: { added: 0, updated: 0 },
      covers: { added: 0, updated: 0 },
    });
  });

  it("keeps the furthest page of either side, whichever progress is newer", async () => {
    const backup = await roundTrip(await seeded()); // page 7 at 5000
    const target = await fresh();
    await putProgress(target, { ...progress(1, 2, 9000), furthest: 3 }); // newer, but not as far
    await restoreBackup(target, backup);
    expect((await all(target, "progress"))[0]).toMatchObject({ page: 2, furthest: 7 });
  });

  it("takes newer progress and the latest use of a search from the file", async () => {
    const backup = await roundTrip(await seeded());
    const target = await fresh();
    await putProgress(target, progress(1, 3, 100));
    await recordSearch(target, { host: "exhentai.org", query: "sample query", cats: 0, url: "https://exhentai.org/?f_search=sample+query" }, 100);
    const summary = await restoreBackup(target, backup);
    expect((await all(target, "progress"))[0]).toMatchObject({ page: 7, updatedAt: 5000 });
    expect((await all(target, "searches"))[0]).toMatchObject({ lastUsed: 4000 });
    expect(summary.progress).toEqual({ added: 0, updated: 1 });
  });

  it("keeps the character, if there is one, and drops one that isn't a character anymore", async () => {
    const character = { name: "Narrator", messages: { pill: "", events: { start: ["Here we go."] }, rare: {} } };
    const backup = parseBackup(JSON.stringify(await exportBackup(await fresh(), DEFAULT_SETTINGS, 9000, character)));
    expect(backup.character).toEqual(character);
    expect((await roundTrip(await fresh())).character).toBeNull();
    const broken = { ...(await exportBackup(await fresh(), DEFAULT_SETTINGS, 9000)), character: { name: "x", messages: { events: {} } } };
    expect(parseBackup(JSON.stringify(broken)).character).toBeNull();
  });

  it("refuses files that aren't backups, or come from a newer version", () => {
    expect(() => parseBackup("not json")).toThrow(BackupError);
    expect(() => parseBackup(JSON.stringify({ hello: 1 }))).toThrow("isn't an eroreader backup");
    expect(() => parseBackup(JSON.stringify({ format: "eroreader-backup", version: BACKUP_VERSION + 1 }))).toThrow("newer version");
  });

  it("leaves out records that don't check out, keeping the rest", () => {
    const backup = parseBackup(
      JSON.stringify({
        format: "eroreader-backup",
        version: BACKUP_VERSION,
        progress: [{ gid: "x" }, progress(4, 2, 10)],
        galleries: [{ gid: -1 }, { ...visit(5), firstVisit: 10, lastVisit: 20, visits: 2 }],
        searches: [{ host: 1 }],
        covers: [{ gid: 5, type: "text/html", data: "AA==" }, { gid: 6, type: "image/webp", data: "not base64!" }, { gid: 7, type: "image/webp", data: "AAEC" }],
        settings: { preloadAhead: 99 },
      }),
    );
    expect(backup.progress.map((p) => p.gid)).toEqual([4]);
    expect(backup.galleries.map((g) => g.gid)).toEqual([5]);
    expect(backup.searches).toEqual([]);
    expect(backup.covers.map((c) => c.gid)).toEqual([7]);
    expect(backup.settings.preloadAhead).toBe(8); // within the cap
  });
});
