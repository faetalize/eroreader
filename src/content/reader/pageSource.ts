// Where a gallery page's image comes from: its `/s/` page, found through the thumbnail
// store or the neighbour links of image pages already loaded, then resolved to an image URL.
import { Lru } from "../../shared/lru";
import type { FetchQueue } from "../../site/fetchQueue";
import { thumbPageOf, type Thumb } from "../../site/gallery";
import { retryUrl } from "../../site/imagePage";
import { loadImagePage } from "../../site/loaders";
import type { ThumbPreloader } from "../gallery/thumbPreloader";
import type { ThumbStore } from "../gallery/thumbStore";
import { PRIORITY_THUMBS } from "./priorities";
import type { Size } from "./zoom";

export interface ResolvedPage {
  pageUrl: string; // the image page as last fetched, with any `nl` retries
  imageUrl: string;
  width: number | null;
  height: number | null;
  nlKey: string | null;
  isLimit: boolean;
}

export const RESOLVED_CACHE_SIZE = 300;

// Height / width of a typical page, until a page's thumbnail or image says otherwise.
export const DEFAULT_ASPECT = 1.42;
const DEFAULT_WIDTH = 1280;

export interface PageSourceOptions {
  gid: number;
  pageCount: number;
  perPage: number; // thumbnails per thumbnail page
  store: ThumbStore;
  preloader: ThumbPreloader;
  queue: FetchQueue;
}

const PAGE_OF_HREF = /\/s\/[0-9a-f]+\/\d+-(\d+)/;

export class PageSource {
  readonly pageCount: number;
  readonly #options: PageSourceOptions;
  readonly #resolved = new Lru<number, ResolvedPage>(RESOLVED_CACHE_SIZE);
  readonly #learned = new Map<number, string>(); // `/s/` URLs from neighbour links, at most one per page
  #limitReached = false;

  constructor(options: PageSourceOptions) {
    this.#options = options;
    this.pageCount = options.pageCount;
  }

  // The site served the 509 placeholder: nothing more is fetched until resetLimit().
  get limitReached(): boolean {
    return this.#limitReached;
  }

  resetLimit(): void {
    this.#limitReached = false;
  }

  thumb(page: number): Thumb | undefined {
    const { store, perPage } = this.#options;
    return store.get(thumbPageOf(page, perPage))?.thumbs.find((thumb) => thumb.page === page);
  }

  thumbPageOf(page: number): number {
    return thumbPageOf(page, this.#options.perPage);
  }

  // A thumbnail picture failed to load for `page`. Thumbnail pages are kept for the tab's life,
  // but the site's picture URLs expire, so the page's thumbnail page is fetched again, once.
  spriteFailed(page: number): void {
    this.#options.preloader.refetchOnce(this.thumbPageOf(page), PRIORITY_THUMBS)?.catch(() => {});
  }

  // The thumbnail pages a filmstrip or grid (`owner`) shows, most important first. Replaces its
  // previous list, so pages it scrolled away from aren't fetched. Failures only leave
  // thumbnails missing.
  wantThumbPages(owner: string, thumbPages: number[]): void {
    this.#options.preloader.want(owner, thumbPages, PRIORITY_THUMBS);
  }

  // Wider than tall, so it already is a spread on its own. Unknown shapes count as not wide.
  isWide(page: number): boolean {
    const aspect = this.aspect(page);
    return aspect !== null && aspect < 1;
  }

  resolvedNow(page: number): ResolvedPage | undefined {
    return this.#resolved.get(page);
  }

  // Height / width, from the image if it's resolved, else from its thumbnail.
  aspect(page: number): number | null {
    const resolved = this.#resolved.get(page);
    if (resolved?.width && resolved.height) return resolved.height / resolved.width;
    const sprite = this.thumb(page)?.sprite;
    return sprite && sprite.width > 0 && sprite.height > 0 ? sprite.height / sprite.width : null;
  }

  // The page's real size if known, else an estimate from its aspect.
  naturalSize(page: number): Size {
    const resolved = this.#resolved.get(page);
    if (resolved?.width && resolved.height) return { width: resolved.width, height: resolved.height };
    return { width: DEFAULT_WIDTH, height: DEFAULT_WIDTH * (this.aspect(page) ?? DEFAULT_ASPECT) };
  }

  async href(page: number, priority: number): Promise<string> {
    const known = this.thumb(page)?.href ?? this.#learned.get(page);
    if (known) return known;
    const { preloader, perPage } = this.#options;
    const data = await preloader.ensure(thumbPageOf(page, perPage), priority);
    const href = data.thumbs.find((thumb) => thumb.page === page)?.href;
    if (!href) throw new Error(`No image page for page ${page}`);
    return href;
  }

  async resolve(page: number, options: { priority: number; signal?: AbortSignal }): Promise<ResolvedPage> {
    const cached = this.#resolved.get(page);
    if (cached) return cached;
    const href = await this.href(page, options.priority);
    options.signal?.throwIfAborted();
    return this.#load(page, href, options);
  }

  // Asks the site for another server, the way its own "Reload broken image" link does.
  async retry(page: number, options: { priority: number; signal?: AbortSignal }): Promise<ResolvedPage> {
    const previous = this.#resolved.get(page);
    if (!previous?.nlKey) throw new Error(`No retry key for page ${page}`);
    return this.#load(page, retryUrl(previous.pageUrl, previous.nlKey), options);
  }

  async #load(page: number, pageUrl: string, options: { priority: number; signal?: AbortSignal }): Promise<ResolvedPage> {
    const loaded = await loadImagePage(this.#options.queue, pageUrl, options);
    for (const neighbour of [loaded.prevHref, loaded.nextHref]) {
      const match = neighbour ? PAGE_OF_HREF.exec(neighbour) : null;
      if (match && Number(match[1]) !== page) this.#learned.set(Number(match[1]), neighbour!);
    }
    const resolved: ResolvedPage = {
      pageUrl,
      imageUrl: loaded.imageUrl,
      width: loaded.width,
      height: loaded.height,
      nlKey: loaded.nlKey,
      isLimit: loaded.isLimit,
    };
    if (resolved.isLimit) {
      this.#limitReached = true;
    } else {
      this.#resolved.set(page, resolved);
    }
    return resolved;
  }
}
