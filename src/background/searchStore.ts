import { normalizeSearchInput, searchKey, type SearchEntry } from "../shared/searches";
import { request, transactionDone } from "./db";

// Counts one more use of a search, adding it if it's new.
export async function recordSearch(db: IDBDatabase, value: unknown, now: number): Promise<void> {
  const input = normalizeSearchInput(value);
  if (!input) throw new Error("Not a search");
  const key = searchKey(input);
  const tx = db.transaction("searches", "readwrite");
  const store = tx.objectStore("searches");
  const existing = (await request(store.get(key))) as SearchEntry | undefined;
  store.put({ ...input, key, uses: (existing?.uses ?? 0) + 1, lastUsed: now } satisfies SearchEntry);
  await transactionDone(tx);
}

// Most recently used first, for one site.
export async function recentSearches(db: IDBDatabase, host: string, limit: number): Promise<SearchEntry[]> {
  const out: SearchEntry[] = [];
  const index = db.transaction("searches").objectStore("searches").index("lastUsed");
  return new Promise((resolve, reject) => {
    const cursor = index.openCursor(null, "prev");
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c || out.length >= limit) return resolve(out);
      const entry = c.value as SearchEntry;
      if (entry.host === host) out.push(entry);
      c.continue();
    };
  });
}
