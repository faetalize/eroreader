// Infinite scroll: the next results page loads as the bottom gets close and is appended in
// place. The URL follows the results page in view, replaced rather than pushed, and a snapshot
// lets Back come to the same spot without fetching anything again.
import { parseHtml } from "../../site/html";
import { parseCard, parseListing, type ListingCard } from "../../site/listing";

export const LOAD_MARGIN = "0px 0px 150% 0px"; // starts a screen and a half before the bottom
export const SNAPSHOT_KEY = "eroreader.listing";
export const SNAPSHOT_MAX_CARDS = 400;
export const SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000;
const URL_THROTTLE_MS = 300;

// A results page added to the list: its URL and its first card, to tell which one is in view.
export interface Chunk {
  url: string;
  firstGid: number;
}

export interface Snapshot {
  url: string; // the page URL when it was saved
  html: string; // the results container, outer HTML, so table rows parse in their table
  nav: string; // the bottom paginator
  chunks: Chunk[];
  nextUrl: string | null;
  scrollY: number;
  savedAt: number;
}

export interface InfiniteScrollDeps {
  doc: Document;
  container: Element; // .itg
  base: URL;
  chunks: Chunk[];
  nextUrl: string | null;
  fetchPage: (url: string, signal: AbortSignal) => Promise<{ url: string; doc: Document }>;
  onCards: (cards: ListingCard[]) => void; // new cards, for badges and the rest
  replaceUrl: (url: string) => void;
  observe?: (target: Element, onNear: () => void) => () => void;
}

// Marks a card with its gallery id, which is how the list knows what it holds.
export function markCard(card: ListingCard): void {
  card.element.setAttribute("data-eroreader-gid", String(card.gid));
}

export function readSnapshot(storage: Storage | null, url: string, now: number): Snapshot | null {
  try {
    const value = JSON.parse(storage?.getItem(SNAPSHOT_KEY) ?? "null") as Snapshot | null;
    if (!value || value.url !== url || now - value.savedAt > SNAPSHOT_MAX_AGE_MS) return null;
    return value;
  } catch {
    return null;
  }
}

function nearObserver(target: Element, onNear: () => void): () => void {
  const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onNear(), { rootMargin: LOAD_MARGIN });
  observer.observe(target);
  return () => observer.disconnect();
}

export class InfiniteScroll {
  readonly #deps: InfiniteScrollDeps;
  readonly #status: HTMLElement;
  readonly #stopObserving: () => void;
  #chunks: Chunk[];
  #nextUrl: string | null;
  #loading: AbortController | null = null;
  #shownUrl: string;
  #urlTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: InfiniteScrollDeps) {
    this.#deps = deps;
    this.#chunks = [...deps.chunks];
    this.#nextUrl = deps.nextUrl;
    this.#shownUrl = deps.chunks[0]?.url ?? deps.base.href;
    this.#status = deps.doc.createElement("div");
    this.#status.className = "eroreader-more";
    deps.container.after(this.#status);
    this.#renderStatus("idle");
    this.#stopObserving = (deps.observe ?? nearObserver)(this.#status, () => void this.loadNext());
  }

  get nextUrl(): string | null {
    return this.#nextUrl;
  }

  get chunks(): Chunk[] {
    return [...this.#chunks];
  }

  async loadNext(): Promise<void> {
    const url = this.#nextUrl;
    if (!url || this.#loading) return;
    const controller = new AbortController();
    this.#loading = controller;
    this.#renderStatus("loading");
    try {
      const page = await this.#deps.fetchPage(url, controller.signal);
      this.#append(page.doc, new URL(page.url));
      this.#renderStatus("idle");
    } catch {
      if (!controller.signal.aborted) this.#renderStatus("error");
    } finally {
      if (this.#loading === controller) this.#loading = null;
    }
  }

  // The results page whose cards are at the top of the screen; its URL goes in the address bar.
  updateUrl(viewportTop = 0): void {
    const gids = new Map(this.#cardElements().map((el) => [Number(el.getAttribute("data-eroreader-gid")), el]));
    let url = this.#chunks[0]?.url ?? this.#shownUrl;
    for (const chunk of this.#chunks) {
      const el = gids.get(chunk.firstGid);
      if (el && el.getBoundingClientRect().top <= viewportTop + 1) url = chunk.url;
    }
    if (url === this.#shownUrl) return;
    this.#shownUrl = url;
    this.#deps.replaceUrl(url);
  }

  scheduleUrlUpdate(): void {
    this.#urlTimer ??= setTimeout(() => {
      this.#urlTimer = null;
      this.updateUrl();
    }, URL_THROTTLE_MS);
  }

  snapshot(currentUrl: string, scrollY: number, now: number): Snapshot | null {
    if (this.#cardElements().length > SNAPSHOT_MAX_CARDS) return null;
    // Badges and an open scrub preview are drawn again after a restore.
    const copy = this.#deps.container.cloneNode(true) as Element;
    copy.querySelectorAll(".eroreader-badge, .eroreader-scrub").forEach((el) => el.remove());
    const nav = this.#deps.doc.querySelectorAll(".searchnav");
    return {
      url: currentUrl,
      html: copy.outerHTML,
      nav: nav[nav.length - 1]?.outerHTML ?? "",
      chunks: this.#chunks,
      nextUrl: this.#nextUrl,
      scrollY,
      savedAt: now,
    };
  }

  // Puts a snapshot back: same cards, same paginator and same next page.
  restore(snapshot: Snapshot): void {
    const host = this.#deps.doc;
    const saved = parseHtml(snapshot.html).body.firstElementChild;
    if (saved) this.#deps.container.replaceChildren(...[...saved.childNodes].map((node) => host.importNode(node, true)));
    const nav = host.querySelectorAll(".searchnav");
    const bottom = nav[nav.length - 1];
    const savedNav = snapshot.nav ? parseHtml(snapshot.nav).querySelector(".searchnav") : null;
    if (bottom && savedNav) bottom.replaceWith(host.importNode(savedNav, true));
    this.#chunks = snapshot.chunks;
    this.#nextUrl = snapshot.nextUrl;
    this.#shownUrl = snapshot.url;
    this.#renderStatus("idle");
  }

  destroy(): void {
    this.#stopObserving();
    this.#loading?.abort();
    if (this.#urlTimer !== null) clearTimeout(this.#urlTimer);
  }

  #cardElements(): Element[] {
    return [...this.#deps.container.querySelectorAll("[data-eroreader-gid]")];
  }

  #append(doc: Document, url: URL): void {
    const fetched = parseListing(doc, url);
    const present = new Set(this.#cardElements().map((el) => Number(el.getAttribute("data-eroreader-gid"))));
    const fresh = fetched.cards.filter((card) => !present.has(card.gid));
    const host = this.#deps.doc;
    const parent = this.#cardElements().at(-1)?.parentElement ?? this.#deps.container;
    const added: ListingCard[] = [];
    for (const card of fresh) {
      const element = host.importNode(card.element, true);
      parent.append(element);
      const parsed = parseCard(element, url);
      if (!parsed) continue;
      markCard(parsed);
      added.push(parsed);
    }
    if (added.length > 0) this.#chunks.push({ url: url.href, firstGid: added[0]!.gid });
    this.#nextUrl = fetched.nextUrl;
    // The bottom paginator follows the furthest page loaded.
    const navs = this.#deps.doc.querySelectorAll(".searchnav");
    const fetchedNavs = doc.querySelectorAll(".searchnav");
    const bottom = navs[navs.length - 1];
    const fetchedBottom = fetchedNavs[fetchedNavs.length - 1];
    if (bottom && fetchedBottom) bottom.replaceWith(host.importNode(fetchedBottom, true));
    this.#deps.onCards(added);
  }

  #renderStatus(state: "idle" | "loading" | "error"): void {
    const status = this.#status;
    status.replaceChildren();
    if (state === "loading") status.textContent = "Loading more results…";
    else if (state === "error") {
      status.append("Couldn't load more results. ");
      const retry = this.#deps.doc.createElement("button");
      retry.type = "button";
      retry.textContent = "Retry";
      retry.addEventListener("click", () => void this.loadNext());
      status.append(retry);
    } else if (!this.#nextUrl) status.textContent = "End of results";
  }
}
