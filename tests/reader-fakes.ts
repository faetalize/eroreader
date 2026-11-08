// Fakes shared by the reader tests.
import type { HistoryLike } from "../src/content/reader/history";
import { ThumbPreloader } from "../src/content/gallery/thumbPreloader";
import { ThumbStore, type ThumbPageData } from "../src/content/gallery/thumbStore";
import { PageSource } from "../src/content/reader/pageSource";
import { FetchQueue } from "../src/site/fetchQueue";
import type { Thumb } from "../src/site/gallery";
import { fixture } from "./fixtures";

export const ORIGIN = "https://exhentai.org";
export const GID = 7654321;
export const PER_PAGE = 20;

export const hrefOf = (page: number) => `${ORIGIN}/s/${page.toString(16).padStart(10, "0")}/${GID}-${page}`;
export const imageOf = (page: number, server = 0) => `https://abcdefghij.hath.network/h/${server}/${page}.jpg`;

// Every fifth page is wide (a landscape thumbnail) unless `isWide` says otherwise.
export const everyFifthWide = (page: number) => page % 5 === 0;

export function thumbPage(thumbPage: number, pageCount: number, isWide = everyFifthWide): ThumbPageData {
  const thumbs: Thumb[] = [];
  for (let page = thumbPage * PER_PAGE + 1; page <= Math.min(pageCount, (thumbPage + 1) * PER_PAGE); page++) {
    thumbs.push({ page, imgkey: "k", href: hrefOf(page), filename: `${page}.jpg`, sprite: { url: "s", x: 0, y: 0, width: 200, height: isWide(page) ? 140 : 280 } });
  }
  return { thumbPage, thumbs };
}

// The image page fixture rewritten for one page.
export function imagePageHtml(page: number, pageCount: number, options: { imageUrl?: string; nlKey?: string; width?: number; height?: number } = {}): string {
  const doc = fixture("image-page.html");
  doc.querySelector("#img")!.setAttribute("src", options.imageUrl ?? imageOf(page));
  doc.querySelector("#loadfail")!.setAttribute("onclick", `return nl('${options.nlKey ?? `nl-${page}`}')`);
  doc.querySelector("#i4 > div")!.textContent = `${page}.jpg :: ${options.width ?? 1280} x ${options.height ?? 1810} :: 300 KiB`;
  doc.querySelectorAll("a#prev").forEach((a) => a.setAttribute("href", hrefOf(Math.max(1, page - 1))));
  doc.querySelectorAll("a#next").forEach((a) => a.setAttribute("href", hrefOf(Math.min(pageCount, page + 1))));
  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
}

// A site that serves image pages by URL, and thumbnail pages through the preloader.
export function fakeSite(pageCount: number, { knownThumbPages = [0] as number[], isWide = everyFifthWide } = {}) {
  const requested: string[] = [];
  const pages = new Map<string, string>();
  for (let page = 1; page <= pageCount; page++) pages.set(hrefOf(page), imagePageHtml(page, pageCount));
  const fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    const body = pages.get(url);
    const response = new Response(body ?? "missing", { status: body ? 200 : 404 });
    Object.defineProperty(response, "url", { value: url });
    return response;
  }) as typeof globalThis.fetch;
  const queue = new FetchQueue({ gapMs: 0, fetch });
  const store = new ThumbStore(GID, null);
  for (const p of knownThumbPages) store.set(thumbPage(p, pageCount, isWide));
  const thumbLoads: number[] = [];
  const preloader = new ThumbPreloader({
    store,
    thumbPageCount: Math.ceil(pageCount / PER_PAGE),
    load: async (p) => {
      thumbLoads.push(p);
      return thumbPage(p, pageCount, isWide);
    },
  });
  const source = new PageSource({ gid: GID, pageCount, perPage: PER_PAGE, store, preloader, queue });
  return { source, store, pages, requested, thumbLoads };
}

// Session history as a list of entries, like the browser's.
export function fakeHistory(start: string) {
  const entries: { state: unknown; url: string }[] = [{ state: null, url: start }];
  let index = 0;
  const calls: string[] = [];
  const history: HistoryLike = {
    get state() {
      return entries[index]!.state;
    },
    pushState(state, _unused, url) {
      entries.splice(index + 1);
      entries.push({ state, url: String(url) });
      index++;
      calls.push(`push ${url}`);
    },
    replaceState(state, _unused, url) {
      entries[index] = { state, url: String(url) };
      calls.push(`replace ${url}`);
    },
    back() {
      index = Math.max(0, index - 1);
      calls.push("back");
    },
  };
  return { history, entries, calls, url: () => new URL(entries[index]!.url), index: () => index };
}

