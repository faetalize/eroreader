import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProgressTracker, SETTLE_MS, type ProgressApi } from "../src/content/progressTracker";
import { emptyProgress, type ProgressRecord } from "../src/shared/progress";

const gallery = { gid: 7654321, token: "abcdef0123", host: "exhentai.org", title: "Sample Gallery Title", pageCount: 20 };

function fakeApi(stored: ProgressRecord | null = null) {
  let release: () => void = () => {};
  const loaded = new Promise<void>((resolve) => (release = resolve));
  const puts: ProgressRecord[] = [];
  const api: ProgressApi = {
    get: async () => {
      await loaded;
      return stored;
    },
    put: async (record) => {
      puts.push(record);
    },
  };
  return { api, puts, release };
}

const flushPromises = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("ProgressTracker", () => {
  it("saves a page once the reader settles on it", async () => {
    const { api, puts, release } = fakeApi();
    release();
    const tracker = new ProgressTracker(api, gallery, () => 1000);
    for (const page of [3, 4, 5, 6]) tracker.pageShown(page);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(puts.map((r) => r.page)).toEqual([6]);
    expect(puts[0]).toMatchObject({ ...gallery, page: 6, finished: false, updatedAt: 1000 });
  });

  it("keeps the furthest page read when going back to reread, until a reset", async () => {
    const { api, puts, release } = fakeApi({ ...emptyProgress(gallery), page: 15, furthest: 15 });
    release();
    const tracker = new ProgressTracker(api, gallery);
    tracker.pageShown(3);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(puts.at(-1)).toMatchObject({ page: 3, furthest: 15 });
    tracker.pageShown(17);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(puts.at(-1)).toMatchObject({ page: 17, furthest: 17 });
    await tracker.reset();
    expect(puts.at(-1)).toMatchObject({ page: 0, furthest: 0 });
  });

  it("marks the gallery finished at the last page, right away", async () => {
    const { api, puts, release } = fakeApi();
    release();
    const tracker = new ProgressTracker(api, gallery);
    tracker.pageShown(20);
    await flushPromises();
    expect(puts.map((r) => [r.page, r.finished])).toEqual([[20, true]]);
    tracker.pageShown(5);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(tracker.record).toMatchObject({ page: 5, finished: true }); // reading back doesn't unfinish it
  });

  it("writes a pending page on flush", async () => {
    const { api, puts, release } = fakeApi();
    release();
    const tracker = new ProgressTracker(api, gallery);
    tracker.pageShown(7);
    await tracker.flush();
    expect(puts.map((r) => r.page)).toEqual([7]);
  });

  it("waits for the stored record before changing it", async () => {
    const stored = { ...emptyProgress(gallery), page: 12, rtl: true, repairPoints: [9], title: "Old title", pageCount: 18 };
    const { api, puts, release } = fakeApi(stored);
    const tracker = new ProgressTracker(api, gallery);
    tracker.pageShown(13);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(puts).toEqual([]);
    release();
    await flushPromises();
    // Keeps the stored direction and re-pair points, and takes the current title and page count.
    expect(puts.at(-1)).toMatchObject({ page: 13, rtl: true, repairPoints: [9], title: "Sample Gallery Title", pageCount: 20 });
  });

  it("saves a direction change right away", async () => {
    const { api, puts, release } = fakeApi();
    release();
    await new ProgressTracker(api, gallery).setRtl(true);
    expect(puts.map((r) => r.rtl)).toEqual([true]);
  });

  it("saves the spread offset and re-pair points right away, sorted", async () => {
    const { api, puts, release } = fakeApi();
    release();
    await new ProgressTracker(api, gallery).setSpreads(true, [12, 4]);
    expect(puts.map((r) => [r.spreadOffset, r.repairPoints])).toEqual([[true, [4, 12]]]);
  });

  it("resets progress but keeps the gallery's direction and spread settings", async () => {
    const { api, puts, release } = fakeApi({ ...emptyProgress(gallery), page: 12, finished: true, rtl: true, spreadOffset: true, repairPoints: [9] });
    release();
    const tracker = new ProgressTracker(api, gallery);
    tracker.pageShown(14);
    await tracker.reset();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ page: 0, finished: false, rtl: true, spreadOffset: true, repairPoints: [9] });
  });

  it("marks finished on request and tells listeners", async () => {
    const { api, release } = fakeApi();
    release();
    const tracker = new ProgressTracker(api, gallery);
    const seen = vi.fn();
    tracker.subscribe(seen);
    await tracker.markFinished();
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ finished: true }));
  });

  it("tells finish listeners once, when the gallery becomes finished, even as the first change", async () => {
    const { api, release } = fakeApi();
    const tracker = new ProgressTracker(api, gallery);
    const finished = vi.fn();
    tracker.onFinished(finished);
    tracker.pageShown(20); // before the stored record has even arrived
    release();
    await flushPromises();
    await tracker.markFinished();
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it("doesn't tell finish listeners about a gallery that was already finished", async () => {
    const { api, release } = fakeApi({ ...emptyProgress(gallery), page: 20, finished: true });
    release();
    const tracker = new ProgressTracker(api, gallery);
    const finished = vi.fn();
    tracker.onFinished(finished);
    await tracker.markFinished();
    expect(finished).not.toHaveBeenCalled();
  });

  it("keeps working when storage fails", async () => {
    const api: ProgressApi = { get: async () => Promise.reject(new Error("gone")), put: async () => Promise.reject(new Error("gone")) };
    const tracker = new ProgressTracker(api, gallery);
    await expect(tracker.setRtl(true)).resolves.toBeUndefined();
    expect(tracker.record.rtl).toBe(true);
  });
});
