import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { openDb, request, transactionDone, type Migration } from "../src/background/db";

const v1: Migration = (db) => {
  db.createObjectStore("items", { keyPath: "id" });
};
const v2: Migration = (_db, tx) => {
  tx.objectStore("items").createIndex("byName", "name");
};

describe("openDb", () => {
  it("runs every migration on a fresh database", async () => {
    const db = await openDb("test", [v1, v2], new IDBFactory());
    expect(db.version).toBe(2);
    const store = db.transaction("items").objectStore("items");
    expect(store.indexNames.contains("byName")).toBe(true);
    db.close();
  });

  it("runs only the missing migrations on an existing database", async () => {
    const factory = new IDBFactory();
    const old = await openDb("test", [v1], factory);
    const tx = old.transaction("items", "readwrite");
    tx.objectStore("items").put({ id: 1, name: "kept" });
    await transactionDone(tx);
    old.close();

    const db = await openDb("test", [v1, v2], factory);
    const item = await request(db.transaction("items").objectStore("items").index("byName").get("kept"));
    expect(item).toEqual({ id: 1, name: "kept" });
    db.close();
  });

  it("refuses an empty migration list", () => {
    expect(() => openDb("test", [], new IDBFactory())).toThrow();
  });
});

describe("transactionDone", () => {
  it("rejects when the transaction aborts", async () => {
    const db = await openDb("test", [v1], new IDBFactory());
    const tx = db.transaction("items", "readwrite");
    const done = transactionDone(tx);
    tx.abort();
    await expect(done).rejects.toThrow();
    db.close();
  });
});
