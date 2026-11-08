// The extension's IndexedDB database. Each migration upgrades by one version.
import { openDb, type Migration } from "./db";

export const DB_NAME = "eroreader";

export const MIGRATIONS: Migration[] = [
  (db) => {
    db.createObjectStore("progress", { keyPath: "gid" });
  },
  (db) => {
    db.createObjectStore("searches", { keyPath: "key" }).createIndex("lastUsed", "lastUsed");
  },
  (db) => {
    db.createObjectStore("galleries", { keyPath: "gid" }).createIndex("lastVisit", "lastVisit");
    db.createObjectStore("covers", { keyPath: "gid" });
  },
];

let opened: Promise<IDBDatabase> | null = null;

// Opened on first use. A Chromium service worker can be stopped at any time, so this is only
// a cache: a fresh worker opens the database again.
export function database(): Promise<IDBDatabase> {
  opened ??= openDb(DB_NAME, MIGRATIONS).catch((error: unknown) => {
    opened = null;
    throw error;
  });
  return opened;
}
