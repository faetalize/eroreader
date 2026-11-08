// Fetch-and-parse for the pages the extension loads in the background.
import type { FetchQueue, RequestOptions } from "./fetchQueue";
import { galleryPageUrl, isContentWarning, parseGallery, type GalleryPage } from "./gallery";
import { parseHtml } from "./html";
import { parseImagePage, type ImagePage } from "./imagePage";

export class UnexpectedPageError extends Error {
  constructor(readonly url: string) {
    super(`Unexpected page at ${url}`);
  }
}

// Behind a content warning, retries once with `nw=session`, the warning page's own
// "View Gallery" link. `nw=always` would change the account's setting for good.
export async function loadGalleryPage(
  queue: FetchQueue,
  origin: string,
  gid: number,
  token: string,
  thumbPage: number,
  options?: RequestOptions,
): Promise<GalleryPage> {
  const url = galleryPageUrl(origin, gid, token, thumbPage);
  let result = await queue.get(url.href, options);
  let doc = parseHtml(result.text);
  if (isContentWarning(doc)) {
    url.searchParams.set("nw", "session");
    result = await queue.get(url.href, options);
    doc = parseHtml(result.text);
  }
  const gallery = parseGallery(doc, new URL(result.url));
  if (!gallery) throw new UnexpectedPageError(url.href);
  return gallery;
}

export async function loadImagePage(queue: FetchQueue, url: string, options?: RequestOptions): Promise<ImagePage> {
  const result = await queue.get(url, options);
  const page = parseImagePage(parseHtml(result.text));
  if (!page) throw new UnexpectedPageError(url);
  return page;
}
