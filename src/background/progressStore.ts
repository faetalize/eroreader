import { normalizeProgress, type ProgressRecord } from "../shared/progress";
import { request, transactionDone } from "./db";

export async function getProgress(db: IDBDatabase, gid: number): Promise<ProgressRecord | null> {
  const value: unknown = await request(db.transaction("progress").objectStore("progress").get(gid));
  return normalizeProgress(value);
}

export async function putProgress(db: IDBDatabase, value: unknown): Promise<void> {
  const record = normalizeProgress(value);
  if (!record) throw new Error("Not a progress record");
  const tx = db.transaction("progress", "readwrite");
  tx.objectStore("progress").put(record);
  await transactionDone(tx);
}

// Records for the given galleries that have any; the rest are left out.
export async function getManyProgress(db: IDBDatabase, gids: number[]): Promise<ProgressRecord[]> {
  const store = db.transaction("progress").objectStore("progress");
  const values = await Promise.all([...new Set(gids)].map((gid) => request(store.get(gid))));
  return values.map(normalizeProgress).filter((record) => record !== null);
}
