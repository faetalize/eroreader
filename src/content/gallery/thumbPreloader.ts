// Keeps the thumbnail pages around the current one fetched, nearest first, fetches the ones a
// reader's filmstrip or grid shows, and fetches any other thumbnail page on demand.
import type { ThumbPageData, ThumbStore } from "./thumbStore";

export const THUMB_WINDOW_RADIUS = 2;

const PRIORITY_WINDOW = 0;
const PRIORITY_DEMAND = 1;

export type ThumbPageLoader = (thumbPage: number, priority: number, signal: AbortSignal) => Promise<ThumbPageData>;

interface Pending {
  promise: Promise<ThumbPageData>;
  controller: AbortController;
  demanded: boolean; // someone is waiting on it, so it's never cancelled
  wantedBy: Set<string>; // lists it's on (the window, a filmstrip or grid); cancelled once on none
}

const WINDOW = "window";

// p+1, p-1, p+2, p-2, … within [0, count).
export function windowOrder(center: number, radius: number, count: number): number[] {
  const order: number[] = [];
  for (let distance = 1; distance <= radius; distance++) {
    if (center + distance < count) order.push(center + distance);
    if (center - distance >= 0) order.push(center - distance);
  }
  return order;
}

export class ThumbPreloader {
  readonly #pending = new Map<number, Pending>();
  readonly #refetched = new Set<number>(); // see refetchOnce()
  readonly #store: ThumbStore;
  readonly #count: number;
  readonly #radius: number;
  readonly #load: ThumbPageLoader;

  constructor(options: { store: ThumbStore; thumbPageCount: number; load: ThumbPageLoader; radius?: number }) {
    this.#store = options.store;
    this.#count = options.thumbPageCount;
    this.#load = options.load;
    this.#radius = options.radius ?? THUMB_WINDOW_RADIUS;
  }

  // Re-centers the window on `center`, the thumbnail page on screen, which the caller already
  // has. Window requests that fall outside it are cancelled.
  focus(center: number): void {
    this.#want(WINDOW, windowOrder(center, this.#radius, this.#count), PRIORITY_WINDOW, center);
  }

  // Replaces the thumbnail pages `owner` wants, most important first. Requests for pages it no
  // longer wants are cancelled unless something else still wants them.
  want(owner: string, thumbPages: number[], priority: number): void {
    this.#want(owner, thumbPages, priority);
  }

  // `keep` is wanted too, but not fetched.
  #want(owner: string, thumbPages: number[], priority: number, keep?: number): void {
    const wanted = new Set(thumbPages);
    if (keep !== undefined) wanted.add(keep);
    for (const [thumbPage, pending] of this.#pending) {
      if (wanted.has(thumbPage) || !pending.wantedBy.delete(owner)) continue;
      if (!pending.demanded && pending.wantedBy.size === 0) pending.controller.abort();
    }
    for (const thumbPage of thumbPages) {
      if (this.#store.has(thumbPage)) continue;
      const pending = this.#pending.get(thumbPage);
      if (pending) pending.wantedBy.add(owner);
      else this.#request(thumbPage, priority, false, owner).catch(() => {});
    }
  }

  ensure(thumbPage: number, priority = PRIORITY_DEMAND): Promise<ThumbPageData> {
    const stored = this.#store.get(thumbPage);
    if (stored) return Promise.resolve(stored);
    const pending = this.#pending.get(thumbPage);
    if (pending) {
      pending.demanded = true;
      return pending.promise;
    }
    return this.#request(thumbPage, priority, true);
  }

  // Fetches a kept thumbnail page again, e.g. once its picture URLs have expired. At most once
  // per thumbnail page while this page is open: null once that's been done.
  refetchOnce(thumbPage: number, priority = PRIORITY_DEMAND): Promise<ThumbPageData> | null {
    if (this.#refetched.has(thumbPage)) return null;
    this.#refetched.add(thumbPage);
    const pending = this.#pending.get(thumbPage);
    if (pending) {
      pending.demanded = true;
      return pending.promise;
    }
    return this.#request(thumbPage, priority, true);
  }

  #request(thumbPage: number, priority: number, demanded: boolean, owner?: string): Promise<ThumbPageData> {
    const controller = new AbortController();
    const promise = this.#load(thumbPage, priority, controller.signal).then(
      (data) => {
        this.#store.set(data);
        return data;
      },
    );
    const pending: Pending = { promise, controller, demanded, wantedBy: new Set(owner ? [owner] : []) };
    this.#pending.set(thumbPage, pending);
    const settle = () => {
      if (this.#pending.get(thumbPage) === pending) this.#pending.delete(thumbPage);
    };
    promise.then(settle, settle);
    return promise;
  }
}
