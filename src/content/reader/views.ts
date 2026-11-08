// The two ways the reader shows pages: one at a time (page mode) or one column (strip mode).
import type { ImageBuffer, PageState } from "./imageBuffer";
import type { PageSource } from "./pageSource";
import { renderPlaceholder } from "./placeholder";
import { pageAt, stripLayout, type StripLayout } from "./stripLayout";
import { displaySize, spreadDisplay, type Size, type Zoom } from "./zoom";

// Space the reader's UI keeps covered along the edges: a pinned toolbar on top, an open
// filmstrip along the bottom or on the left. The views leave that much room past the pages, so
// scrolling or panning can always bring any part of a page out from under it.
export interface Insets {
  top: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = { top: 0, bottom: 0, left: 0 };

export interface ViewDeps {
  doc: Document;
  source: PageSource;
  buffer: ImageBuffer;
  viewport: () => Size;
  insets: () => Insets;
  zoom: () => Zoom;
  rtl: () => boolean;
  onRetry: (page: number) => void;
}

function imageOf(state: PageState | undefined): HTMLImageElement | null {
  return state && (state.status === "loading" || state.status === "loaded") ? state.img : null;
}

// The page's real size once its image has loaded, else what the page source knows.
function naturalSize(deps: ViewDeps, page: number): Size {
  const img = imageOf(deps.buffer.state(page));
  if (img && img.naturalWidth > 0 && img.naturalHeight > 0) return { width: img.naturalWidth, height: img.naturalHeight };
  return deps.source.naturalSize(page);
}

function fillSlot(deps: ViewDeps, slot: HTMLElement, page: number): void {
  const state = deps.buffer.state(page);
  const img = imageOf(state);
  if (img) {
    if (img.parentElement !== slot || slot.childElementCount !== 1) slot.replaceChildren(img);
  } else {
    slot.replaceChildren(renderPlaceholder(deps.doc, page, state, () => deps.onRetry(page)));
  }
}

export class PageView {
  readonly element: HTMLDivElement;
  readonly #frame: HTMLDivElement;
  readonly #deps: ViewDeps;
  readonly #cells = new Map<number, HTMLDivElement>();
  #pages: number[] = [];
  #width = 0; // the pages' displayed width
  #pad = { top: 0, right: 0, bottom: 0, left: 0 }; // room around them, see #size()

  constructor(deps: ViewDeps) {
    this.#deps = deps;
    this.element = deps.doc.createElement("div");
    this.element.className = "stage";
    this.element.tabIndex = -1;
    this.#frame = deps.doc.createElement("div");
    this.#frame.className = "frame";
    this.element.append(this.#frame);
  }

  get pages(): number[] {
    return this.#pages;
  }

  // One page, or a spread in reading order, shown from its top and its first side, clear of
  // the UI's insets.
  show(pages: number[]): void {
    this.#pages = pages;
    this.#render();
    const el = this.element;
    const insets = this.#deps.insets();
    el.scrollTop = this.#pad.top - insets.top;
    const viewportWidth = el.clientWidth || this.#deps.viewport().width;
    el.scrollLeft = this.#deps.rtl() ? Math.max(0, this.#pad.left + this.#width - viewportWidth) : this.#pad.left - insets.left;
  }

  refresh(page: number): void {
    const cell = this.#cells.get(page);
    if (!cell) return;
    fillSlot(this.#deps, cell, page);
    this.#size();
  }

  // Re-sizes after the UI's insets changed, keeping the pages where they are on screen.
  reinset(): void {
    const before = this.#pad;
    this.#size();
    this.element.scrollTop += this.#pad.top - before.top;
    this.element.scrollLeft += this.#pad.left - before.left;
  }

  // Re-sizes for a new zoom or viewport, keeping the same spot in the middle of the screen.
  layout(): void {
    const el = this.element;
    const centerX = el.scrollWidth > 0 ? (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth : 0.5;
    const centerY = el.scrollHeight > 0 ? (el.scrollTop + el.clientHeight / 2) / el.scrollHeight : 0.5;
    this.#size();
    el.scrollLeft = centerX * el.scrollWidth - el.clientWidth / 2;
    el.scrollTop = centerY * el.scrollHeight - el.clientHeight / 2;
  }

  #render(): void {
    for (const [page, cell] of this.#cells) {
      if (!this.#pages.includes(page)) {
        cell.remove();
        this.#cells.delete(page);
      }
    }
    const cells = this.#pages.map((page) => {
      let cell = this.#cells.get(page);
      if (!cell) {
        cell = this.#deps.doc.createElement("div");
        cell.className = "cell";
        cell.dataset.page = String(page);
        this.#cells.set(page, cell);
      }
      fillSlot(this.#deps, cell, page);
      return cell;
    });
    this.#frame.replaceChildren(...cells);
    // In right-to-left, the first page of a spread is on the right.
    this.#frame.style.flexDirection = this.#deps.rtl() ? "row-reverse" : "row";
    this.#size();
  }

  #size(): void {
    if (this.#pages.length === 0) return;
    const viewport = this.#deps.viewport();
    const sizes = spreadDisplay(
      this.#pages.map((page) => naturalSize(this.#deps, page)),
      viewport,
      this.#deps.zoom(),
    );
    this.#pages.forEach((page, i) => {
      const cell = this.#cells.get(page)!;
      cell.style.width = `${sizes[i]!.width}px`;
      cell.style.height = `${sizes[i]!.height}px`;
    });
    const width = sizes.reduce((sum, size) => sum + size.width, 0);
    const height = sizes[0]!.height;
    this.#frame.style.width = `${width}px`;
    this.#frame.style.height = `${height}px`;
    // Along each axis the pages overflow, half a screen of room on both sides, so panning can
    // bring any corner to the middle of the screen. At least the insets, so nothing stays
    // under the UI.
    const slackX = width > viewport.width ? Math.round(viewport.width / 2) : 0;
    const slackY = height > viewport.height ? Math.round(viewport.height / 2) : 0;
    const insets = this.#deps.insets();
    const pad = { top: Math.max(slackY, insets.top), right: slackX, bottom: Math.max(slackY, insets.bottom), left: Math.max(slackX, insets.left) };
    this.#width = width;
    this.#pad = pad;
    this.#frame.style.padding = `${pad.top}px ${pad.right}px ${pad.bottom}px ${pad.left}px`;
    const pannable = width + pad.left + pad.right > viewport.width || height + pad.top + pad.bottom > viewport.height;
    this.element.classList.toggle("pannable", pannable);
  }
}

// Room the current page's mark needs on the left of a page in strip mode (see the styles).
const CURRENT_MARK_ROOM = 16;
const NUMBER_WIDTH = 40; // about the page number's, for a three-digit page

export class StripView {
  readonly element: HTMLDivElement;
  readonly #inner: HTMLDivElement;
  readonly #slots: HTMLDivElement[] = [];
  readonly #deps: ViewDeps;
  readonly #onCurrent: (page: number) => void;
  #layout: StripLayout = stripLayout([]);
  #top = 0; // the top inset the layout leaves above the first page
  #axis = 0; // where the pages' middles line up, across the strip
  readonly #number: HTMLSpanElement; // the current page's number, beside it
  #current = 1;
  #frame = 0; // pending animation frame for scroll or layout work
  #needsLayout = false;

  constructor(deps: ViewDeps, onCurrent: (page: number) => void) {
    this.#deps = deps;
    this.#onCurrent = onCurrent;
    this.element = deps.doc.createElement("div");
    this.element.className = "strip";
    this.element.tabIndex = -1;
    this.#inner = deps.doc.createElement("div");
    this.#inner.className = "strip-inner";
    this.element.append(this.#inner);
    for (let page = 1; page <= deps.source.pageCount; page++) {
      const slot = deps.doc.createElement("div");
      slot.className = "slot";
      slot.dataset.page = String(page);
      this.#slots.push(slot);
      fillSlot(deps, slot, page);
    }
    this.#number = deps.doc.createElement("span");
    this.#number.className = "strip-current";
    this.#number.setAttribute("aria-hidden", "true");
    this.#inner.append(...this.#slots, this.#number);
    this.element.addEventListener("scroll", () => this.#schedule());
  }

  get layoutInfo(): StripLayout {
    return this.#layout;
  }

  refresh(page: number): void {
    const slot = this.#slots[page - 1];
    if (slot) fillSlot(this.#deps, slot, page);
  }

  // Lays out every slot, keeping the spot under the middle of the screen there, across and
  // down, so zooming or a page learning its size never moves what's being looked at. Pages
  // center on one line down the strip. The insets add room above the first page, below the
  // last and on the left, so none stays under the UI; pages wider than the space left get half
  // a screen of room on both sides too, so panning can bring either edge to the middle.
  layout(): void {
    const el = this.element;
    const viewport = this.#deps.viewport();
    const screen = { width: el.clientWidth || viewport.width, height: el.clientHeight || viewport.height };
    const before = this.#layout;
    let anchor: { index: number; down: number; across: number } | null = null;
    if (before.tops.length > 0) {
      const y = el.scrollTop + screen.height / 2 - this.#top;
      const index = pageAt(before, y) - 1;
      const height = before.heights[index]!;
      const width = before.widths[index]!;
      anchor = {
        index,
        down: height > 0 ? Math.min(1, Math.max(0, (y - before.tops[index]!) / height)) : 0,
        across: width > 0 ? (el.scrollLeft + screen.width / 2 - this.#axis) / width : 0,
      };
    }

    const insets = this.#deps.insets();
    const sizes = this.#slots.map((_, i) => displaySize(naturalSize(this.#deps, i + 1), viewport, this.#deps.zoom()));
    const layout = stripLayout(sizes);
    this.#layout = layout;
    this.#top = insets.top;
    const widest = Math.max(0, ...layout.widths);
    const slack = widest > screen.width - insets.left ? Math.round(screen.width / 2) : 0;
    const left = Math.max(slack, insets.left);
    const width = slack > 0 ? left + widest + slack : screen.width;
    this.#axis = left + (width - left - slack) / 2;
    this.#inner.style.width = `${width}px`;
    this.#inner.style.height = `${insets.top + layout.total + insets.bottom}px`;
    this.#slots.forEach((slot, i) => {
      const slotLeft = Math.round(this.#axis - layout.widths[i]! / 2);
      slot.style.top = `${insets.top + layout.tops[i]!}px`;
      slot.style.left = `${slotLeft}px`;
      // No room beside the page for the current page's mark: it goes just inside instead.
      slot.classList.toggle("snug", slotLeft - insets.left < CURRENT_MARK_ROOM);
      slot.style.width = `${layout.widths[i]}px`;
      slot.style.height = `${layout.heights[i]}px`;
    });
    this.element.classList.toggle("pannable", slack > 0);
    const across = anchor ? this.#axis + anchor.across * layout.widths[anchor.index]! : this.#axis;
    el.scrollLeft = Math.min(Math.max(0, width - screen.width), Math.max(0, across - screen.width / 2));
    if (anchor) el.scrollTop = Math.max(0, this.#top + layout.tops[anchor.index]! + anchor.down * layout.heights[anchor.index]! - screen.height / 2);
    this.#placeNumber();
  }

  layoutSoon(): void {
    this.#needsLayout = true;
    this.#schedule();
  }

  // Puts a page in the middle of the space the UI leaves, or its top just below the UI when
  // it's taller than that space.
  scrollToPage(page: number): void {
    const index = page - 1;
    const top = this.#top + (this.#layout.tops[index] ?? 0);
    const height = this.#layout.heights[index] ?? 0;
    const insets = this.#deps.insets();
    const free = (this.element.clientHeight || this.#deps.viewport().height) - insets.top - insets.bottom;
    this.#markCurrent(page);
    this.element.scrollTop = Math.max(0, height < free ? top + height / 2 - free / 2 - insets.top : top - insets.top);
  }

  // The page under the middle of the screen.
  pageInView(): number {
    const viewportHeight = this.element.clientHeight || this.#deps.viewport().height;
    return pageAt(this.#layout, this.element.scrollTop - this.#top + viewportHeight / 2);
  }

  destroy(): void {
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  // The current page has a mark beside it: a bar down its side with its number at the top.
  #markCurrent(page: number): void {
    this.#slots[this.#current - 1]?.classList.remove("current");
    this.#current = page;
    this.#slots[page - 1]?.classList.add("current");
    this.#number.textContent = String(page);
    this.#placeNumber();
  }

  // The number sits by the top of the current page, or lower while that top is scrolled out
  // of view (or under a pinned toolbar), never past the page's bottom. Beside the page, or
  // inside its edge when there's no room or a zoomed page's edge is panned out of view.
  #placeNumber(): void {
    const index = this.#current - 1;
    const slot = this.#slots[index];
    if (!slot || this.#layout.tops.length <= index) return;
    const insets = this.#deps.insets();
    const top = this.#top + this.#layout.tops[index]!;
    const visibleTop = this.element.scrollTop + insets.top + 8;
    this.#number.style.top = `${Math.max(top, Math.min(visibleTop, top + this.#layout.heights[index]! - 24))}px`;
    const left = parseFloat(slot.style.left);
    const visibleLeft = this.element.scrollLeft + insets.left;
    const outOfView = left - CURRENT_MARK_ROOM - NUMBER_WIDTH < visibleLeft;
    this.#number.style.left = `${outOfView ? Math.max(left, visibleLeft) : left}px`;
    this.#number.classList.toggle("snug", slot.classList.contains("snug") || outOfView);
  }

  #schedule(): void {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      if (this.#needsLayout) {
        this.#needsLayout = false;
        this.layout();
      }
      // Hidden (page mode now), it says nothing: a frame its last scroll asked for can come
      // after the switch, and a hidden strip reads as scrolled to its top.
      if (this.element.hidden) return;
      this.#placeNumber();
      const page = this.pageInView();
      if (page !== this.#current) {
        this.#markCurrent(page);
        this.#onCurrent(page);
      }
    });
  }
}
