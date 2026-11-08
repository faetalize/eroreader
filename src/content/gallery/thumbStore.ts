// Thumbnail pages fetched for one gallery, kept in memory and in the tab's sessionStorage so
// they survive reloads while the tab is open. Only the most recent galleries are kept.
import type { Thumb } from "../../site/gallery";

export interface ThumbPageData {
  thumbPage: number;
  thumbs: Thumb[];
}

const PREFIX = "eroreader.thumbs.";
const INDEX = `${PREFIX}index`; // gids, least recently opened first

export const MAX_STORED_GALLERIES = 20;

function readIndex(storage: Storage): number[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(INDEX) ?? "[]");
    return Array.isArray(value) ? value.filter((gid) => typeof gid === "number") : [];
  } catch {
    return [];
  }
}

function writeIndex(storage: Storage, index: number[]): void {
  try {
    storage.setItem(INDEX, JSON.stringify(index));
  } catch {
    // A stale index only means an extra gallery is kept until the next write.
  }
}

function removeGallery(storage: Storage, gid: number): void {
  const prefix = `${PREFIX}${gid}.`;
  for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i);
    if (key?.startsWith(prefix)) storage.removeItem(key);
  }
}

export class ThumbStore {
  readonly #pages = new Map<number, ThumbPageData>();
  readonly #gid: number;
  readonly #storage: Storage | null;
  readonly #maxGalleries: number;
  readonly #listeners = new Set<(data: ThumbPageData) => void>();

  constructor(gid: number, storage: Storage | null, maxGalleries = MAX_STORED_GALLERIES) {
    this.#gid = gid;
    this.#storage = storage;
    this.#maxGalleries = maxGalleries;
    if (storage) this.#load(storage);
  }

  get(thumbPage: number): ThumbPageData | undefined {
    return this.#pages.get(thumbPage);
  }

  has(thumbPage: number): boolean {
    return this.#pages.has(thumbPage);
  }

  set(data: ThumbPageData): void {
    this.#pages.set(data.thumbPage, data);
    if (this.#storage) this.#save(this.#storage, data);
    for (const listener of this.#listeners) listener(data);
  }

  // Calls `listener` for every thumbnail page added from now on. Returns the unsubscribe.
  subscribe(listener: (data: ThumbPageData) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #load(storage: Storage): void {
    const prefix = `${PREFIX}${this.#gid}.`;
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key?.startsWith(prefix)) continue;
        const data = JSON.parse(storage.getItem(key)!) as ThumbPageData;
        this.#pages.set(data.thumbPage, data);
      }
      this.#touch(storage);
    } catch {
      // Unreadable storage only costs a refetch.
    }
  }

  // Moves this gallery to the end of the index and drops the oldest galleries past the cap.
  #touch(storage: Storage): void {
    const index = readIndex(storage).filter((gid) => gid !== this.#gid);
    index.push(this.#gid);
    while (index.length > this.#maxGalleries) removeGallery(storage, index.shift()!);
    writeIndex(storage, index);
  }

  #save(storage: Storage, data: ThumbPageData): void {
    const key = `${PREFIX}${this.#gid}.${data.thumbPage}`;
    const value = JSON.stringify(data);
    const evicted = new Set<number>();
    for (;;) {
      try {
        storage.setItem(key, value);
        this.#touch(storage);
        return;
      } catch {
        // Out of quota: drop the oldest other gallery and try again, or keep it in memory only.
        // `evicted` ends the loop even if the index itself can't be rewritten.
        const oldest = readIndex(storage).find((gid) => gid !== this.#gid && !evicted.has(gid));
        if (oldest === undefined) return;
        evicted.add(oldest);
        removeGallery(storage, oldest);
        writeIndex(storage, readIndex(storage).filter((gid) => gid !== oldest));
      }
    }
  }
}
