import { describe, expect, it, vi } from "vitest";
import { ThumbPreloader, windowOrder } from "../src/content/gallery/thumbPreloader";
import { ThumbStore, type ThumbPageData } from "../src/content/gallery/thumbStore";

const data = (thumbPage: number): ThumbPageData => ({ thumbPage, thumbs: [] });

// A loader whose requests resolve when the test says so.
function controlledLoader() {
  const requests: { thumbPage: number; priority: number; signal: AbortSignal; resolve: () => void; reject: (e: unknown) => void }[] = [];
  const load = vi.fn(
    (thumbPage: number, priority: number, signal: AbortSignal) =>
      new Promise<ThumbPageData>((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        requests.push({ thumbPage, priority, signal, resolve: () => resolve(data(thumbPage)), reject });
      }),
  );
  return { load, requests };
}

describe("windowOrder", () => {
  it("goes nearest first, forward before back, within the gallery", () => {
    expect(windowOrder(5, 2, 9)).toEqual([6, 4, 7, 3]);
    expect(windowOrder(0, 2, 9)).toEqual([1, 2]);
    expect(windowOrder(8, 2, 9)).toEqual([7, 6]);
    expect(windowOrder(0, 2, 1)).toEqual([]);
  });
});

describe("ThumbPreloader", () => {
  it("fetches the window around the current thumbnail page, skipping stored ones", () => {
    const store = new ThumbStore(1, null);
    store.set(data(4));
    const { load, requests } = controlledLoader();
    new ThumbPreloader({ store, thumbPageCount: 9, load }).focus(5);
    expect(requests.map((r) => r.thumbPage)).toEqual([6, 7, 3]);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("stores what it fetched", async () => {
    const store = new ThumbStore(1, null);
    const { load, requests } = controlledLoader();
    const preloader = new ThumbPreloader({ store, thumbPageCount: 9, load });
    preloader.focus(0);
    requests[0]!.resolve();
    await expect(preloader.ensure(1)).resolves.toEqual(data(1));
    expect(store.has(1)).toBe(true);
    expect(load).toHaveBeenCalledTimes(2); // ensure(1) needed no new request
  });

  it("cancels window requests that fall outside the moved window, keeping the rest", () => {
    const { load, requests } = controlledLoader();
    const preloader = new ThumbPreloader({ store: new ThumbStore(1, null), thumbPageCount: 20, load });
    preloader.focus(0); // 1, 2
    preloader.focus(4); // window 2..6: keeps 2, cancels 1, adds 5, 3, 6
    expect(requests.find((r) => r.thumbPage === 1)!.signal.aborted).toBe(true);
    expect(requests.find((r) => r.thumbPage === 2)!.signal.aborted).toBe(false);
    expect(requests.map((r) => r.thumbPage)).toEqual([1, 2, 5, 3, 6]);
  });

  it("never cancels a page someone is waiting for", () => {
    const { requests, load } = controlledLoader();
    const preloader = new ThumbPreloader({ store: new ThumbStore(1, null), thumbPageCount: 20, load });
    preloader.focus(0);
    void preloader.ensure(1);
    preloader.focus(10);
    expect(requests.find((r) => r.thumbPage === 1)!.signal.aborted).toBe(false);
  });

  it("fetches what an owner wants in its order, dropping what it stops wanting", () => {
    const { load, requests } = controlledLoader();
    const preloader = new ThumbPreloader({ store: new ThumbStore(1, null), thumbPageCount: 20, load });
    preloader.want("grid", [13, 14, 12], 2);
    expect(requests.map((r) => [r.thumbPage, r.priority])).toEqual([[13, 2], [14, 2], [12, 2]]);
    preloader.want("grid", [1, 13], 2);
    expect(requests.filter((r) => r.signal.aborted).map((r) => r.thumbPage)).toEqual([14, 12]);
    expect(requests.map((r) => r.thumbPage)).toEqual([13, 14, 12, 1]);
  });

  it("keeps a page another owner, the window or a waiting caller still wants", () => {
    const { load, requests } = controlledLoader();
    const preloader = new ThumbPreloader({ store: new ThumbStore(1, null), thumbPageCount: 20, load });
    preloader.focus(0); // 1, 2
    preloader.want("filmstrip", [2, 7, 8], 2);
    preloader.want("grid", [7], 2);
    void preloader.ensure(8);
    preloader.want("filmstrip", [], 2);
    preloader.focus(10);
    const aborted = (page: number) => requests.find((r) => r.thumbPage === page)!.signal.aborted;
    expect([aborted(1), aborted(2), aborted(7), aborted(8)]).toEqual([true, true, false, false]);
  });

  it("fetches pages outside the window on demand, with priority, once", async () => {
    const { requests, load } = controlledLoader();
    const preloader = new ThumbPreloader({ store: new ThumbStore(1, null), thumbPageCount: 20, load });
    const a = preloader.ensure(15);
    const b = preloader.ensure(15);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.priority).toBeGreaterThan(0);
    requests[0]!.resolve();
    expect(await a).toBe(await b);
  });

  it("asks again after a failed request", async () => {
    const { requests, load } = controlledLoader();
    const preloader = new ThumbPreloader({ store: new ThumbStore(1, null), thumbPageCount: 20, load });
    const failed = preloader.ensure(15);
    requests[0]!.reject(new Error("offline"));
    await expect(failed).rejects.toThrow("offline");
    void preloader.ensure(15);
    expect(requests).toHaveLength(2);
  });
});
