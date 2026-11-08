// The open gallery's progress: loaded once, changed by the reader and the banner, and saved
// through the background.
import { emptyProgress, type GalleryIdentity, type ProgressRecord } from "../shared/progress";

export interface ProgressApi {
  get(gid: number): Promise<ProgressRecord | null>;
  put(record: ProgressRecord): Promise<void>;
}

// A page counts as read once the reader has stayed on it this long, so flipping through
// pages quickly writes once.
export const SETTLE_MS = 500;

export class ProgressTracker {
  readonly #api: ProgressApi;
  readonly #gallery: GalleryIdentity;
  readonly #now: () => number;
  readonly #listeners = new Set<(record: ProgressRecord) => void>();
  readonly #finishListeners = new Set<() => void>();
  readonly #ready: Promise<void>;
  #record: ProgressRecord;
  #pendingPage: number | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(api: ProgressApi, gallery: GalleryIdentity, now: () => number = Date.now) {
    this.#api = api;
    this.#gallery = gallery;
    this.#now = now;
    this.#record = emptyProgress(gallery);
    // Changes made before the stored record arrives wait for it, so they never overwrite it
    // with defaults.
    this.#ready = api.get(gallery.gid).then(
      (stored) => {
        if (stored) this.#record = { ...stored, ...this.#gallery };
      },
      () => {}, // without storage, progress starts empty
    );
  }

  get record(): ProgressRecord {
    return this.#record;
  }

  ready(): Promise<ProgressRecord> {
    return this.#ready.then(() => this.#record);
  }

  subscribe(listener: (record: ProgressRecord) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  // Calls `listener` each time the gallery goes from not finished to finished.
  onFinished(listener: () => void): () => void {
    this.#finishListeners.add(listener);
    return () => this.#finishListeners.delete(listener);
  }

  // The reader shows `page`. The last page also marks the gallery finished.
  pageShown(page: number): void {
    this.#pendingPage = page;
    if (this.#timer !== null) clearTimeout(this.#timer);
    if (page >= this.#gallery.pageCount) {
      void this.flush();
      return;
    }
    this.#timer = setTimeout(() => void this.flush(), SETTLE_MS);
  }

  // Writes a page change still waiting to settle, e.g. when the reader closes.
  async flush(): Promise<void> {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    const page = this.#pendingPage;
    if (page === null) return;
    this.#pendingPage = null;
    await this.#change((r) => ({ ...r, page, furthest: Math.max(r.furthest, page), finished: r.finished || page >= r.pageCount }));
  }

  setRtl(rtl: boolean): Promise<void> {
    return this.#change((r) => ({ ...r, rtl }));
  }

  setSpreads(spreadOffset: boolean, repairPoints: number[]): Promise<void> {
    return this.#change((r) => ({ ...r, spreadOffset, repairPoints: [...repairPoints].sort((a, b) => a - b) }));
  }

  // Forgets how far reading got, keeping the gallery's direction and spread settings.
  reset(): Promise<void> {
    this.#pendingPage = null;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    return this.#change((r) => ({ ...r, page: 0, furthest: 0, finished: false }));
  }

  markFinished(): Promise<void> {
    return this.#change((r) => ({ ...r, finished: true }));
  }

  async #change(update: (record: ProgressRecord) => ProgressRecord): Promise<void> {
    await this.#ready;
    const wasFinished = this.#record.finished;
    this.#record = { ...update(this.#record), ...this.#gallery, updatedAt: this.#now() };
    for (const listener of this.#listeners) listener(this.#record);
    if (!wasFinished && this.#record.finished) for (const listener of this.#finishListeners) listener();
    try {
      await this.#api.put(this.#record);
    } catch {
      // Kept in memory; the next change tries again with the whole record.
    }
  }
}
