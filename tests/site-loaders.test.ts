import { describe, expect, it } from "vitest";
import { FetchQueue } from "../src/site/fetchQueue";
import { loadGalleryPage, loadImagePage, UnexpectedPageError } from "../src/site/loaders";
import { fixtureText } from "./fixtures";

// Serves fixtures by URL and records what was requested.
function siteFetch(pages: Record<string, string>) {
  const requested: string[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    const body = pages[url];
    const response = new Response(body ?? "not found", { status: body ? 200 : 404 });
    Object.defineProperty(response, "url", { value: url });
    return response;
  }) as typeof globalThis.fetch;
  return { queue: new FetchQueue({ gapMs: 0, fetch }), requested };
}

const GALLERY = "https://e-hentai.org/g/1234567/0123456789/";

describe("loadGalleryPage", () => {
  it("fetches and parses a thumbnail page", async () => {
    const { queue, requested } = siteFetch({ [`${GALLERY}?p=8`]: fixtureText("eh-gallery-p8.html") });
    const gallery = await loadGalleryPage(queue, "https://e-hentai.org", 1234567, "0123456789", 8);
    expect(gallery.thumbPage).toBe(8);
    expect(requested).toEqual([`${GALLERY}?p=8`]);
  });

  it("retries once with nw=session behind a content warning", async () => {
    const { queue, requested } = siteFetch({
      [GALLERY]: fixtureText("content-warning.html"),
      [`${GALLERY}?nw=session`]: fixtureText("eh-gallery-p0.html"),
    });
    const gallery = await loadGalleryPage(queue, "https://e-hentai.org", 1234567, "0123456789", 0);
    expect(gallery.thumbs).toHaveLength(20);
    expect(requested).toEqual([GALLERY, `${GALLERY}?nw=session`]);
  });

  it("gives up when the retry still isn't a gallery", async () => {
    const warning = fixtureText("content-warning.html");
    const { queue, requested } = siteFetch({ [GALLERY]: warning, [`${GALLERY}?nw=session`]: warning });
    await expect(loadGalleryPage(queue, "https://e-hentai.org", 1234567, "0123456789", 0)).rejects.toBeInstanceOf(UnexpectedPageError);
    expect(requested).toHaveLength(2);
  });
});

describe("loadImagePage", () => {
  const PAGE = "https://e-hentai.org/s/0000001e78/1234567-2";

  it("fetches and parses an image page", async () => {
    const { queue } = siteFetch({ [PAGE]: fixtureText("image-page.html") });
    expect((await loadImagePage(queue, PAGE)).width).toBe(1280);
  });

  it("rejects a page without an image", async () => {
    const { queue } = siteFetch({ [PAGE]: fixtureText("content-warning.html") });
    await expect(loadImagePage(queue, PAGE)).rejects.toBeInstanceOf(UnexpectedPageError);
  });
});
