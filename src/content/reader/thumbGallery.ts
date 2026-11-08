// The in-reader gallery: a filmstrip (along the bottom, or on the left edge) or a grid over
// the whole reader. Cells share one size, so the cells on screen follow from the scroll
// position alone.
import type { Thumb } from "../../site/gallery";
import { icon } from "../../shared/icons";
import { MIN_GRID_SIZE } from "../../shared/settings";
import { actionOf, badgeOf, type ActionId } from "./shortcuts";

export type ThumbView = "filmstrip" | "grid";

export const GAP: Record<ThumbView, number> = { filmstrip: 6, grid: 12 };
export const CELL_ASPECT = 1.4; // cell height / width

// Thumbnail pages near what's on screen are fetched once scrolling stops this long, so a fast
// scroll through a big gallery only fetches where it stops.
export const FETCH_DELAY_MS = 500;

// Cells drawn beyond the visible ones, on each side, in screens.
const MARGIN_SCREENS = 1;

// Where the current page sits along the view: the filmstrip keeps it a third of the way in, so
// a few past pages stay in sight and most of it shows what's ahead. The grid centers it.
export const CURRENT_AT: Record<ThumbView, number> = { filmstrip: 1 / 3, grid: 1 / 2 };

// Pixels per line for mouse wheels that scroll by lines.
const WHEEL_LINE_PX = 40;

export interface CellBox {
  width: number;
  height: number;
  gap: number;
}

export function cellBox(view: ThumbView, width: number): CellBox {
  return { width, height: Math.round(width * CELL_ASPECT), gap: GAP[view] };
}

export interface VisibleRange {
  first: number; // 1-based pages, inclusive
  last: number;
}

// Pages a scroll position shows, with the margin. Cells run along x (horizontal filmstrip)
// or in rows along y (grid, or a vertical filmstrip with one column). `viewport` is the
// scroll box's size.
export function visibleRange(
  cell: CellBox,
  axis: "x" | "y",
  scroll: { left: number; top: number },
  viewport: { width: number; height: number },
  pageCount: number,
): VisibleRange {
  const strideX = cell.width + cell.gap;
  const strideY = cell.height + cell.gap;
  if (axis === "x") {
    const margin = viewport.width * MARGIN_SCREENS;
    const first = Math.floor(Math.max(0, scroll.left - margin) / strideX) + 1;
    const last = Math.ceil((scroll.left + viewport.width + margin) / strideX);
    return { first: Math.min(first, pageCount), last: Math.min(Math.max(last, first), pageCount) };
  }
  const columns = columnsFor(cell, viewport.width);
  const margin = viewport.height * MARGIN_SCREENS;
  const firstRow = Math.floor(Math.max(0, scroll.top - margin) / strideY);
  const lastRow = Math.ceil((scroll.top + viewport.height + margin) / strideY);
  return { first: Math.min(firstRow * columns + 1, pageCount), last: Math.min(Math.max(lastRow * columns, 1), pageCount) };
}

// Nearest `center` first; of two as near, the one ahead first.
export function nearestFirst(thumbPages: number[], center: number): number[] {
  return [...thumbPages].sort((a, b) => Math.abs(a - center) - Math.abs(b - center) || b - a);
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Where the hover preview of a cell goes, in the same coordinates as `cell`: `width` px wide,
// grown away from the edge the view sits on ("bottom" filmstrip, "left" filmstrip, or from the
// cell's middle in the grid), then kept `margin` px inside the viewport.
export function previewBox(cell: Box, grow: "up" | "right" | "out", width: number, viewport: { width: number; height: number }, margin = 8): Box {
  const scale = width / cell.width;
  const w = cell.width * scale;
  const h = cell.height * scale;
  let left = cell.left + cell.width / 2 - w / 2;
  let top = cell.top + cell.height / 2 - h / 2;
  if (grow === "up") top = cell.top + cell.height - h;
  if (grow === "right") left = cell.left;
  const fit = (start: number, size: number, room: number) => (size + 2 * margin >= room ? margin : Math.min(Math.max(start, margin), room - margin - size));
  return { left: fit(left, w, viewport.width), top: fit(top, h, viewport.height), width: w, height: h };
}

export function columnsFor(cell: CellBox, width: number): number {
  return Math.max(1, Math.floor((width + cell.gap) / (cell.width + cell.gap)));
}

export interface ThumbGalleryDeps {
  doc: Document;
  pageCount: number;
  thumb: (page: number) => Thumb | undefined;
  thumbPageOf: (page: number) => number;
  // The thumbnail pages to fetch, most important first, replacing the previous list.
  wantThumbPages: (thumbPages: number[]) => void;
  onPick: (page: number) => void;
  onSpriteError?: (page: number) => void; // a thumbnail picture failed to load
  onGridSize?: (size: GridSize) => void; // a grid handle was let go
  onAction: (id: ActionId) => void; // the panel's own buttons
  describe?: (id: ActionId) => string; // tooltip with the current key
  badge?: (id: ActionId) => string; // the current key
}

// A page worth finding besides the current one: the furthest page ever read, null when there's
// none.
export interface ReadingMarks {
  furthest: number | null;
}

export interface ThumbGalleryOptions {
  width: number;
  vertical: boolean; // filmstrip only
  hover: number | null; // the hover preview's width in px, null when it's off
  gridWidth?: number | null; // grid only: how wide the grid is in px, null for the whole width
  gridHeight?: number | null; // likewise, how tall
}

export interface GridSize {
  width: number | null;
  height: number | null;
}

// The grid keeps a gutter this wide on each side for its handles, which sit in it a little
// apart from the grid, clear of its scrollbar.
export const GRID_GUTTER = 40;
export const HANDLE_GAP = 8;

// The grid's size along one axis while a handle is dragged to `position`: twice the distance
// from the middle of the space it has (`start`, `length`), so it shrinks on both sides and
// stays centered. Null once it's as large as it gets.
export function gridSizeAt(position: number, start: number, length: number): number | null {
  const full = length - 2 * GRID_GUTTER;
  const size = Math.round(Math.max(MIN_GRID_SIZE, 2 * Math.abs(position - (start + length / 2))));
  return size >= full - 4 ? null : size;
}

// The horizontal filmstrip stacks its control groups in three rows (first and last, scroll to,
// size) when it's tall enough for them, else two (first and last with scroll to, then size):
// 26 px buttons, 6 px apart, inside 6 px of padding.
const CONTROL_ROW = 26;
const CONTROL_GAP = 6;
export function filmstripControlRows(cellHeight: number): 2 | 3 {
  const strip = cellHeight + 2 * GAP.filmstrip;
  return strip >= 3 * CONTROL_ROW + 2 * CONTROL_GAP + 2 * 6 ? 3 : 2;
}

export class ThumbGallery {
  readonly element: HTMLDivElement;
  readonly scroller: HTMLDivElement;
  readonly #view: ThumbView;
  readonly #deps: ThumbGalleryDeps;
  readonly #cells: HTMLDivElement[] = [];
  readonly #preview: HTMLDivElement;
  readonly #controlsBox: HTMLDivElement;
  readonly #size: HTMLButtonElement[];
  readonly #ends: HTMLButtonElement[]; // to the first and last pages
  readonly #scrollTo: HTMLButtonElement[]; // to the current and furthest pages
  #stage: HTMLDivElement | null = null; // the grid's, around its scroll box
  readonly #furthestButton: HTMLButtonElement;
  #marks: ReadingMarks = { furthest: null };
  readonly #controls: { id: ActionId; button: HTMLButtonElement; badge: HTMLElement }[] = [];
  #options: ThumbGalleryOptions;
  #current = 0;
  #buffered = new Set<number>();
  #frame = 0;
  #fetchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(view: ThumbView, deps: ThumbGalleryDeps, options: ThumbGalleryOptions) {
    this.#view = view;
    this.#deps = deps;
    this.#options = options;
    const doc = deps.doc;
    this.element = doc.createElement("div");
    this.element.className = `thumbs ${view}`;
    this.element.hidden = true;
    this.scroller = doc.createElement("div");
    this.scroller.className = "thumb-scroll";
    for (let page = 1; page <= deps.pageCount; page++) {
      const el = doc.createElement("div");
      el.className = "cell";
      el.dataset.page = String(page);
      el.title = `Page ${page}`;
      const label = doc.createElement("span");
      label.className = "number";
      label.textContent = String(page);
      el.append(label);
      this.#cells.push(el);
    }
    this.scroller.append(...this.#cells);

    // The controls, in three groups by purpose: first and last, scroll to, and size. See
    // #layoutControls. Hover zoom and the filmstrip's position are the toolbar's.
    this.#controlsBox = doc.createElement("div");
    this.#controlsBox.className = "thumb-controls";
    // The reader's control vocabulary: actions, with their keys.
    const control = (label: string, id: ActionId) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "action";
      const badge = keyBadge(doc, "");
      button.append(label, badge);
      this.#controls.push({ id, button, badge });
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => deps.onAction(id));
      return button;
    };
    this.#size = [control("−", "thumbsSmaller"), control("+", "thumbsLarger")];
    // Moving around the view: buttons without keys of their own. Start and end point along the
    // view, so they turn with a horizontal filmstrip. Jumping scrolls; the page stays.
    const move = (name: "toStart" | "target" | "toEnd" | "flag", label: string, onClick: () => void) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "action icon-button";
      button.title = label;
      button.setAttribute("aria-label", label);
      const glyph = icon(name, doc);
      if (name === "toStart" || name === "toEnd") glyph.classList.add("along");
      button.append(glyph);
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", onClick);
      return button;
    };
    this.#furthestButton = move("flag", "Scroll to the furthest page read", () => this.#scrollToFurthest());
    this.#furthestButton.disabled = true; // until there's a furthest page
    this.#ends = [move("toStart", "Scroll to the start", () => this.scrollToStart()), move("toEnd", "Scroll to the end", () => this.scrollToEnd())];
    this.#scrollTo = [move("target", "Scroll to the current page", () => this.scrollToCurrent()), this.#furthestButton];

    // Floats above the scroll box, which would clip a cell scaled in place.
    this.#preview = doc.createElement("div");
    this.#preview.className = "hover-preview";
    this.#preview.hidden = true;

    // The grid sits centered on a stage, with room around it for its handles.
    if (view === "grid") {
      this.#stage = doc.createElement("div");
      this.#stage.className = "grid-stage";
      this.#stage.append(this.scroller);
    }
    this.element.append(this.#stage ?? this.scroller, this.#controlsBox, this.#preview);
    if (view === "grid") this.#addHandles();
    this.scroller.addEventListener("click", (event) => {
      const cell = (event.target as Element).closest<HTMLElement>(".cell");
      if (cell) this.#deps.onPick(Number(cell.dataset.page));
    });
    this.scroller.addEventListener("scroll", () => {
      this.#hidePreview();
      this.#schedule();
    });
    // A mouse wheel scrolls the horizontal filmstrip sideways. Sideways wheels and touchpads
    // already do.
    this.scroller.addEventListener(
      "wheel",
      (event) => {
        if (this.#axis() !== "x" || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
        const unit = event.deltaMode === 1 ? WHEEL_LINE_PX : event.deltaMode === 2 ? this.#viewport().width : 1;
        this.scroller.scrollLeft += event.deltaY * unit;
        event.preventDefault();
      },
      { passive: false },
    );
    this.scroller.addEventListener("mouseover", (event) => {
      const cell = (event.target as Element).closest<HTMLElement>(".cell");
      if (cell && !cell.contains(event.relatedTarget as Node | null)) this.#showPreview(cell);
    });
    this.scroller.addEventListener("mouseout", (event) => {
      const cell = (event.target as Element).closest<HTMLElement>(".cell");
      if (cell && !cell.contains(event.relatedTarget as Node | null)) this.#hidePreview();
    });
    this.refreshKeys();
    this.#applyOptions();
  }

  // Shows the current keys on the panel's buttons.
  refreshKeys(): void {
    for (const { id, button, badge } of this.#controls) {
      const key = this.#deps.badge?.(id) ?? badgeOf(id);
      badge.textContent = key;
      badge.hidden = key === "";
      button.title = this.#deps.describe?.(id) ?? `${actionOf(id).description} (${key})`;
    }
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  get options(): ThumbGalleryOptions {
    return { ...this.#options };
  }

  open(): void {
    this.element.hidden = false;
    this.scrollToCurrent();
    this.update();
  }

  close(): void {
    this.element.hidden = true;
    this.#hidePreview();
    if (this.#fetchTimer !== null) clearTimeout(this.#fetchTimer);
    this.#fetchTimer = null;
    this.#deps.wantThumbPages([]);
  }

  setOptions(options: Partial<ThumbGalleryOptions>): void {
    if (options.gridWidth !== undefined || options.gridHeight !== undefined) {
      this.#setGridSize({ width: options.gridWidth ?? this.#options.gridWidth ?? null, height: options.gridHeight ?? this.#options.gridHeight ?? null });
    }
    const before = this.#options;
    this.#options = { ...before, ...options };
    if (this.#options.hover === null) this.#hidePreview();
    if (this.#options.width === before.width && this.#options.vertical === before.vertical) return;
    this.#applyOptions();
    if (this.isOpen) {
      this.scrollToCurrent();
      this.update();
    }
  }

  setCurrent(page: number): void {
    this.#cells[this.#current - 1]?.classList.remove("current");
    this.#current = page;
    this.#cells[page - 1]?.classList.add("current");
    // The filmstrip follows the current page; the grid scrolls only once it's out of view.
    if (this.isOpen && (this.#view === "filmstrip" || !this.#inView(page))) this.scrollToCurrent();
  }

  setBuffered(pages: Iterable<number>): void {
    const next = new Set(pages);
    for (const page of this.#buffered) if (!next.has(page)) this.#cells[page - 1]?.classList.remove("buffered");
    for (const page of next) this.#cells[page - 1]?.classList.add("buffered");
    this.#buffered = next;
  }

  // Marks how far reading ever got on its cell, and enables the button that scrolls there.
  setMarks(marks: ReadingMarks): void {
    const before = this.#marks.furthest;
    if (before !== null) this.#cells[before - 1]?.querySelector(".mark.furthest")?.remove();
    const page = marks.furthest;
    if (page !== null) {
      const mark = this.#deps.doc.createElement("span");
      mark.className = "mark furthest";
      mark.title = "The furthest page read";
      mark.textContent = "Furthest";
      this.#cells[page - 1]?.append(mark);
    }
    this.#furthestButton.disabled = page === null;
    this.#marks = { ...marks };
  }

  #scrollToFurthest(): void {
    const page = this.#marks.furthest;
    if (page !== null) this.#scrollToPage(page, CURRENT_AT[this.#view]);
  }

  scrollToStart(): void {
    if (this.#axis() === "x") this.scroller.scrollLeft = 0;
    else this.scroller.scrollTop = 0;
  }

  // Jumps straight there: nothing in between is drawn or fetched.
  scrollToEnd(): void {
    const cell = this.#cell();
    const box = this.#viewport();
    if (this.#axis() === "x") {
      this.scroller.scrollLeft = Math.max(0, this.#deps.pageCount * (cell.width + cell.gap) - box.width);
    } else {
      const rows = Math.ceil(this.#deps.pageCount / columnsFor(cell, box.width));
      this.scroller.scrollTop = Math.max(0, rows * (cell.height + cell.gap) - box.height);
    }
  }

  // Puts the current page at its place along the view (CURRENT_AT).
  scrollToCurrent(): void {
    this.#scrollToPage(this.#current, CURRENT_AT[this.#view]);
  }

  // Puts `page` `at` this far along the view.
  #scrollToPage(page: number, at: number): void {
    const index = page - 1;
    if (index < 0) return;
    const cell = this.#cell();
    const box = this.#viewport();
    if (this.#axis() === "x") {
      this.scroller.scrollLeft = Math.max(0, index * (cell.width + cell.gap) + cell.width / 2 - box.width * at);
    } else {
      const row = Math.floor(index / columnsFor(cell, box.width));
      this.scroller.scrollTop = Math.max(0, row * (cell.height + cell.gap) + cell.height / 2 - box.height * at);
    }
  }

  // Draws the thumbnails near what's on screen and asks for the thumbnail pages they need,
  // nearest the middle of the screen first, so the ones in view arrive before the margins.
  update(): void {
    if (!this.isOpen) return;
    const range = this.range();
    const missing = new Set<number>();
    for (let page = range.first; page <= range.last; page++) {
      if (!this.#draw(page)) missing.add(this.#deps.thumbPageOf(page));
    }
    const middle = this.#deps.thumbPageOf(Math.round((range.first + range.last) / 2));
    const wanted = nearestFirst([...missing], middle);
    if (this.#fetchTimer !== null) clearTimeout(this.#fetchTimer);
    this.#fetchTimer = setTimeout(() => {
      this.#fetchTimer = null;
      this.#deps.wantThumbPages(wanted);
    }, FETCH_DELAY_MS);
  }

  range(): VisibleRange {
    return visibleRange(this.#cell(), this.#axis(), { left: this.scroller.scrollLeft, top: this.scroller.scrollTop }, this.#viewport(), this.#deps.pageCount);
  }

  destroy(): void {
    this.close();
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  #cell(): CellBox {
    return cellBox(this.#view, this.#options.width);
  }

  #axis(): "x" | "y" {
    return this.#view === "filmstrip" && !this.#options.vertical ? "x" : "y";
  }

  #applyOptions(): void {
    this.#applyGridSize();
    const cell = this.#cell();
    const vertical = this.#view === "filmstrip" && this.#options.vertical;
    this.element.classList.toggle("vertical", vertical);
    this.element.style.setProperty("--cell-width", `${cell.width}px`);
    this.element.style.setProperty("--cell-height", `${cell.height}px`);
    for (const el of this.#cells) {
      el.style.width = `${cell.width}px`;
      el.style.height = `${cell.height}px`;
      el.querySelector(".sprite")?.remove(); // drawn again at the new scale
    }
    this.#layoutControls();
  }

  // Lays the controls out for where they are, in their groups: first and last (⇤ ⇥), scroll
  // to (the current page, the furthest page read) and size (− +).
  // - The grid: one row along its bottom, the groups apart.
  // - The filmstrip along the bottom: a group a row at its end, or the two kinds of jumps
  //   sharing the first row when the strip is too short for three.
  // - The filmstrip on the left edge: a header of a fixed width, which the thumbnail size
  //   never changes, with each group a column of two, so the strip keeps its height.
  #layoutControls(): void {
    const doc = this.#deps.doc;
    const group = (name: string, className: string, items: HTMLElement[]) => {
      const el = doc.createElement("div");
      el.className = `thumb-group ${className}`;
      el.setAttribute("role", "group");
      el.setAttribute("aria-label", name);
      el.append(...items);
      return el;
    };
    const divider = () => {
      const el = doc.createElement("span");
      el.className = "divider";
      return el;
    };
    const ends = group("First and last", "ends", this.#ends);
    const scrollTo = group("Scroll to", "scroll-to", this.#scrollTo);
    const size = group("Thumbnail size", "size", this.#size);
    const box = this.#controlsBox;
    if (this.#view === "grid" || this.#options.vertical) {
      box.replaceChildren(ends, divider(), scrollTo, divider(), size);
    } else if (filmstripControlRows(this.#cell().height) === 3) {
      box.replaceChildren(ends, scrollTo, size);
    } else {
      const row = doc.createElement("div");
      row.className = "thumb-row";
      row.append(ends, divider(), scrollTo);
      box.replaceChildren(row, size);
    }
  }

  #viewport(): { width: number; height: number } {
    const win = this.#deps.doc.defaultView;
    const cell = this.#cell();
    const vertical = this.#axis() === "y" && this.#view === "filmstrip";
    return {
      width: this.scroller.clientWidth || (vertical ? cell.width : this.#gridSize(win?.innerWidth ?? 0, "width")) || 1,
      height: this.scroller.clientHeight || this.#gridSize(win?.innerHeight ?? 0, "height") || 1,
    };
  }

  // The grid's size along an axis in a window `length` long; the window's for the other views.
  #gridSize(length: number, axis: "width" | "height"): number {
    if (this.#view !== "grid") return length;
    const full = length - 2 * GRID_GUTTER;
    const set = axis === "width" ? this.#options.gridWidth : this.#options.gridHeight;
    return Math.min(full, set ?? full);
  }

  // Grab strips in the gutters on all four sides of the grid. Dragging one shrinks or grows the
  // grid around its middle along that axis, live, keeping the page in the middle of the view
  // where it is. Letting go saves the size; double-clicking resets that axis to the whole space.
  #addHandles(): void {
    const doc = this.#deps.doc;
    for (const side of ["left", "right", "top", "bottom"] as const) {
      const axis = side === "left" || side === "right" ? "width" : "height";
      const handle = doc.createElement("div");
      handle.className = `grid-handle ${side}`;
      handle.title = `Drag to change the grid's ${axis}; double-click for the whole ${axis}`;
      handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        handle.setPointerCapture?.(event.pointerId);
        handle.classList.add("dragging");
      });
      handle.addEventListener("pointermove", (event) => {
        if (!handle.classList.contains("dragging")) return;
        const stage = this.#stage!.getBoundingClientRect();
        const win = doc.defaultView;
        const [start, length] = axis === "width" ? [stage.left, stage.width || (win?.innerWidth ?? 0)] : [stage.top, stage.height || (win?.innerHeight ?? 0)];
        const size = gridSizeAt(axis === "width" ? event.clientX : event.clientY, start, length);
        this.#setGridSize({ ...this.#gridSizes(), [axis]: size });
      });
      const end = () => {
        if (!handle.classList.contains("dragging")) return;
        handle.classList.remove("dragging");
        this.#deps.onGridSize?.(this.#gridSizes());
      };
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
      handle.addEventListener("dblclick", () => {
        this.#setGridSize({ ...this.#gridSizes(), [axis]: null });
        this.#deps.onGridSize?.(this.#gridSizes());
      });
      this.#stage!.append(handle);
    }
  }

  #gridSizes(): GridSize {
    return { width: this.#options.gridWidth ?? null, height: this.#options.gridHeight ?? null };
  }

  #setGridSize(size: GridSize): void {
    const before = this.#gridSizes();
    if (size.width === before.width && size.height === before.height) return;
    const anchor = this.isOpen ? this.#middlePage() : null;
    this.#options = { ...this.#options, gridWidth: size.width, gridHeight: size.height };
    this.#applyGridSize();
    if (anchor !== null) {
      this.#scrollToPage(anchor, 0.5);
      this.update();
    }
  }

  #applyGridSize(): void {
    if (this.#view !== "grid") return;
    const full = `calc(100% - ${2 * GRID_GUTTER}px)`;
    const { width, height } = this.#gridSizes();
    this.element.style.setProperty("--grid-width", width ? `min(${width}px, ${full})` : full);
    this.element.style.setProperty("--grid-height", height ? `min(${height}px, ${full})` : full);
  }

  // The page in the middle of the view: the middle of the row under its middle.
  #middlePage(): number {
    const cell = this.#cell();
    const box = this.#viewport();
    const columns = columnsFor(cell, box.width);
    const row = Math.floor((this.scroller.scrollTop + box.height / 2) / (cell.height + cell.gap));
    return Math.min(this.#deps.pageCount, row * columns + Math.ceil(columns / 2));
  }

  // Whether the page's cell is fully on screen.
  #inView(page: number): boolean {
    const cell = this.#cell();
    const box = this.#viewport();
    const index = page - 1;
    if (this.#axis() === "x") {
      const left = index * (cell.width + cell.gap);
      return left >= this.scroller.scrollLeft && left + cell.width <= this.scroller.scrollLeft + box.width;
    }
    const top = Math.floor(index / columnsFor(cell, box.width)) * (cell.height + cell.gap);
    return top >= this.scroller.scrollTop && top + cell.height <= this.scroller.scrollTop + box.height;
  }

  // Returns false when the page's thumbnail isn't known yet. Draws it again when its picture
  // changed, e.g. after its thumbnail page was fetched again.
  #draw(page: number): boolean {
    const el = this.#cells[page - 1];
    if (!el) return true;
    const thumb = this.#deps.thumb(page);
    const sprite = thumb?.sprite;
    if (!sprite || sprite.width <= 0 || sprite.height <= 0) return thumb !== undefined;
    const drawn = el.querySelector<HTMLElement>(".sprite");
    if (drawn?.dataset.url === sprite.url) return true;
    drawn?.remove();
    const cell = this.#cell();
    const scale = Math.min(cell.width / sprite.width, cell.height / sprite.height);
    const doc = this.#deps.doc;
    // The cell of the sprite sheet: the sheet as an image, shifted and clipped. An image rather
    // than a CSS background, so a picture that fails to load says so.
    const inner = doc.createElement("div");
    inner.className = "sprite";
    inner.dataset.url = sprite.url;
    inner.style.width = `${sprite.width}px`;
    inner.style.height = `${sprite.height}px`;
    inner.style.left = `${Math.round((cell.width - sprite.width * scale) / 2)}px`;
    inner.style.top = `${Math.round((cell.height - sprite.height * scale) / 2)}px`;
    inner.style.transform = `scale(${scale})`;
    const img = doc.createElement("img");
    img.alt = "";
    img.decoding = "async";
    img.style.left = `${sprite.x}px`;
    img.style.top = `${sprite.y}px`;
    img.addEventListener("error", () => this.#deps.onSpriteError?.(page), { once: true });
    img.src = sprite.url;
    inner.append(img);
    el.prepend(inner);
    return true;
  }

  // A copy of the hovered cell placed over it, then grown with a transition to its preview box,
  // which stays inside the reader near its edges.
  #showPreview(cell: HTMLElement): void {
    const size = this.#options.hover;
    const rect = cell.getBoundingClientRect();
    if (size === null || rect.width <= 0 || size <= rect.width) return;
    const preview = this.#preview;
    const own = this.element.getBoundingClientRect();
    const win = this.#deps.doc.defaultView;
    const grow = this.#view === "grid" ? "out" : this.#options.vertical ? "right" : "up";
    const box = previewBox(rect, grow, size, { width: win?.innerWidth ?? 0, height: win?.innerHeight ?? 0 });
    preview.replaceChildren(...[...cell.children].map((child) => child.cloneNode(true)));
    preview.style.left = `${rect.left - own.left}px`;
    preview.style.top = `${rect.top - own.top}px`;
    preview.style.width = `${rect.width}px`;
    preview.style.height = `${rect.height}px`;
    preview.classList.toggle("current", cell.classList.contains("current"));
    preview.style.transition = "none";
    preview.style.transform = "none";
    preview.hidden = false;
    void preview.getBoundingClientRect(); // starts the transition from the cell
    preview.style.transition = "";
    preview.style.transform = `translate(${box.left - rect.left}px, ${box.top - rect.top}px) scale(${box.width / rect.width})`;
  }

  #hidePreview(): void {
    this.#preview.hidden = true;
    this.#preview.replaceChildren();
  }

  #schedule(): void {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.update();
    });
  }
}

export function keyBadge(doc: Document, key: string): HTMLElement {
  const badge = doc.createElement("kbd");
  badge.className = "key";
  badge.textContent = key;
  return badge;
}
