import { afterEach, describe, expect, it, vi } from "vitest";
import { GalleryTakeover } from "../src/content/gallery/takeover";
import { ThumbPreloader } from "../src/content/gallery/thumbPreloader";
import { ThumbStore, type ThumbPageData } from "../src/content/gallery/thumbStore";
import { parseGallery } from "../src/site/gallery";
import { fixture } from "./fixtures";

const BASE = "https://e-hentai.org/g/1234567/0123456789/";
const started: GalleryTakeover[] = [];
const lastPage = parseGallery(fixture("eh-gallery-p8.html"), new URL(`${BASE}?p=8`))!;

// Thumbnail page 8 with its picture URLs moved to `folder`, e.g. "old" for URLs that have expired.
const lastPageAt = (folder: string): ThumbPageData => ({
  thumbPage: 8,
  thumbs: lastPage.thumbs.map((thumb) => ({ ...thumb, sprite: { ...thumb.sprite!, url: `https://x.hath.network/c2/${folder}/1234567-8.webp` } })),
});

function setup({ fail = false, prompt = null as string | null, stale = false } = {}) {
  document.body.innerHTML = fixture("eh-gallery-p0.html").body.innerHTML;
  let url = new URL(`${BASE}#page=3`);
  const gallery = parseGallery(document, url)!;
  const store = new ThumbStore(gallery.gid, null);
  // Stale: page 8 kept from earlier in the tab, and the site now serves new picture URLs.
  if (stale) store.set(lastPageAt("old"));
  const load = vi.fn(async (thumbPage: number): Promise<ThumbPageData> => {
    if (fail) throw new Error("offline");
    if (stale && thumbPage === 8) return lastPageAt("new");
    return { thumbPage, thumbs: thumbPage === 8 ? lastPage.thumbs : [] };
  });
  const preloader = new ThumbPreloader({ store, thumbPageCount: gallery.thumbPageCount, load });
  const replaced: string[] = [];
  const navigated: string[] = [];
  const takeover = new GalleryTakeover({
    doc: document,
    gallery,
    store,
    preloader,
    currentUrl: () => new URL(url),
    replaceUrl: (next) => {
      replaced.push(next.href);
      url = next;
    },
    navigate: (next) => navigated.push(next),
    prompt: () => prompt,
  });
  takeover.start();
  started.push(takeover);
  return { takeover, load, replaced, navigated };
}

function click(el: Element) {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  el.dispatchEvent(event);
  return event;
}

const cellWithText = (selector: string, text: string) =>
  [...document.querySelectorAll(`${selector} td`)].find((td) => td.textContent === text)!;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// Takeovers listen on the shared document, so each test's must go before the next test.
afterEach(() => {
  started.splice(0).forEach((takeover) => takeover.stop());
  document.body.innerHTML = "";
});

describe("GalleryTakeover", () => {
  it("preloads the thumbnail pages next to the current one on start", () => {
    const { load } = setup();
    expect(load.mock.calls.map((call) => call[0])).toEqual([1, 2]);
  });

  it("swaps the grid, the paginators and the count in place", async () => {
    const { replaced, navigated } = setup();
    const event = click(cellWithText("table.ptt", "9").querySelector("a")!);
    expect(event.defaultPrevented).toBe(true);
    await settle();

    const shown = parseGallery(document, new URL(`${BASE}?p=8`))!;
    expect(shown.thumbs).toEqual(lastPage.thumbs);
    expect(document.querySelector(".gpc")!.textContent).toBe("Showing 161 - 172 of 172 images");
    for (const table of document.querySelectorAll("table.ptt, table.ptb")) {
      expect(table.querySelector(".ptds")!.textContent).toBe("9");
    }
    expect(replaced).toEqual([`${BASE}?p=8#page=3`]);
    expect(navigated).toEqual([]);
  });

  it("fetches a kept thumbnail page again when its pictures fail to load, once", async () => {
    const { load } = setup({ stale: true });
    click(cellWithText("table.ptt", "9").querySelector("a")!);
    await settle();
    const drawn = () => [...document.querySelectorAll<HTMLElement>("#gdt > a > div")].map((cell) => cell.querySelector("img")?.getAttribute("src") ?? "");
    const fail = (folder: string) => {
      for (const img of document.querySelectorAll<HTMLImageElement>("#gdt img")) if (img.getAttribute("src")!.includes(`/${folder}/`)) img.dispatchEvent(new Event("error"));
    };
    expect(drawn().every((url) => url.includes("/old/"))).toBe(true);
    expect(load).not.toHaveBeenCalledWith(8, expect.anything(), expect.anything());
    fail("old");
    await settle();
    expect(load.mock.calls.filter(([page]) => page === 8)).toHaveLength(1);
    expect(drawn().every((url) => url.includes("/new/"))).toBe(true);
    expect(parseGallery(document, new URL(`${BASE}?p=8`))!.thumbs).toEqual(lastPageAt("new").thumbs);
    fail("new");
    await settle();
    expect(load.mock.calls.filter(([page]) => page === 8)).toHaveLength(1);
  });

  it("shows the thumbnail page holding the last page read, its thumbnail in view, after the reader", async () => {
    const { takeover, replaced } = setup();
    const scrolled: string[] = [];
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(function (this: HTMLElement) {
      scrolled.push(this.getAttribute("href") ?? this.className);
    });
    // In view only below the fold, as happy-dom has no layout.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: 5000, bottom: 5100, left: 0, right: 100, width: 100, height: 100, x: 0, y: 5000, toJSON: () => ({}) });
    await takeover.reveal(165);
    expect(takeover.currentThumbPage).toBe(8);
    expect(replaced.at(-1)).toBe(`${BASE}?p=8#page=3`);
    expect(scrolled.at(-1)).toMatch(/-165$/);
    vi.restoreAllMocks();
  });

  it("leaves the gallery as it was when the last page's thumbnail is already in view", async () => {
    const { takeover, replaced, load } = setup();
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    await takeover.reveal(3);
    expect(takeover.currentThumbPage).toBe(0);
    expect(replaced).toEqual([]);
    expect(scroll).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(2); // only the window around page 0, from start()
    vi.restoreAllMocks();
  });

  it("stays put when the last page's thumbnail page can't be fetched", async () => {
    const { takeover, navigated } = setup({ fail: true });
    await takeover.reveal(165);
    expect(takeover.currentThumbPage).toBe(0);
    expect(navigated).toEqual([]);
  });

  it("handles clicks on the cell around the link and on the bottom paginator", async () => {
    const { takeover } = setup();
    click(cellWithText("table.ptb", "9"));
    await settle();
    expect(takeover.currentThumbPage).toBe(8);
  });

  it("drops p from the URL on the first thumbnail page", async () => {
    const { takeover, replaced } = setup();
    await takeover.show(8);
    click(cellWithText("table.ptt", "1").querySelector("a")!);
    await settle();
    expect(replaced.at(-1)).toBe(`${BASE}#page=3`);
  });

  it("asks which page to jump to from the ellipsis", async () => {
    const { takeover } = setup({ prompt: "9" });
    click(cellWithText("table.ptt", "..."));
    await settle();
    expect(takeover.currentThumbPage).toBe(8);
  });

  it("falls back to the site's own navigation when a fetch fails", async () => {
    const { takeover, navigated } = setup({ fail: true });
    await takeover.show(8);
    expect(navigated).toEqual([`${BASE}?p=8`]);
    expect(takeover.currentThumbPage).toBe(0);
  });

  it("leaves modified clicks and thumbnail clicks alone", () => {
    setup();
    const link = cellWithText("table.ptt", "2").querySelector("a")!;
    const modified = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
    link.dispatchEvent(modified);
    expect(modified.defaultPrevented).toBe(false);
    expect(click(document.querySelector("#gdt a")!).defaultPrevented).toBe(false);
  });

  it("stops intercepting once stopped", async () => {
    const { takeover } = setup();
    // The site's own inline handlers run again: the click reaches the page's listeners.
    const reached = vi.fn();
    document.addEventListener("click", reached);
    click(cellWithText("table.ptt", "2").querySelector("a")!);
    expect(reached).not.toHaveBeenCalled();
    takeover.stop();
    click(cellWithText("table.ptt", "2").querySelector("a")!);
    expect(reached).toHaveBeenCalledOnce();
    document.removeEventListener("click", reached);
  });
});
