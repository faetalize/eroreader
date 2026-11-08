import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cellBox, FETCH_DELAY_MS, filmstripControlRows, gridSizeAt, previewBox, type GridSize, ThumbGallery, visibleRange, type ThumbGalleryOptions } from "../src/content/reader/thumbGallery";
import type { ActionId } from "../src/content/reader/shortcuts";
import { PER_PAGE, thumbPage } from "./reader-fakes";

describe("visibleRange", () => {
  const filmstrip = cellBox("filmstrip", 80); // 80 × 112, 6 apart
  const grid = cellBox("grid", 150); // 150 × 210, 12 apart

  it("covers the horizontal filmstrip's screen plus a screen on each side", () => {
    expect(visibleRange(filmstrip, "x", { left: 0, top: 0 }, { width: 860, height: 124 }, 500)).toEqual({ first: 1, last: 20 });
    expect(visibleRange(filmstrip, "x", { left: 86 * 100, top: 0 }, { width: 860, height: 124 }, 500)).toEqual({ first: 91, last: 120 });
    expect(visibleRange(filmstrip, "x", { left: 0, top: 0 }, { width: 860, height: 124 }, 7)).toEqual({ first: 1, last: 7 });
  });

  it("covers a single column for the vertical filmstrip", () => {
    // Rows are 118 px apart; a 590 px screen plus a 590 px margin on each side.
    expect(visibleRange(filmstrip, "y", { left: 0, top: 118 * 50 }, { width: 80, height: 590 }, 500)).toEqual({ first: 46, last: 60 });
  });

  it("covers whole rows of the grid", () => {
    // 1000 px wide fits 6 columns of 150 + 12; rows are 222 px apart, and a 444 px screen plus
    // a 444 px margin on each side spans 4 rows past the top.
    expect(visibleRange(grid, "y", { left: 0, top: 0 }, { width: 1000, height: 444 }, 500)).toEqual({ first: 1, last: 24 });
    expect(visibleRange(grid, "y", { left: 0, top: 222 * 10 }, { width: 1000, height: 444 }, 500)).toEqual({ first: 49, last: 84 });
  });

  it("follows the cell size", () => {
    expect(cellBox("grid", 100)).toEqual({ width: 100, height: 140, gap: 12 });
    expect(visibleRange(cellBox("grid", 100), "y", { left: 0, top: 0 }, { width: 1000, height: 456 }, 500).last).toBe(9 * 6);
  });
});

describe("ThumbGallery", () => {
  const PAGES = 200;
  let stored: Set<number>;
  let wanted: number[][]; // each list the gallery asked for
  let picked: number[];
  let actions: ActionId[];

  function make(view: "filmstrip" | "grid" = "filmstrip", options: Partial<ThumbGalleryOptions> = {}) {
    const gallery = new ThumbGallery(
      view,
      {
        doc: document,
        pageCount: PAGES,
        thumb: (page) => {
          const p = Math.floor((page - 1) / PER_PAGE);
          return stored.has(p) ? thumbPage(p, PAGES).thumbs.find((t) => t.page === page) : undefined;
        },
        thumbPageOf: (page) => Math.floor((page - 1) / PER_PAGE),
        wantThumbPages: (pages) => wanted.push(pages),
        onPick: (page) => picked.push(page),
        onAction: (id) => actions.push(id),
      },
      { width: view === "grid" ? 150 : 80, vertical: false, hover: 120, ...options },
    );
    document.body.append(gallery.element);
    return gallery;
  }
  const cell = (gallery: ThumbGallery, page: number) => gallery.element.querySelector<HTMLElement>(`.cell[data-page="${page}"]`)!;
  const preview = (gallery: ThumbGallery) => gallery.element.querySelector<HTMLElement>(".hover-preview")!;
  const hover = (el: Element) => el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body }));
  const leave = (el: Element) => el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));

  beforeEach(() => {
    vi.useFakeTimers();
    stored = new Set([0]);
    wanted = [];
    picked = [];
    actions = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("has a cell per page and stays closed until opened", () => {
    const gallery = make();
    expect(gallery.element.querySelectorAll(".cell")).toHaveLength(PAGES);
    expect(gallery.isOpen).toBe(false);
    expect(gallery.element.querySelector(".sprite")).toBeNull();
  });

  it("draws the stored thumbnails near what's on screen, scaled into the cell", () => {
    const gallery = make();
    gallery.open();
    const sprite = cell(gallery, 3).querySelector<HTMLElement>(".sprite")!;
    const img = sprite.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("s"); // the sprite sheet, at the cell's offset in it
    expect([img.style.left, img.style.top]).toEqual(["0px", "0px"]);
    expect(sprite.style.transform).toBe(`scale(${80 / 200})`);
    expect(cell(gallery, 150).querySelector(".sprite")).toBeNull(); // far off screen
  });

  it("fetches the missing thumbnail pages on screen once scrolling stops", () => {
    const gallery = make();
    gallery.setCurrent(45);
    gallery.open();
    expect(wanted).toEqual([]);
    // Around page 45 on a 1024 px wide screen, nearest the middle first, ahead before behind.
    vi.advanceTimersByTime(FETCH_DELAY_MS);
    expect(wanted).toEqual([[2, 3, 1]]);
  });

  it("gives up its thumbnail pages when it closes, even before the delay", () => {
    const gallery = make();
    gallery.setCurrent(45);
    gallery.open();
    vi.advanceTimersByTime(FETCH_DELAY_MS - 1);
    gallery.close();
    vi.advanceTimersByTime(FETCH_DELAY_MS);
    expect(wanted).toEqual([[]]);
  });

  it("keeps the current page a third of the way into the filmstrip as pages change", () => {
    const gallery = make(); // 80 px cells 6 apart, on a 1024 px wide screen
    gallery.open();
    const left = (page: number) => (page - 1) * 86 + 40 - 1024 / 3;
    gallery.setCurrent(100);
    expect(gallery.scroller.scrollLeft).toBeCloseTo(left(100));
    gallery.setCurrent(101); // already in view, still followed
    expect(gallery.scroller.scrollLeft).toBeCloseTo(left(101));
    gallery.setCurrent(2);
    expect(gallery.scroller.scrollLeft).toBe(0); // the start can't scroll further
  });

  it("scrolls the grid only when the current page leaves the view", () => {
    const gallery = make("grid");
    gallery.setCurrent(100);
    gallery.open();
    const top = gallery.scroller.scrollTop;
    gallery.setCurrent(101);
    expect(gallery.scroller.scrollTop).toBe(top);
  });

  it("scrolls the horizontal filmstrip sideways with a mouse wheel", () => {
    const gallery = make();
    gallery.open();
    const wheel = (init: WheelEventInit) => {
      const event = new WheelEvent("wheel", { cancelable: true, ...init });
      gallery.scroller.dispatchEvent(event);
      return event;
    };
    expect(wheel({ deltaY: 120 }).defaultPrevented).toBe(true);
    expect(gallery.scroller.scrollLeft).toBe(120);
    wheel({ deltaY: 3, deltaMode: 1 }); // three lines
    expect(gallery.scroller.scrollLeft).toBe(240);
    expect(wheel({ deltaX: 50, deltaY: 10 }).defaultPrevented).toBe(false); // sideways: left to the browser
    gallery.setOptions({ vertical: true });
    expect(wheel({ deltaY: 120 }).defaultPrevented).toBe(false);
  });

  it("highlights the current page and marks buffered ones", () => {
    const gallery = make();
    gallery.setCurrent(4);
    gallery.setBuffered([4, 5, 6]);
    gallery.setCurrent(5);
    gallery.setBuffered([5, 6, 7]);
    expect([...gallery.element.querySelectorAll<HTMLElement>(".current")].map((c) => c.dataset.page)).toEqual(["5"]);
    expect([...gallery.element.querySelectorAll<HTMLElement>(".buffered")].map((c) => c.dataset.page)).toEqual(["5", "6", "7"]);
  });

  it("picks the clicked page", () => {
    const gallery = make("grid");
    gallery.open();
    cell(gallery, 12).querySelector<HTMLElement>(".number")!.click();
    expect(picked).toEqual([12]);
  });

  it("resizes cells and draws thumbnails again at the new scale", () => {
    const gallery = make();
    gallery.open();
    gallery.setOptions({ width: 120 });
    expect(cell(gallery, 3).style.width).toBe("120px");
    expect(cell(gallery, 3).style.height).toBe("168px");
    expect(cell(gallery, 3).querySelector<HTMLElement>(".sprite")!.style.transform).toBe(`scale(${120 / 200})`);
  });

  it("switches the filmstrip between the bottom and the left edge", () => {
    const gallery = make();
    gallery.setOptions({ vertical: true });
    expect(gallery.element.classList.contains("vertical")).toBe(true);
    gallery.setOptions({ vertical: false });
    expect(gallery.element.classList.contains("vertical")).toBe(false);
  });

  const groups = (box: Element) => [...box.querySelectorAll(".thumb-group")].map((g) => g.getAttribute("aria-label"));
  const rows = (box: Element) => [...box.children].map((row) => (row.matches(".thumb-group") ? [row.getAttribute("aria-label")] : groups(row)));

  it("groups its controls: first and last, scroll to, and thumbnail size with its keys", () => {
    const filmstrip = make();
    const box = filmstrip.element.querySelector(".thumb-controls")!;
    expect(groups(box)).toEqual(["First and last", "Scroll to", "Thumbnail size"]);
    const labels = (name: string) => [...box.querySelectorAll(`[aria-label="${name}"] button`)].map((b) => b.getAttribute("aria-label") ?? b.firstChild!.textContent);
    expect([labels("First and last"), labels("Scroll to"), labels("Thumbnail size")]).toEqual([
      ["Scroll to the start", "Scroll to the end"],
      ["Scroll to the current page", "Scroll to the furthest page read"],
      ["−", "+"],
    ]);
    expect([...box.querySelectorAll(".key")].map((k) => k.textContent)).toEqual(["[", "]"]);
    box.querySelectorAll<HTMLButtonElement>('[aria-label="Thumbnail size"] button').forEach((b) => b.click());
    expect(actions).toEqual(["thumbsSmaller", "thumbsLarger"]);
    // Hover zoom and the filmstrip's position are the toolbar's now.
    expect(filmstrip.element.querySelector('[role="radiogroup"], button[aria-pressed]')).toBeNull();
    const grid = make("grid").element.querySelector(".thumb-controls")!;
    expect([groups(grid), grid.querySelectorAll(".divider").length]).toEqual([["First and last", "Scroll to", "Thumbnail size"], 2]);
  });

  it("gives each group a row along the bottom, or puts both jumps on one row when the strip is short", () => {
    const filmstrip = make(); // 80 px wide thumbnails: a strip tall enough for three rows
    const box = filmstrip.element.querySelector(".thumb-controls")!;
    expect(rows(box)).toEqual([["First and last"], ["Scroll to"], ["Thumbnail size"]]);
    filmstrip.setOptions({ width: 48 });
    expect(rows(box)).toEqual([["First and last", "Scroll to"], ["Thumbnail size"]]);
    expect([filmstripControlRows(cellBox("filmstrip", 63).height), filmstripControlRows(cellBox("filmstrip", 64).height)]).toEqual([2, 3]);
  });

  it("keeps all three groups in the left filmstrip's header, whatever the thumbnail size, and nothing else", () => {
    const filmstrip = make("filmstrip", { vertical: true });
    const box = filmstrip.element.querySelector(".thumb-controls")!;
    expect(groups(box)).toEqual(["First and last", "Scroll to", "Thumbnail size"]);
    filmstrip.setOptions({ width: 160 });
    expect(groups(box)).toEqual(["First and last", "Scroll to", "Thumbnail size"]);
    expect(filmstrip.element.querySelector(".thumb-popover, [aria-haspopup]")).toBeNull();
    filmstrip.setOptions({ vertical: false });
    expect(rows(box)).toEqual([["First and last"], ["Scroll to"], ["Thumbnail size"]]);
  });

  // happy-dom has no layout: every cell is 80 × 112 at (300, 600).
  function layout() {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const cellLike = this.classList.contains("cell");
      return { left: cellLike ? 300 : 0, top: cellLike ? 600 : 0, width: cellLike ? 80 : 0, height: cellLike ? 112 : 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) };
    });
  }

  it("enlarges a hovered thumbnail to the preview width in a copy over it", () => {
    layout();
    const gallery = make(); // 120 px previews, the filmstrip along the bottom
    gallery.open();
    hover(cell(gallery, 3));
    expect(preview(gallery).hidden).toBe(false);
    // 1.5 times as large, its bottom on the cell's bottom, centered over it.
    expect(preview(gallery).style.transform).toBe("translate(-20px, -56px) scale(1.5)");
    expect(preview(gallery).querySelector(".number")!.textContent).toBe("3");
    leave(cell(gallery, 3));
    expect(preview(gallery).hidden).toBe(true);
    vi.restoreAllMocks();
  });

  it("shows no preview with hover zoom off, or one no larger than the thumbnail", () => {
    layout();
    const gallery = make("grid", { hover: null });
    gallery.open();
    hover(cell(gallery, 3));
    expect(preview(gallery).hidden).toBe(true);
    gallery.setOptions({ hover: 80 });
    hover(cell(gallery, 3));
    expect(preview(gallery).hidden).toBe(true);
    vi.restoreAllMocks();
  });
});

describe("ThumbGallery moving around", () => {
  const PAGES = 500;
  let wanted: number[][];
  function make(view: "filmstrip" | "grid") {
    wanted = [];
    const gallery = new ThumbGallery(
      view,
      {
        doc: document,
        pageCount: PAGES,
        thumb: () => undefined,
        thumbPageOf: (page) => Math.floor((page - 1) / PER_PAGE),
        wantThumbPages: (pages) => wanted.push(pages),
        onPick: () => {},
        onAction: () => {},
      },
      { width: view === "grid" ? 150 : 80, vertical: false, hover: null },
    );
    document.body.append(gallery.element);
    return gallery;
  }
  const button = (gallery: ThumbGallery, label: string) => gallery.element.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("scrolls to the end, the start and back to the current page", () => {
    // The 1024 × 768 test window less 40 px gutters: a 944 × 688 grid, 5 columns of 150 + 12,
    // rows 222 apart.
    const grid = make("grid");
    grid.setCurrent(250);
    grid.open();
    const current = grid.scroller.scrollTop;
    button(grid, "Scroll to the end").click();
    expect(grid.scroller.scrollTop).toBe(Math.ceil(PAGES / 5) * 222 - 688);
    button(grid, "Scroll to the start").click();
    expect(grid.scroller.scrollTop).toBe(0);
    button(grid, "Scroll to the current page").click();
    expect(grid.scroller.scrollTop).toBe(current);
    const filmstrip = make("filmstrip");
    filmstrip.open();
    button(filmstrip, "Scroll to the end").click();
    expect(filmstrip.scroller.scrollLeft).toBe(PAGES * 86 - 1024);
  });

  it("fetches only what's in view where a jump lands, once it settles", () => {
    const grid = make("grid");
    grid.setCurrent(1);
    grid.open();
    vi.advanceTimersByTime(FETCH_DELAY_MS);
    wanted = [];
    grid.scrollToEnd();
    grid.update(); // what the scroll event does on the next frame
    vi.advanceTimersByTime(FETCH_DELAY_MS - 1);
    expect(wanted).toEqual([]); // not while it might still be moving
    vi.advanceTimersByTime(1);
    expect(wanted).toHaveLength(1);
    expect(Math.min(...wanted[0]!)).toBeGreaterThanOrEqual(Math.floor((PAGES - 100) / PER_PAGE));
  });
});

describe("ThumbGallery reading marks", () => {
  function make() {
    const gallery = new ThumbGallery(
      "grid",
      { doc: document, pageCount: 500, thumb: () => undefined, thumbPageOf: (page) => Math.floor((page - 1) / PER_PAGE), wantThumbPages: () => {}, onPick: () => {}, onAction: () => {} },
      { width: 150, vertical: false, hover: null },
    );
    document.body.append(gallery.element);
    return gallery;
  }
  const marks = (gallery: ThumbGallery, kind: string) => [...gallery.element.querySelectorAll(`.mark.${kind}`)].map((m) => Number((m.parentElement as HTMLElement).dataset.page));
  const button = (gallery: ThumbGallery, label: string) => gallery.element.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("marks the furthest page, moving the mark as it changes", () => {
    const grid = make();
    expect(button(grid, "Scroll to the furthest page read").disabled).toBe(true);
    grid.setMarks({ furthest: 300 });
    expect(marks(grid, "furthest")).toEqual([300]);
    grid.setMarks({ furthest: 310 });
    expect(marks(grid, "furthest")).toEqual([310]);
    grid.setMarks({ furthest: 7 }); // the current page can be it too
    grid.setCurrent(7);
    expect(marks(grid, "furthest")).toEqual([7]);
    grid.setMarks({ furthest: null });
    expect([marks(grid, "furthest"), button(grid, "Scroll to the furthest page read").disabled]).toEqual([[], true]);
  });

  it("jumps to the start, the current page, the furthest page and the end, and nowhere else", () => {
    const grid = make(); // a 944 × 688 grid: 5 columns, rows 222 apart
    grid.setCurrent(1);
    grid.open();
    grid.setMarks({ furthest: 300 });
    const jumps = [...grid.element.querySelectorAll<HTMLButtonElement>(".thumb-controls button:not(:has(.key))")].map((b) => b.getAttribute("aria-label"));
    expect(jumps).toEqual(["Scroll to the start", "Scroll to the end", "Scroll to the current page", "Scroll to the furthest page read"]);
    button(grid, "Scroll to the furthest page read").click();
    expect(grid.scroller.scrollTop).toBe(Math.floor(299 / 5) * 222 + 105 - 344);
    expect(grid.element.querySelector(".cell.current")!.getAttribute("data-page")).toBe("1");
    expect(grid.element.querySelector(".mark.left-off")).toBeNull();
  });
});

describe("Grid size", () => {
  it("shrinks on both sides around the middle of its space, down to a minimum, up to all of it", () => {
    expect(gridSizeAt(312, 0, 1024)).toBe(400); // 200 px left of the middle
    expect(gridSizeAt(712, 0, 1024)).toBe(400);
    expect(gridSizeAt(500, 0, 1024)).toBe(200);
    expect(gridSizeAt(5, 0, 1024)).toBeNull();
    expect(gridSizeAt(244, 44, 700)).toBe(300); // a stage starting 44 px down, 700 px tall
  });

  function make(onGridSize: (size: GridSize) => void = () => {}) {
    const gallery = new ThumbGallery(
      "grid",
      {
        doc: document,
        pageCount: 500,
        thumb: () => undefined,
        thumbPageOf: (page) => Math.floor((page - 1) / PER_PAGE),
        wantThumbPages: () => {},
        onPick: () => {},
        onAction: () => {},
        onGridSize,
      },
      { width: 150, vertical: false, hover: null, gridWidth: null, gridHeight: null },
    );
    document.body.append(gallery.element);
    return gallery;
  }
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps the page in the middle of the view there as the columns change", () => {
    const grid = make(); // 150 px cells 12 apart, rows 222 apart, a 944 × 688 grid
    grid.setCurrent(250);
    grid.open();
    // The middle row's middle page, with `columns` across and the grid `height` tall.
    const middle = (columns: number, height: number) => Math.floor((grid.scroller.scrollTop + height / 2) / 222) * columns + Math.ceil(columns / 2);
    const before = middle(5, 688);
    grid.setOptions({ gridWidth: 500, gridHeight: 400 }); // 3 columns, 400 px tall
    expect(grid.element.style.getPropertyValue("--grid-width")).toBe("min(500px, calc(100% - 80px))");
    expect(grid.element.style.getPropertyValue("--grid-height")).toBe("min(400px, calc(100% - 80px))");
    expect(Math.abs(middle(3, 400) - before)).toBeLessThanOrEqual(1);
  });

  it("has a handle on each side, following a drag and saving the size when it's let go", () => {
    const saved: GridSize[] = [];
    const grid = make((size) => saved.push(size));
    grid.open();
    const handle = (side: string) => grid.element.querySelector<HTMLElement>(`.grid-handle.${side}`)!;
    expect(["left", "right", "top", "bottom"].every((side) => handle(side))).toBe(true);
    // happy-dom has no layout: the stage is the 1024 × 768 test window.
    const drag = (side: string, x: number, y: number) => {
      handle(side).dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: x, clientY: y }));
      handle(side).dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y }));
      handle(side).dispatchEvent(new PointerEvent("pointerup", { clientX: x, clientY: y }));
    };
    drag("left", 212, 0);
    expect(grid.element.style.getPropertyValue("--grid-width")).toBe("min(600px, calc(100% - 80px))");
    drag("bottom", 0, 584); // 200 px below the middle
    expect(saved).toEqual([{ width: 600, height: null }, { width: 600, height: 400 }]);
  });

  it("gives an axis all the space on a double-click", () => {
    const saved: GridSize[] = [];
    const grid = make((size) => saved.push(size));
    grid.setOptions({ gridWidth: 600, gridHeight: 400 });
    grid.element.querySelector(".grid-handle.top")!.dispatchEvent(new MouseEvent("dblclick"));
    expect(saved).toEqual([{ width: 600, height: null }]);
    expect(grid.element.style.getPropertyValue("--grid-height")).toBe("calc(100% - 80px)");
  });
});

describe("previewBox", () => {
  const viewport = { width: 1000, height: 800 };
  const cell = (left: number, top: number) => ({ left, top, width: 100, height: 140 });

  it("grows up from the bottom filmstrip, right from the left one, and out from the middle in the grid", () => {
    expect(previewBox(cell(400, 650), "up", 200, viewport)).toEqual({ left: 350, top: 510, width: 200, height: 280 });
    expect(previewBox(cell(10, 300), "right", 200, viewport)).toEqual({ left: 10, top: 230, width: 200, height: 280 });
    expect(previewBox(cell(400, 300), "out", 200, viewport)).toEqual({ left: 350, top: 230, width: 200, height: 280 });
  });

  it("stays inside the viewport near its edges", () => {
    expect(previewBox(cell(0, 650), "up", 200, viewport).left).toBe(8);
    expect(previewBox(cell(900, 650), "up", 200, viewport).left).toBe(1000 - 8 - 200);
    expect(previewBox(cell(400, 0), "out", 200, viewport).top).toBe(8);
    expect(previewBox(cell(400, 700), "out", 200, viewport).top).toBe(800 - 8 - 280);
    // Larger than the viewport: pinned to its start.
    expect(previewBox(cell(400, 300), "out", 700, viewport).top).toBe(8);
  });
});
