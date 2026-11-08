import { describe, expect, it, vi } from "vitest";
import { ImageBuffer, MAX_RETRIES, type PageState } from "../src/content/reader/imageBuffer";
import { fakeSite, hrefOf, imageOf, imagePageHtml } from "./reader-fakes";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(pageCount = 100) {
  const site = fakeSite(pageCount);
  const images: HTMLImageElement[] = [];
  const changes: [number, PageState["status"] | undefined][] = [];
  const buffer = new ImageBuffer({
    source: site.source,
    onChange: (page, state) => changes.push([page, state?.status]),
    createImage: () => {
      const img = document.createElement("img");
      images.push(img);
      return img;
    },
  });
  return { ...site, buffer, images, changes };
}

describe("ImageBuffer", () => {
  it("loads the pages it's given, most important first", async () => {
    const { buffer, requested, images } = setup();
    buffer.retarget([10, 11, 12, 9]);
    await settle();
    expect(requested).toEqual([10, 11, 12, 9].map(hrefOf));
    expect(images.map((img) => img.getAttribute("src"))).toEqual([10, 11, 12, 9].map((p) => imageOf(p)));
    expect(buffer.state(10)?.status).toBe("loading");
    images[0]!.dispatchEvent(new Event("load"));
    expect(buffer.state(10)?.status).toBe("loaded");
  });

  it("releases pages outside the new window, dropping their image", async () => {
    const { buffer, images, changes } = setup();
    buffer.retarget([10, 11]);
    await settle();
    buffer.retarget([11, 12]);
    expect(buffer.pages().sort()).toEqual([11, 12]);
    expect(images[0]!.hasAttribute("src")).toBe(false);
    expect(changes).toContainEqual([10, undefined]);
  });

  it("cancels the image page request of a page released before it resolved", async () => {
    const { buffer, requested } = setup();
    buffer.retarget([10, 11, 12]);
    buffer.retarget([50]);
    await settle();
    expect(requested).not.toContain(hrefOf(11));
    expect(requested).toContain(hrefOf(50));
  });

  it("retries a broken image through another server, then gives up", async () => {
    const { buffer, images, pages } = setup();
    pages.set(`${hrefOf(10)}?nl=nl-10`, imagePageHtml(10, 100, { imageUrl: imageOf(10, 1), nlKey: "nl-10b" }));
    pages.set(`${hrefOf(10)}?nl=nl-10&nl=nl-10b`, imagePageHtml(10, 100, { imageUrl: imageOf(10, 2), nlKey: "nl-10c" }));
    buffer.retarget([10]);
    await settle();
    for (let i = 0; i <= MAX_RETRIES; i++) {
      images[i]!.dispatchEvent(new Event("error"));
      await settle();
    }
    expect(images.map((img) => img.getAttribute("src") ?? "released")).toEqual(["released", "released", "released"]);
    expect(images).toHaveLength(MAX_RETRIES + 1);
    expect(buffer.state(10)?.status).toBe("error");
  });

  it("starts over on a manual retry", async () => {
    const { buffer, images } = setup();
    buffer.retarget([10]);
    await settle();
    for (let i = 0; i <= MAX_RETRIES; i++) {
      images.at(-1)!.dispatchEvent(new Event("error"));
      await settle();
    }
    buffer.retry(10);
    await settle();
    expect(buffer.state(10)?.status).toBe("loading");
  });

  it("stops loading anything once the image limit shows up", async () => {
    const { buffer, pages, requested } = setup();
    pages.set(hrefOf(10), imagePageHtml(10, 100, { imageUrl: "https://exhentai.org/img/509.gif" }));
    buffer.retarget([10]);
    await settle();
    expect(buffer.state(10)?.status).toBe("limit");
    buffer.retarget([10, 11, 12]);
    await settle();
    expect(buffer.state(11)?.status).toBe("limit");
    expect(requested).toEqual([hrefOf(10)]);
  });

  it("lifts the limit for one page when asked", async () => {
    const { buffer, pages, requested } = setup();
    pages.set(hrefOf(10), imagePageHtml(10, 100, { imageUrl: "https://exhentai.org/img/509.gif" }));
    buffer.retarget([10, 11]);
    await settle();
    pages.set(hrefOf(10), imagePageHtml(10, 100));
    buffer.retry(10);
    await settle();
    expect(buffer.state(10)?.status).toBe("loading");
    expect(requested.filter((url) => url === hrefOf(10))).toHaveLength(2);
  });

  it("releases everything on clear", async () => {
    const { buffer, images } = setup();
    buffer.retarget([1, 2, 3]);
    await settle();
    buffer.clear();
    expect(buffer.pages()).toEqual([]);
    expect(images.every((img) => !img.hasAttribute("src"))).toBe(true);
  });
});
