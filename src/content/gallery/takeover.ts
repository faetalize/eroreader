// Switches thumbnail pages in place: paginator clicks swap the grid instead of loading a page.
import { galleryPageUrl, thumbPageOf, thumbsPerPage, type GalleryPage } from "../../site/gallery";
import { renderPager, renderThumbs, showingText } from "./render";
import type { ThumbPreloader } from "./thumbPreloader";
import type { ThumbStore } from "./thumbStore";

export interface TakeoverDeps {
  doc: Document;
  gallery: GalleryPage; // parsed from the live page
  store: ThumbStore;
  preloader: ThumbPreloader;
  currentUrl: () => URL;
  replaceUrl: (url: URL) => void;
  navigate: (url: string) => void;
  prompt: (message: string, value: string) => string | null;
  onRender?: () => void; // after a thumbnail page is drawn in place
}

const PAGER_CELL = "table.ptt td, table.ptb td";

export class GalleryTakeover {
  readonly #deps: TakeoverDeps;
  #current: number;
  #request = 0; // newest show() call wins
  #onClick = (event: MouseEvent) => this.#handleClick(event);

  constructor(deps: TakeoverDeps) {
    this.#deps = deps;
    this.#current = deps.gallery.thumbPage;
  }

  get currentThumbPage(): number {
    return this.#current;
  }

  start(): void {
    const { gallery, store, preloader, doc } = this.#deps;
    store.set({ thumbPage: gallery.thumbPage, thumbs: gallery.thumbs });
    // Capture phase, so the site's inline handlers on the cells never see the click.
    doc.addEventListener("click", this.#onClick, true);
    preloader.focus(this.#current);
  }

  stop(): void {
    this.#deps.doc.removeEventListener("click", this.#onClick, true);
  }

  // After the reader: shows the thumbnail page holding `page`, the last page read, and brings
  // its thumbnail into view. A gallery already showing it in view is left as it was.
  async reveal(page: number): Promise<void> {
    const { gallery, doc } = this.#deps;
    await this.show(thumbPageOf(page, thumbsPerPage(gallery)), { fallBack: false });
    const link = [...doc.querySelectorAll<HTMLAnchorElement>("#gdt > a[href]")].find((a) => a.href.endsWith(`-${page}`));
    if (!link) return;
    const rect = link.getBoundingClientRect();
    const height = doc.defaultView?.innerHeight ?? 0;
    if (rect.top < 0 || rect.bottom > height) link.scrollIntoView({ block: "center" });
  }

  // `fallBack`: when the thumbnail page can't be fetched, go to the site's own page for it.
  async show(thumbPage: number, { fallBack = true } = {}): Promise<void> {
    const { gallery, preloader, doc } = this.#deps;
    if (thumbPage === this.#current || thumbPage < 0 || thumbPage >= gallery.thumbPageCount) return;
    const request = ++this.#request;
    const grid = doc.querySelector<HTMLElement>("#gdt");
    grid?.setAttribute("aria-busy", "true");
    let data;
    try {
      data = await preloader.ensure(thumbPage);
    } catch {
      // Whatever went wrong, the site's own page still works.
      if (request === this.#request && fallBack) this.#deps.navigate(this.#urlFor(thumbPage));
      return;
    } finally {
      if (request === this.#request) grid?.removeAttribute("aria-busy");
    }
    if (request !== this.#request) return;

    if (grid) renderThumbs(grid, data.thumbs, () => this.#picturesFailed(thumbPage));
    for (const table of doc.querySelectorAll<HTMLTableElement>("table.ptt, table.ptb")) {
      renderPager(table, thumbPage, gallery.thumbPageCount, (p) => this.#urlFor(p));
    }
    const showing = doc.querySelector(".gtb .gpc");
    if (showing) showing.textContent = showingText(data.thumbs, gallery.pageCount);
    this.#current = thumbPage;
    this.#deps.onRender?.();

    const url = this.#deps.currentUrl();
    if (thumbPage > 0) url.searchParams.set("p", String(thumbPage));
    else url.searchParams.delete("p");
    this.#deps.replaceUrl(url);

    const top = doc.querySelector(".gtb");
    if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: "start" });
    preloader.focus(thumbPage);
  }

  // Kept thumbnail pages can outlive their picture URLs: the page is fetched again, once, and
  // drawn again if it's still the one shown.
  #picturesFailed(thumbPage: number): void {
    this.#deps.preloader
      .refetchOnce(thumbPage)
      ?.then((data) => {
        const grid = this.#deps.doc.querySelector<HTMLElement>("#gdt");
        if (thumbPage !== this.#current || !grid) return;
        renderThumbs(grid, data.thumbs, () => this.#picturesFailed(thumbPage));
        this.#deps.onRender?.();
      })
      .catch(() => {});
  }

  #urlFor(thumbPage: number): string {
    const { gallery } = this.#deps;
    return galleryPageUrl(this.#deps.currentUrl().origin, gallery.gid, gallery.token, thumbPage).href;
  }

  #handleClick(event: MouseEvent): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const cell = (event.target as Element | null)?.closest?.(PAGER_CELL);
    if (!cell) return;
    event.preventDefault();
    event.stopPropagation();
    const target = this.#targetOf(cell);
    if (target !== null) void this.show(target);
  }

  #targetOf(cell: Element): number | null {
    const link = cell.querySelector("a[href]");
    if (link) return Number(new URL(link.getAttribute("href")!, this.#deps.currentUrl()).searchParams.get("p") ?? 0);
    if (cell.textContent?.trim() !== "...") return null;
    const count = this.#deps.gallery.thumbPageCount;
    const answer = this.#deps.prompt(`Jump to page: (1-${count})`, "1");
    const page = parseInt(answer ?? "", 10);
    return Number.isNaN(page) ? null : Math.min(count - 1, Math.max(0, page - 1));
  }
}
