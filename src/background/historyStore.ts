import { entrySize, normalizeVisit, type CoverRecord, type GalleryEntry, type StorageStats } from "../shared/history";
import type { ProgressRecord } from "../shared/progress";
import type { SearchEntry } from "../shared/searches";
import { request, transactionDone } from "./db";

// Adds a visit, or updates the entry with what the gallery page shows now. Returns whether the
// gallery already has a cover.
export async function recordVisit(db: IDBDatabase, value: unknown, now: number): Promise<{ hasCover: boolean }> {
  const visit = normalizeVisit(value);
  if (!visit) throw new Error("Not a gallery visit");
  const tx = db.transaction(["galleries", "covers"], "readwrite");
  const galleries = tx.objectStore("galleries");
  const old = (await request(galleries.get(visit.gid))) as GalleryEntry | undefined;
  const hasCover = (await request(tx.objectStore("covers").count(visit.gid))) > 0;
  const { coverUrl: _, ...fields } = visit;
  const entry = { ...fields, firstVisit: old?.firstVisit ?? now, lastVisit: now, visits: (old?.visits ?? 0) + 1 };
  galleries.put({ ...entry, size: entrySize(entry) } satisfies GalleryEntry);
  await transactionDone(tx);
  return { hasCover };
}

export async function putCover(db: IDBDatabase, gid: number, blob: Blob, now: number): Promise<void> {
  const tx = db.transaction("covers", "readwrite");
  tx.objectStore("covers").put({ gid, blob, size: blob.size, savedAt: now } satisfies CoverRecord);
  await transactionDone(tx);
}

// Updates entries with refreshed details, keeping visits and covers.
export async function updateEntries(db: IDBDatabase, updates: Partial<GalleryEntry>[]): Promise<number> {
  const tx = db.transaction("galleries", "readwrite");
  const store = tx.objectStore("galleries");
  let updated = 0;
  for (const update of updates) {
    if (typeof update.gid !== "number") continue;
    const old = (await request(store.get(update.gid))) as GalleryEntry | undefined;
    if (!old) continue;
    const { size: _, ...merged } = { ...old, ...update, gid: old.gid, firstVisit: old.firstVisit, lastVisit: old.lastVisit, visits: old.visits };
    store.put({ ...merged, size: entrySize(merged) });
    updated++;
  }
  await transactionDone(tx);
  return updated;
}

export async function removeCovers(db: IDBDatabase, gids: number[]): Promise<void> {
  const tx = db.transaction("covers", "readwrite");
  for (const gid of gids) tx.objectStore("covers").delete(gid);
  await transactionDone(tx);
}

// Removes entries and their covers. Reading progress stays: it's separate from history.
export async function deleteEntries(db: IDBDatabase, gids: number[]): Promise<void> {
  const tx = db.transaction(["galleries", "covers"], "readwrite");
  for (const gid of gids) {
    tx.objectStore("galleries").delete(gid);
    tx.objectStore("covers").delete(gid);
  }
  await transactionDone(tx);
}

export async function deleteSearches(db: IDBDatabase, keys: string[]): Promise<void> {
  const tx = db.transaction("searches", "readwrite");
  for (const key of keys) tx.objectStore("searches").delete(key);
  await transactionDone(tx);
}

export async function clearHistory(db: IDBDatabase, { progress }: { progress: boolean }): Promise<void> {
  const stores = ["galleries", "covers", "searches", ...(progress ? ["progress"] : [])];
  const tx = db.transaction(stores, "readwrite");
  for (const name of stores) tx.objectStore(name).clear();
  await transactionDone(tx);
}

export async function computeStats(db: IDBDatabase): Promise<StorageStats> {
  const tx = db.transaction(["galleries", "covers"]);
  const sum = (store: IDBObjectStore, field: "size") =>
    new Promise<{ count: number; bytes: number }>((resolve, reject) => {
      let count = 0;
      let bytes = 0;
      const cursor = store.openCursor();
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return resolve({ count, bytes });
        count++;
        bytes += Number((c.value as Record<string, unknown>)[field]) || 0;
        c.continue();
      };
    });
  const [entries, covers] = await Promise.all([sum(tx.objectStore("galleries"), "size"), sum(tx.objectStore("covers"), "size")]);
  return { entries: entries.count, entryBytes: entries.bytes, covers: covers.count, coverBytes: covers.bytes };
}

// Records copied before a deletion, so it can be undone.
export interface HistorySnapshot {
  galleries: GalleryEntry[];
  covers: CoverRecord[];
  searches: SearchEntry[];
  progress: ProgressRecord[];
}

type Pick = IDBValidKey[] | "all";

// Copies the records a deletion is about to remove: by key, or every record in a store.
export async function takeSnapshot(db: IDBDatabase, what: Partial<Record<keyof HistorySnapshot, Pick>>): Promise<HistorySnapshot> {
  const tx = db.transaction(["galleries", "covers", "searches", "progress"]);
  const read = async <T>(store: keyof HistorySnapshot, pick: Pick | undefined): Promise<T[]> => {
    if (!pick) return [];
    const objects = tx.objectStore(store);
    if (pick === "all") return (await request(objects.getAll())) as T[];
    const found = await Promise.all(pick.map((key) => request(objects.get(key))));
    return found.filter((record) => record !== undefined) as T[];
  };
  const [galleries, covers, searches, progress] = await Promise.all([
    read<GalleryEntry>("galleries", what.galleries),
    read<CoverRecord>("covers", what.covers),
    read<SearchEntry>("searches", what.searches),
    read<ProgressRecord>("progress", what.progress),
  ]);
  return { galleries, covers, searches, progress };
}

// Puts a snapshot's records back as they were.
export async function putSnapshot(db: IDBDatabase, snapshot: HistorySnapshot): Promise<void> {
  const tx = db.transaction(["galleries", "covers", "searches", "progress"], "readwrite");
  for (const store of ["galleries", "covers", "searches", "progress"] as const) {
    for (const record of snapshot[store]) tx.objectStore(store).put(record);
  }
  await transactionDone(tx);
}
