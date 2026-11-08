import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/background/db";
import { getProgress, putProgress } from "../src/background/progressStore";
import { DB_NAME, MIGRATIONS } from "../src/background/schema";
import { emptyProgress } from "../src/shared/progress";

const record = { ...emptyProgress({ gid: 7654321, token: "abcdef0123", host: "exhentai.org", title: "Sample", pageCount: 219 }), page: 34, furthest: 34 };

describe("progress store", () => {
  it("saves and reads a gallery's progress", async () => {
    const db = await openDb(DB_NAME, MIGRATIONS, new IDBFactory());
    expect(await getProgress(db, 7654321)).toBeNull();
    await putProgress(db, record);
    await putProgress(db, { ...record, page: 35, furthest: 35 });
    expect(await getProgress(db, 7654321)).toEqual({ ...record, page: 35, furthest: 35 });
    db.close();
  });

  it("refuses anything that isn't a progress record", async () => {
    const db = await openDb(DB_NAME, MIGRATIONS, new IDBFactory());
    await expect(putProgress(db, { gid: "nope" })).rejects.toThrow();
    db.close();
  });
});
