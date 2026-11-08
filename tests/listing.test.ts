import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyBadge, applyBadges, badgeText } from "../src/content/listing/badges";
import { ImageReleaser, releaseImage, restoreImage } from "../src/content/listing/imageRelease";
import { InfiniteScroll, markCard, readSnapshot, SNAPSHOT_KEY, SNAPSHOT_MAX_AGE_MS } from "../src/content/listing/infiniteScroll";
import { createThumbLoader, planFrames, ScrubPreview, scrubSpots, thumbIndexAt } from "../src/content/listing/scrub";
import { renderPager, renderThumbs } from "../src/content/gallery/render";
import { FetchQueue } from "../src/site/fetchQueue";
import { matchSearches, SearchDropdown } from "../src/content/listing/searchDropdown";
import { emptyProgress, type ProgressRecord } from "../src/shared/progress";
import type { SearchEntry } from "../src/shared/searches";
import type { GalleryPage, Thumb } from "../src/site/gallery";
import { parseHtml } from "../src/site/html";
import { parseListing } from "../src/site/listing";
import { fixture, fixtureText } from "./fixtures";

const BASE = new URL("https://exhentai.org/?f_search=sample+query");
const P2 = "https://exhentai.org/?f_search=sample+query&next=2222001";

function loadPage(name = "ex-listing-thumb-p1.html") {
  document.body.innerHTML = fixture(name).body.innerHTML;
  const listing = parseListing(document, BASE);
  listing.cards.forEach(markCard);
  return listing;
}

const progress = (gid: number, page: number, pageCount: number, finished = false): ProgressRecord => ({
  ...emptyProgress({ gid, token: "t", host: "exhentai.org", title: "T", pageCount }),
  page,
  finished,
});

afterEach(() => {
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("badges", () => {
  it("puts the progress over the cover's corner in Thumbnail mode", () => {
    const { cards } = loadPage();
    applyBadges(cards, [progress(cards[0]!.gid, 34, 181)]);
    const badge = cards[0]!.element.querySelector(".eroreader-badge")!;
    expect(badge.textContent).toBe("34/181");
    expect(badge.parentElement!.classList.contains("gl3t")).toBe(true);
    expect(badge.classList.contains("overlay")).toBe(true);
    expect(cards[1]!.element.querySelector(".eroreader-badge")).toBeNull();
  });

  it("dims finished galleries", () => {
    const { cards } = loadPage();
    applyBadge(cards[0]!, progress(cards[0]!.gid, 181, 181, true));
    expect(cards[0]!.element.classList.contains("eroreader-finished")).toBe(true);
    expect(badgeText(progress(1, 12, 181, true))).toBe("✓ Finished");
    expect(badgeText({ ...progress(1, 12, 181, true), furthest: 181 })).toBe("✓ 12/181"); // rereading
    expect(badgeText({ ...progress(1, 12, 181, false), furthest: 90 })).toBe("12/181 · max 90");
    applyBadge(cards[0]!, undefined); // e.g. reset in another tab
    expect(cards[0]!.element.classList.contains("eroreader-finished")).toBe(false);
    expect(cards[0]!.element.querySelector(".eroreader-badge")).toBeNull();
  });

  it("goes after the title in Compact mode", () => {
    document.body.innerHTML = fixture("eh-listing-compact.html").body.innerHTML;
    const { cards } = parseListing(document, new URL("https://e-hentai.org/"));
    applyBadge(cards[0]!, progress(cards[0]!.gid, 3, 24));
    expect(cards[0]!.element.querySelector(".glink + .eroreader-badge, .eroreader-badge")!.parentElement!.querySelector(".glink")).not.toBeNull();
  });
});

describe("scrub preview", () => {
  // A gallery of `pageCount` pages with `perPage` thumbnails per thumbnail page.
  const sheet = (n: number, pageCount: number, perPage: number): GalleryPage => {
    const thumbs: Thumb[] = [];
    for (let page = n * perPage + 1; page <= Math.min(pageCount, (n + 1) * perPage); page++) {
      thumbs.push({ page, imgkey: "k", href: "h", filename: "f", sprite: { url: `https://abcdefghij.hath.network/${n}.webp`, x: -200 * (page - 1 - n * perPage), y: 0, width: 200, height: 280 } });
    }
    return { gid: 1, token: "t", title: "", titleJpn: "", category: "", pageCount, coverUrl: null, tags: [], apiUrl: null, thumbPage: n, thumbPageCount: Math.ceil(pageCount / perPage), thumbs };
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const hover = (el: Element, type: string, x: number) => el.dispatchEvent(new MouseEvent(type, { clientX: x, bubbles: false }));

  function setup(pageCount = 25, perPage = 20) {
    const { cards } = loadPage();
    const load = vi.fn(async (_card: unknown, n: number) => sheet(n, pageCount, perPage));
    const scrub = new ScrubPreview(load, 300);
    scrub.attach(cards[0]!);
    const { surface, display } = scrubSpots(cards[0]!)!;
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({ left: 0, width: 200, top: 0, height: 280 } as DOMRect);
    const label = () => display.querySelector(".eroreader-scrub-label")?.textContent;
    return { cards, scrub, load, surface, display, label, overlay: () => display.querySelector<HTMLElement>(".eroreader-scrub") };
  }

  it("scrubs the cover in Thumbnail mode, and the row in Compact mode", () => {
    const { cards } = loadPage();
    expect(scrubSpots(cards[0]!)!.surface.classList.contains("gl3t")).toBe(true);
    document.body.innerHTML = fixture("eh-listing-compact.html").body.innerHTML;
    const compact = parseListing(document, new URL("https://e-hentai.org/")).cards[0]!;
    expect(scrubSpots(compact)).toEqual({ surface: compact.element, display: compact.cover!.parentElement });
  });

  it("fetches only after hovering a moment, and not at all when the mouse passes by", async () => {
    const { load, surface } = setup();
    hover(surface, "mouseenter", 10);
    await vi.advanceTimersByTimeAsync(200);
    hover(surface, "mouseleave", 10);
    await vi.advanceTimersByTimeAsync(1000);
    expect(load).not.toHaveBeenCalled();
  });

  it("flips through the whole gallery as the mouse moves sideways", async () => {
    const { load, surface, overlay, label } = setup(25, 40); // fits one thumbnail page: every frame is there
    hover(surface, "mouseenter", 0);
    await vi.advanceTimersByTimeAsync(300);
    expect(load).toHaveBeenCalledTimes(1);
    expect(label()).toBe("1 / 25");
    hover(surface, "mousemove", 199);
    expect(label()).toBe("25 / 25");
    hover(surface, "mousemove", 100);
    expect(overlay()!.querySelector<HTMLElement>(".eroreader-scrub-sprite")!.style.backgroundPosition).toMatch(/^-\d+px 0px$/);
    hover(surface, "mouseleave", 100);
    expect(overlay()).toBeNull();
  });

  it("costs one request for a glance and at most five for a full sweep of a long gallery", async () => {
    const { load, surface } = setup(1000, 20);
    hover(surface, "mouseenter", 0);
    await vi.advanceTimersByTimeAsync(400);
    expect(load).toHaveBeenCalledTimes(1);
    for (let x = 0; x < 200; x += 10) {
      hover(surface, "mousemove", x);
      await vi.advanceTimersByTimeAsync(200); // resting on each spot
    }
    expect(load.mock.calls.map((call) => call[1])).toEqual([0, 12, 25, 37, 49]);
  });

  it("shows the nearest loaded frame while a frame's thumbnail page is on its way", async () => {
    const { surface, label } = setup(1000, 20);
    hover(surface, "mouseenter", 0);
    await vi.advanceTimersByTimeAsync(400);
    hover(surface, "mousemove", 199);
    expect(label()).toBe("20 / 1000"); // the last frame of the first thumbnail page, for now
    await vi.advanceTimersByTimeAsync(200);
    expect(label()).toBe("1000 / 1000");
  });

  it("keeps fetched frames, so hovering again shows them at once", async () => {
    const { load, surface, overlay } = setup();
    hover(surface, "mouseenter", 10);
    await vi.advanceTimersByTimeAsync(300);
    hover(surface, "mouseleave", 10);
    hover(surface, "mouseenter", 100);
    expect(overlay()).not.toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("maps a position across the surface to a frame", () => {
    expect([0, 0.049, 0.05, 0.5, 0.999, 1, 1.4, -1].map((f) => thumbIndexAt(f, 20))).toEqual([0, 0, 1, 10, 19, 19, 19, 0]);
  });
});

describe("planFrames", () => {
  it("spreads 20 frames over the whole gallery from at most 5 thumbnail pages, ending on the last page", () => {
    const frames = planFrames(219, 20);
    expect(frames).toHaveLength(20);
    expect(new Set(frames.map((f) => f.sheet))).toEqual(new Set([0, 3, 5, 8, 10]));
    expect(frames[0]!.page).toBe(1);
    expect(frames.at(-1)!.page).toBe(219);
    expect(frames.map((f) => f.page)).toEqual([...frames.map((f) => f.page)].sort((a, b) => a - b));
  });

  it("gives the same number of frames whatever the thumbnail page size", () => {
    for (const perPage of [20, 40, 100, 200]) {
      const frames = planFrames(181, perPage);
      expect(frames, String(perPage)).toHaveLength(20);
      expect(frames.at(-1)!.page, String(perPage)).toBe(181);
    }
  });

  it("uses every page of a short gallery", () => {
    expect(planFrames(12, 20).map((f) => f.page)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it("makes up for a short last thumbnail page", () => {
    const frames = planFrames(201, 20); // the last thumbnail page holds one page
    expect(frames).toHaveLength(20);
    expect(frames.at(-1)!.page).toBe(201);
  });
});

describe("scrub preview over a long gallery", () => {
  const PAGES = 219;
  const PER_PAGE = 20;
  const SHEETS = Math.ceil(PAGES / PER_PAGE); // 11

  // A gallery served by thumbnail page, built from the gallery fixture with the extension's
  // own renderers, and a record of what was asked for.
  function fakeGallerySite() {
    const requested: number[] = [];
    const sheetHtml = (sheet: number) => {
      const doc = fixture("ex-gallery-p0.html");
      const thumbs: Thumb[] = [];
      for (let page = sheet * PER_PAGE + 1; page <= Math.min(PAGES, (sheet + 1) * PER_PAGE); page++) {
        thumbs.push({ page, imgkey: "0000000aaa", href: `https://exhentai.org/s/0000000aaa/2222025-${page}`, filename: `${page}.jpg`, sprite: { url: `https://abcdefghij.hath.network/c2/sample/${sheet}.webp`, x: -200 * (page - 1 - sheet * PER_PAGE), y: 0, width: 200, height: 280 } });
      }
      renderThumbs(doc.querySelector("#gdt")!, thumbs);
      for (const table of doc.querySelectorAll<HTMLTableElement>("table.ptt, table.ptb")) {
        renderPager(table, sheet, SHEETS, (p) => `https://exhentai.org/g/2222025/0000000000/${p ? `?p=${p}` : ""}`);
      }
      return `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
    };
    const fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const sheet = Number(url.searchParams.get("p") ?? 0);
      requested.push(sheet);
      const response = new Response(sheetHtml(sheet));
      Object.defineProperty(response, "url", { value: url.href });
      return response;
    }) as typeof globalThis.fetch;
    return { queue: new FetchQueue({ gapMs: 0, fetch }), requested };
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reaches the end of a long gallery, not just its first thumbnail page, in a few requests", async () => {
    const { cards } = loadPage();
    const card = { ...cards[0]!, token: "0000000000" };
    const { queue, requested } = fakeGallerySite();
    const scrub = new ScrubPreview(createThumbLoader(queue, "https://exhentai.org"));
    scrub.attach(card);
    const { surface, display } = scrubSpots(card)!;
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({ left: 0, width: 200, top: 0, height: 280 } as DOMRect);
    const label = () => display.querySelector(".eroreader-scrub-label")?.textContent;

    surface.dispatchEvent(new MouseEvent("mouseenter", { clientX: 199 }));
    await vi.advanceTimersByTimeAsync(1000); // a deliberate hover, resting at the far right
    expect(label()).toBe(`${PAGES} / ${PAGES}`);
    expect(requested.length).toBeLessThanOrEqual(5);
  });
});

describe("image release", () => {
  it("lets go of a cover and keeps its size, then gets it back", () => {
    const { cards } = loadPage();
    const img = cards[0]!.cover!;
    const src = img.getAttribute("src");
    const size = [img.style.width, img.style.height];
    releaseImage(img);
    expect(img.hasAttribute("src")).toBe(false);
    expect([img.style.width, img.style.height]).toEqual(size);
    expect(img.classList.contains("eroreader-released")).toBe(true);
    restoreImage(img);
    expect(img.getAttribute("src")).toBe(src);
    expect(img.classList.contains("eroreader-released")).toBe(false);
  });

  it("releases cards that leave the margin and restores them when they come back, but never the torrent icon", () => {
    const { cards } = loadPage();
    let callback: IntersectionObserverCallback = () => {};
    const releaser = new ImageReleaser((cb) => {
      callback = cb;
      return { observe: () => {}, disconnect: () => {} };
    });
    releaser.observe(cards[0]!.element);
    const entry = (isIntersecting: boolean) => [{ target: cards[0]!.element, isIntersecting } as unknown as IntersectionObserverEntry];
    callback(entry(false), {} as IntersectionObserver);
    expect(cards[0]!.cover!.hasAttribute("src")).toBe(false);
    expect(cards[0]!.element.querySelector<HTMLImageElement>(".gldown img")!.hasAttribute("src")).toBe(true);
    callback(entry(true), {} as IntersectionObserver);
    expect(cards[0]!.cover!.hasAttribute("src")).toBe(true);
  });
});

describe("infinite scroll", () => {
  function setup({ fail = false } = {}) {
    const listing = loadPage();
    const container = document.querySelector(".itg")!;
    let near: () => void = () => {};
    const added: number[] = [];
    const replaced: string[] = [];
    const fetchPage = vi.fn(async (url: string) => {
      if (fail) throw new Error("offline");
      const name = url === P2 ? "ex-listing-thumb-p2.html" : "ex-listing-thumb-last.html";
      return { url, doc: parseHtml(fixtureText(name)) };
    });
    const infinite = new InfiniteScroll({
      doc: document,
      container,
      base: BASE,
      chunks: [{ url: BASE.href, firstGid: listing.cards[0]!.gid }],
      nextUrl: listing.nextUrl,
      fetchPage,
      onCards: (cards) => added.push(...cards.map((c) => c.gid)),
      replaceUrl: (url) => replaced.push(url),
      observe: (_target, onNear) => {
        near = onNear;
        return () => {};
      },
    });
    const gids = () => [...container.querySelectorAll("[data-eroreader-gid]")].map((el) => Number(el.getAttribute("data-eroreader-gid")));
    return { infinite, container, fetchPage, added, replaced, near: () => near(), gids, status: () => document.querySelector(".eroreader-more")!.textContent };
  }

  it("appends the next results page in place when the bottom gets close", async () => {
    const { infinite, fetchPage, added, gids, near } = setup();
    near();
    await vi.waitFor(() => expect(added).toHaveLength(25));
    expect(fetchPage).toHaveBeenCalledWith(P2, expect.anything());
    expect(gids()).toHaveLength(50);
    expect(gids().slice(24, 26)).toEqual([2222001, 2221975]);
    expect(infinite.nextUrl).toBe("https://exhentai.org/?f_search=sample+query&next=2221951");
    expect(document.querySelectorAll(".searchnav")[1]!.querySelector("#dnext")!.getAttribute("href")).toBe("https://exhentai.org/?f_search=sample+query&next=2221951");
    expect(document.querySelectorAll(".searchnav")[0]!.querySelector("#unext")!.getAttribute("href")).toBe(P2); // the top one stays
  });

  it("stops at the last page and says so", async () => {
    const { infinite, near, status, fetchPage } = setup();
    near();
    await vi.waitFor(() => expect(infinite.nextUrl).not.toBe(P2));
    near();
    await vi.waitFor(() => expect(infinite.nextUrl).toBeNull());
    expect(status()).toBe("End of results");
    near();
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("offers a retry when a page fails to load", async () => {
    const { near, status } = setup({ fail: true });
    near();
    await vi.waitFor(() => expect(status()).toContain("Couldn't load more results."));
    expect(document.querySelector(".eroreader-more button")!.textContent).toBe("Retry");
  });

  it("skips results already on the page", async () => {
    const { infinite, near, gids } = setup();
    document.querySelector(".gl1t")!.setAttribute("data-eroreader-gid", "2221975"); // pretend p2's first result is here
    near();
    await vi.waitFor(() => expect(infinite.nextUrl).not.toBe(P2));
    expect(gids().filter((g) => g === 2221975)).toHaveLength(1);
  });

  it("puts the URL of the results page in view in the address bar, replacing it", async () => {
    const { infinite, near, replaced } = setup();
    near();
    await vi.waitFor(() => expect(infinite.chunks).toHaveLength(2));
    const second = document.querySelector('[data-eroreader-gid="2221975"]')!;
    vi.spyOn(second, "getBoundingClientRect").mockReturnValue({ top: -10 } as DOMRect);
    infinite.updateUrl();
    expect(replaced).toEqual([P2]);
    infinite.updateUrl();
    expect(replaced).toEqual([P2]);
  });

  it("saves a snapshot without badges or previews, and restores the same cards", async () => {
    const first = setup();
    first.near();
    await vi.waitFor(() => expect(first.infinite.chunks).toHaveLength(2));
    document.querySelector(".gl3t")!.insertAdjacentHTML("beforeend", '<span class="eroreader-badge">3/9</span><div class="eroreader-scrub"></div>');
    const saved = first.infinite.snapshot(P2, 1234, 1000)!;
    expect(saved.html).not.toContain("eroreader-badge");
    expect(saved.html).not.toContain("eroreader-scrub");
    sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(saved));

    const second = setup(); // the page loads again with only the first results page
    const back = readSnapshot(sessionStorage, P2, 2000)!;
    second.infinite.restore(back);
    expect(second.gids()).toHaveLength(50);
    expect(second.infinite.nextUrl).toBe("https://exhentai.org/?f_search=sample+query&next=2221951");
    expect(second.fetchPage).not.toHaveBeenCalled();
  });

  it("ignores snapshots of other pages or old ones", () => {
    sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ url: P2, savedAt: 0, html: "", nav: "", chunks: [], nextUrl: null, scrollY: 0 }));
    expect(readSnapshot(sessionStorage, BASE.href, 1)).toBeNull();
    expect(readSnapshot(sessionStorage, P2, SNAPSHOT_MAX_AGE_MS + 1)).toBeNull();
    sessionStorage.setItem(SNAPSHOT_KEY, "{broken");
    expect(readSnapshot(sessionStorage, P2, 1)).toBeNull();
  });
});

describe("recent searches dropdown", () => {
  const entry = (query: string, cats = 0): SearchEntry => ({ key: query, host: "exhentai.org", query, cats, url: `https://exhentai.org/?f_search=${query}`, uses: 1, lastUsed: 1 });
  const entries = [entry("sample query"), entry("other words", 112), entry("sample two")];

  function setup() {
    loadPage();
    const input = document.querySelector<HTMLInputElement>("#f_search")!;
    input.value = "";
    const went: string[] = [];
    const dropdown = new SearchDropdown({ input, recent: async () => entries, go: (url) => went.push(url) });
    return { input, dropdown, went };
  }
  const key = (input: HTMLInputElement, k: string) => input.dispatchEvent(new KeyboardEvent("keydown", { key: k, cancelable: true }));

  it("narrows to what's typed", () => {
    expect(matchSearches(entries, "SAMPLE").map((e) => e.query)).toEqual(["sample query", "sample two"]);
    expect(matchSearches(entries, "", 2)).toHaveLength(2);
  });

  it("shows recent searches on focus, with the category note, and goes to a clicked one", async () => {
    const { input, dropdown, went } = setup();
    input.dispatchEvent(new FocusEvent("focus"));
    await vi.waitFor(() => expect(dropdown.isOpen).toBe(true));
    expect(dropdown.items).toEqual(["sample query", "other words", "sample two"]);
    expect(dropdown.element.querySelectorAll(".note")[0]!.textContent).toBe("3 categories off");
    dropdown.element.querySelectorAll(".item")[1]!.dispatchEvent(new MouseEvent("mousedown", { cancelable: true }));
    expect(went).toEqual(["https://exhentai.org/?f_search=other words"]);
  });

  it("is driven by the keyboard and closes on Escape or blur", async () => {
    const { input, dropdown, went } = setup();
    input.value = "sample";
    input.dispatchEvent(new Event("input"));
    await vi.waitFor(() => expect(dropdown.items).toEqual(["sample query", "sample two"]));
    key(input, "ArrowDown");
    key(input, "ArrowDown");
    key(input, "Enter");
    expect(went).toEqual(["https://exhentai.org/?f_search=sample two"]);
    key(input, "Escape");
    expect(dropdown.isOpen).toBe(false);
    await dropdown.open();
    input.dispatchEvent(new FocusEvent("blur"));
    expect(dropdown.isOpen).toBe(false);
  });

  it("lets Enter submit the search box when nothing is selected", async () => {
    const { input, dropdown } = setup();
    await dropdown.open();
    const enter = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    input.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
  });
});
