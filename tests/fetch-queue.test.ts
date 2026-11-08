import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FetchQueue, HttpError } from "../src/site/fetchQueue";

// A fetch whose responses resolve only when the test says so.
function controlledFetch() {
  const calls: { url: string; init: RequestInit | undefined; respond: (status?: number, text?: string) => void }[] = [];
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    return new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      calls.push({
        url,
        init,
        respond: (status = 200, text = `body of ${url}`) => {
          const response = new Response(text, { status });
          Object.defineProperty(response, "url", { value: url });
          resolve(response);
        },
      });
    });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const queueWith = (fetch: typeof globalThis.fetch, gapMs = 500) => new FetchQueue({ gapMs, fetch, now: () => Date.now() });

describe("FetchQueue", () => {
  it("runs one request at a time", async () => {
    const { fetch, calls } = controlledFetch();
    const queue = queueWith(fetch, 0);
    const a = queue.get("https://e-hentai.org/a");
    const b = queue.get("https://e-hentai.org/b");
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.map((c) => c.url)).toEqual(["https://e-hentai.org/a"]);
    calls[0]!.respond();
    expect(await a).toEqual({ url: "https://e-hentai.org/a", text: "body of https://e-hentai.org/a" });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    calls[1]!.respond();
    await b;
  });

  it("waits the gap after a request finishes before starting the next", async () => {
    const { fetch, calls } = controlledFetch();
    const queue = queueWith(fetch, 500);
    void queue.get("https://e-hentai.org/a");
    void queue.get("https://e-hentai.org/b");
    await vi.advanceTimersByTimeAsync(0);
    calls[0]!.respond();
    await vi.advanceTimersByTimeAsync(499);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
  });

  it("runs higher priority first, then in arrival order", async () => {
    const { fetch, calls } = controlledFetch();
    const queue = queueWith(fetch, 0);
    void queue.get("https://e-hentai.org/first");
    void queue.get("https://e-hentai.org/low1");
    void queue.get("https://e-hentai.org/high", { priority: 1 });
    void queue.get("https://e-hentai.org/low2");
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(0);
      calls[i]!.respond();
    }
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["first", "high", "low1", "low2"]);
  });

  it("drops a queued request when its signal aborts", async () => {
    const { fetch, calls } = controlledFetch();
    const queue = queueWith(fetch, 0);
    void queue.get("https://e-hentai.org/a");
    const controller = new AbortController();
    const dropped = queue.get("https://e-hentai.org/b", { signal: controller.signal });
    controller.abort();
    await expect(dropped).rejects.toMatchObject({ name: "AbortError" });
    expect(queue.size).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    calls[0]!.respond();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(1);
  });

  it("cancels a running request when its signal aborts", async () => {
    const { fetch } = controlledFetch();
    const controller = new AbortController();
    const running = queueWith(fetch, 0).get("https://e-hentai.org/a", { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects right away when the signal is already aborted", async () => {
    const { fetch, calls } = controlledFetch();
    await expect(queueWith(fetch).get("https://e-hentai.org/a", { signal: AbortSignal.abort() })).rejects.toBeDefined();
    expect(calls).toHaveLength(0);
  });

  it("rejects HTTP errors and carries on", async () => {
    const { fetch, calls } = controlledFetch();
    const queue = queueWith(fetch, 0);
    const failed = queue.get("https://e-hentai.org/a");
    const next = queue.get("https://e-hentai.org/b");
    await vi.advanceTimersByTimeAsync(0);
    calls[0]!.respond(404);
    await expect(failed).rejects.toEqual(new HttpError(404, "https://e-hentai.org/a"));
    await vi.advanceTimersByTimeAsync(0);
    calls[1]!.respond();
    await expect(next).resolves.toBeDefined();
  });

  it("uses the browser session and nothing else", async () => {
    const { fetch, calls } = controlledFetch();
    void queueWith(fetch).get("https://e-hentai.org/a");
    await vi.advanceTimersByTimeAsync(0);
    expect(calls[0]!.init).toEqual({ credentials: "same-origin", signal: undefined });
  });
});
