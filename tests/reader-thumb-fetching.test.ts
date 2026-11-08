// Which thumbnail pages the filmstrip and grid fetch, and when, through the real fetch queue.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThumbPreloader } from "../src/content/gallery/thumbPreloader";
import { ThumbStore } from "../src/content/gallery/thumbStore";
import { ReaderHistory } from "../src/content/reader/history";
import { PageSource } from "../src/content/reader/pageSource";
import { Reader } from "../src/content/reader/reader";
import { FETCH_DELAY_MS } from "../src/content/reader/thumbGallery";
import { FetchQueue } from "../src/site/fetchQueue";
import { DEFAULT_SETTINGS } from "../src/shared/settings";
import { fakeHistory, GID, hrefOf, imagePageHtml, ORIGIN, PER_PAGE, thumbPage } from "./reader-fakes";

const PAGES = 526;
const GALLERY = `${ORIGIN}/g/${GID}/abcdef0123/`;
const GAP_MS = 10;
const opened: Reader[] = [];

// A site whose responses wait until released, one request at a time, so the order the queue
// sends them in shows.
function gatedSite() {
  const sent: string[] = [];
  const waiting: (() => void)[] = [];
  const fetch = ((input: RequestInfo | URL) => {
    const url = String(input);
    sent.push(url);
    const thumbPageMatch = /\?p=(\d+)$/.exec(url);
    const page = /-(\d+)$/.exec(url);
    const body = thumbPageMatch ? "<html></html>" : imagePageHtml(Number(page?.[1] ?? 1), PAGES);
    return new Promise<Response>((resolve) => {
      waiting.push(() => {
        const response = new Response(body);
        Object.defineProperty(response, "url", { value: url });
        resolve(response);
      });
    });
  }) as typeof globalThis.fetch;
  // A gap, like the real queue's, so what a response starts is queued before the next request.
  const queue = new FetchQueue({ gapMs: GAP_MS, fetch });
  const store = new ThumbStore(GID, null);
  store.set(thumbPage(0, PAGES));
  const preloader = new ThumbPreloader({
    store,
    thumbPageCount: Math.ceil(PAGES / PER_PAGE),
    load: async (p, priority, signal) => {
      await queue.get(`${GALLERY}?p=${p}`, { priority, signal });
      return thumbPage(p, PAGES);
    },
  });
  const source = new PageSource({ gid: GID, pageCount: PAGES, perPage: PER_PAGE, store, preloader, queue });
  const reader = new Reader({
    doc: document,
    source,
    store,
    history: new ReaderHistory(fakeHistory(GALLERY).history, () => new URL(GALLERY)),
    settings: () => structuredClone(DEFAULT_SETTINGS),
    title: "Sample Gallery Title",
  });
  opened.push(reader);
  // Answers the oldest request still waiting, then lets the queue send the next one.
  const release = async () => {
    waiting.shift()?.();
    await vi.advanceTimersByTimeAsync(GAP_MS);
  };
  const thumbPagesSent = () => sent.flatMap((url) => /\?p=(\d+)$/.exec(url)?.[1] ?? []).map(Number);
  return { reader, sent, release, thumbPagesSent };
}

afterEach(() => {
  opened.splice(0).forEach((reader) => reader.close());
  vi.useRealTimers();
  document.body.innerHTML = "";
  document.documentElement.style.overflow = "";
});

describe("Reader thumbnail fetching", () => {
  it("fetches the filmstrip's thumbnails around a deep page before preloading further images", async () => {
    vi.useFakeTimers();
    const { reader, sent, release } = gatedSite();
    reader.open(263);
    reader.toggleFilmstrip();
    await vi.advanceTimersByTimeAsync(FETCH_DELAY_MS);
    // The thumbnail page that locates page 263, then page 263's image page.
    await release();
    await release();
    expect(sent.slice(0, 2)).toEqual([`${GALLERY}?p=13`, hrefOf(263)]);
    // Next: the thumbnail pages around 263 that the filmstrip shows, before any preloading.
    await release();
    expect(sent.slice(2, 4)).toEqual([`${GALLERY}?p=14`, `${GALLERY}?p=12`]);
  });

  it("fetches the grid's thumbnail pages nearest the current page first", async () => {
    vi.useFakeTimers();
    const { reader, release, thumbPagesSent } = gatedSite();
    reader.open(263);
    await release(); // thumbnail page 13
    for (let i = 0; i < 20; i++) await release(); // page 263 and everything it preloads
    reader.toggleGrid();
    await vi.advanceTimersByTimeAsync(FETCH_DELAY_MS);
    for (let i = 0; i < 10; i++) await release();
    const panel = thumbPagesSent().slice(1);
    expect(panel.length).toBeGreaterThan(2);
    // Each one is at least as near thumbnail page 13 as the one before it.
    const distances = panel.map((p) => Math.abs(p - 13));
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it("drops the queued thumbnail pages the grid scrolled away from", async () => {
    vi.useFakeTimers();
    const { reader, release, thumbPagesSent } = gatedSite();
    reader.open(263);
    await release();
    for (let i = 0; i < 20; i++) await release();
    reader.toggleGrid();
    await vi.advanceTimersByTimeAsync(FETCH_DELAY_MS);
    await release(); // the grid's first thumbnail page arrives; the next one is sent
    const sentBefore = thumbPagesSent().length;
    // Scrolled back to the start of the gallery while the rest wait in the queue.
    const scroller = reader.shadowRoot!.querySelector<HTMLElement>(".thumbs.grid .thumb-scroll")!;
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(FETCH_DELAY_MS + 50);
    for (let i = 0; i < 10; i++) await release();
    const afterScroll = thumbPagesSent().slice(sentBefore);
    expect(afterScroll.length, String(afterScroll)).toBeGreaterThan(0);
    // Only thumbnail pages near the top of the gallery, none of the ones left behind near 13.
    expect(afterScroll.every((p) => p < 6), String(afterScroll)).toBe(true);
  });
});

describe("Reader thumbnails stored with dead picture URLs", () => {
  // Thumbnail pages kept from an earlier visit in the tab, whose picture URLs have expired since.
  function staleSite() {
    const store = new ThumbStore(GID, null);
    const withUrl = (p: number, url: string) => {
      const data = thumbPage(p, PAGES);
      for (const thumb of data.thumbs) thumb.sprite = { ...thumb.sprite!, url };
      return data;
    };
    for (const p of [0, 12, 13, 14]) store.set(withUrl(p, `https://x.hath.network/c2/old/${GID}-${p}.webp`));
    const loads: number[] = [];
    const preloader = new ThumbPreloader({
      store,
      thumbPageCount: Math.ceil(PAGES / PER_PAGE),
      load: async (p) => {
        loads.push(p);
        return withUrl(p, `https://x.hath.network/c2/new/${GID}-${p}.webp`);
      },
    });
    const queue = new FetchQueue({ gapMs: 0, fetch: (async () => new Response("")) as typeof globalThis.fetch });
    const source = new PageSource({ gid: GID, pageCount: PAGES, perPage: PER_PAGE, store, preloader, queue });
    const reader = new Reader({
      doc: document,
      source,
      store,
      history: new ReaderHistory(fakeHistory(GALLERY).history, () => new URL(GALLERY)),
      settings: () => structuredClone(DEFAULT_SETTINGS),
      title: "Sample Gallery Title",
    });
    opened.push(reader);
    const sprite = (page: number) => reader.shadowRoot!.querySelector<HTMLElement>(`.thumbs:not([hidden]) .cell[data-page="${page}"] .sprite`);
    const spriteUrl = (page: number) => sprite(page)?.querySelector("img")?.getAttribute("src") ?? "";
    // The browser failing every drawn picture whose URL matches.
    const fail = (pattern: string) => {
      for (const img of reader.shadowRoot!.querySelectorAll<HTMLImageElement>(".thumbs .sprite img")) {
        if (img.getAttribute("src")!.includes(pattern)) img.dispatchEvent(new Event("error"));
      }
    };
    return { reader, loads, spriteUrl, fail };
  }

  it("fetches a thumbnail page again when its pictures fail to load, and draws the new ones", async () => {
    vi.useFakeTimers();
    const { reader, loads, spriteUrl, fail } = staleSite();
    reader.open(263);
    reader.toggleFilmstrip();
    fail("/old/");
    await vi.advanceTimersByTimeAsync(FETCH_DELAY_MS + 100);
    expect(spriteUrl(263)).toContain("/new/");
    expect(spriteUrl(250)).toContain("/new/"); // thumbnail page 12, also on screen
    expect(loads.sort((a, b) => a - b)).toEqual([12, 13, 14]);
  });

  it("fetches nothing more while the stored pictures load", async () => {
    vi.useFakeTimers();
    const { reader, loads, spriteUrl } = staleSite();
    reader.open(263);
    reader.toggleFilmstrip();
    await vi.advanceTimersByTimeAsync(FETCH_DELAY_MS + 100);
    expect(spriteUrl(263)).toContain("/old/");
    expect(loads).toEqual([]);
  });

  it("fetches a thumbnail page again only once, even if the new pictures fail too", async () => {
    vi.useFakeTimers();
    const { reader, loads, fail } = staleSite();
    reader.open(263);
    reader.toggleFilmstrip();
    fail("/old/");
    await vi.advanceTimersByTimeAsync(FETCH_DELAY_MS + 100);
    fail("/new/");
    reader.toggleFilmstrip();
    reader.toggleGrid();
    fail("/");
    await vi.advanceTimersByTimeAsync(FETCH_DELAY_MS + 100);
    expect(loads.filter((p) => p === 13)).toEqual([13]);
  });
});
