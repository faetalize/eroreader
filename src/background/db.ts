// Thin promise layer over IndexedDB. The background owns the database: a content script's
// IndexedDB would belong to the site's origin, not the extension's.

// migrations[i] upgrades the database from version i to version i + 1.
export type Migration = (db: IDBDatabase, tx: IDBTransaction) => void;

export function openDb(name: string, migrations: Migration[], factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  if (migrations.length === 0) throw new Error("A database needs at least one migration");
  return new Promise((resolve, reject) => {
    const open = factory.open(name, migrations.length);
    open.onupgradeneeded = (event) => {
      const tx = open.transaction!;
      for (let version = event.oldVersion; version < migrations.length; version++) {
        migrations[version]!(open.result, tx);
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error(`Opening database "${name}" is blocked by another connection`));
  });
}

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
}
