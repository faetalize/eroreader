import { describe, expect, it } from "vitest";
import { DEFAULT_ASPECT } from "../src/content/reader/pageSource";
import { fakeSite, hrefOf, imageOf, imagePageHtml } from "./reader-fakes";

describe("PageSource", () => {
  it("resolves a page through its thumbnail's image page", async () => {
    const { source, requested } = fakeSite(100);
    expect(await source.resolve(3, { priority: 1 })).toMatchObject({ pageUrl: hrefOf(3), imageUrl: imageOf(3), width: 1280, height: 1810, nlKey: "nl-3", isLimit: false });
    expect(requested).toEqual([hrefOf(3)]);
  });

  it("keeps resolved pages, so a second resolve fetches nothing", async () => {
    const { source, requested } = fakeSite(100);
    await source.resolve(3, { priority: 1 });
    await source.resolve(3, { priority: 1 });
    expect(requested).toHaveLength(1);
  });

  it("follows the neighbour links of loaded image pages before fetching thumbnail pages", async () => {
    const { source, thumbLoads } = fakeSite(100);
    await source.resolve(20, { priority: 1 }); // the last page on thumbnail page 0 links to page 21
    await source.resolve(21, { priority: 1 });
    expect(thumbLoads).toEqual([]);
  });

  it("fetches the thumbnail page for a page nothing links to yet", async () => {
    const { source, thumbLoads } = fakeSite(100);
    expect((await source.resolve(65, { priority: 1 })).imageUrl).toBe(imageOf(65));
    expect(thumbLoads).toEqual([3]);
  });

  it("retries through the site's nl mechanism", async () => {
    const { source, pages, requested } = fakeSite(100);
    await source.resolve(3, { priority: 1 });
    pages.set(`${hrefOf(3)}?nl=nl-3`, imagePageHtml(3, 100, { imageUrl: imageOf(3, 1), nlKey: "nl-3b" }));
    pages.set(`${hrefOf(3)}?nl=nl-3&nl=nl-3b`, imagePageHtml(3, 100, { imageUrl: imageOf(3, 2) }));
    expect((await source.retry(3, { priority: 1 })).imageUrl).toBe(imageOf(3, 1));
    expect((await source.retry(3, { priority: 1 })).imageUrl).toBe(imageOf(3, 2));
    expect(requested.slice(1)).toEqual([`${hrefOf(3)}?nl=nl-3`, `${hrefOf(3)}?nl=nl-3&nl=nl-3b`]);
  });

  it("notices the image limit and doesn't keep the placeholder", async () => {
    const { source, pages, requested } = fakeSite(100);
    pages.set(hrefOf(3), imagePageHtml(3, 100, { imageUrl: "https://exhentai.org/img/509.gif" }));
    expect((await source.resolve(3, { priority: 1 })).isLimit).toBe(true);
    expect(source.limitReached).toBe(true);
    source.resetLimit();
    await source.resolve(3, { priority: 1 });
    expect(requested).toHaveLength(2);
  });

  it("knows a page's shape from its thumbnail, then from its image", async () => {
    const { source } = fakeSite(100, { knownThumbPages: [] });
    expect(source.aspect(5)).toBeNull();
    expect(source.naturalSize(5)).toEqual({ width: 1280, height: 1280 * DEFAULT_ASPECT });
    await source.resolve(5, { priority: 1 });
    expect(source.aspect(5)).toBeCloseTo(1810 / 1280);
    expect(source.aspect(10)).toBe(0.7); // thumbnail page 0 (200 × 140 for page 10) is in the store now
  });
});
