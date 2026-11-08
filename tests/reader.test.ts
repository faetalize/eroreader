import { afterEach, describe, expect, it, vi } from "vitest";
import { deadZone, PILL, placePill } from "../src/content/reader/auto/speed";
import { ReaderHistory, REPLACE_THROTTLE_MS } from "../src/content/reader/history";
import { Reader } from "../src/content/reader/reader";
import { FIT } from "../src/content/reader/zoom";
import { DEFAULT_SETTINGS, type Settings } from "../src/shared/settings";
import { everyFifthWide, fakeHistory, fakeSite, hrefOf, imagePageHtml, ORIGIN } from "./reader-fakes";

const GALLERY = `${ORIGIN}/g/7654321/abcdef0123/`;
const opened: Reader[] = [];

function setup({ start = GALLERY, pageCount = 100, isWide = everyFifthWide, initial = {} as Partial<Settings>, character = true } = {}) {
  const voiceEvents: string[] = [];
  const site = fakeSite(pageCount, { isWide });
  let settings: Settings = { ...structuredClone(DEFAULT_SETTINGS), ...initial };
  const saved: Partial<Settings>[] = [];
  const h = fakeHistory(start);
  const pageChanges: number[] = [];
  const directionChanges: boolean[] = [];
  const spreadChanges: [boolean, number[]][] = [];
  const visibleChanges: number[][] = [];
  let closed = 0;
  let settingsOpened = 0;
  const reader = new Reader({
    doc: document,
    source: site.source,
    store: site.store,
    history: new ReaderHistory(h.history, h.url),
    settings: () => settings,
    saveSettings: (patch) => {
      saved.push(patch);
      settings = { ...settings, ...patch };
    },
    title: "Sample Gallery Title",
    onPageChange: (page, visible) => {
      pageChanges.push(page);
      visibleChanges.push(visible);
    },
    onSpreadSettingsChange: (offset, points) => spreadChanges.push([offset, points]),
    createVoice: () =>
      character
        ? {
            element: document.createElement("div"),
            event: (event) => voiceEvents.push(event),
            speed: () => {},
            destroy: () => {},
          }
        : null,
    onDirectionChange: (rtl) => directionChanges.push(rtl),
    onClose: () => closed++,
    openSettings: () => settingsOpened++,
  });
  opened.push(reader);
  const $ = <T extends Element = HTMLElement>(selector: string) => reader.shadowRoot?.querySelector<T>(selector) ?? null;
  return { ...site, h, reader, pageChanges, directionChanges, spreadChanges, visibleChanges, closed: () => closed, settingsOpened: () => settingsOpened, saved, voiceEvents, $ };
}

function press(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// Toolbar buttons by their label, without the key badge.
// Toolbar buttons by their label without the key badge, or by their name when they show an icon.
const buttonLabelled = (reader: Reader, label: string) =>
  [...reader.shadowRoot!.querySelectorAll("button")].find((b) => b.firstChild?.textContent === label || b.getAttribute("aria-label") === label)!;

afterEach(() => {
  vi.useRealTimers();
  opened.splice(0).forEach((reader) => reader.close());
  document.body.innerHTML = "";
  document.documentElement.style.overflow = "";
});

describe("Reader", () => {
  it("opens as an overlay at the page, with one history entry", () => {
    const { reader, h, $ } = setup();
    reader.open(3);
    expect(document.querySelector("#eroreader-reader")).not.toBeNull();
    expect($(".indicator")!.textContent).toBe("3 / 100");
    expect($(".title")!.textContent).toBe("Sample Gallery Title");
    expect(h.entries.map((e) => e.url)).toEqual([GALLERY, `${GALLERY}#page=3`]);
    expect(document.documentElement.style.overflow).toBe("hidden");
  });

  it("preloads ahead and behind the current page", () => {
    const { reader } = setup();
    reader.open(10);
    expect(reader.bufferedPages).toEqual([10, 11, 12, 13, 9]);
    reader.goTo(50);
    expect(reader.bufferedPages.sort((a, b) => a - b)).toEqual([49, 50, 51, 52, 53]);
  });

  it("turns pages with the arrow keys and writes the page to the URL", () => {
    vi.useFakeTimers();
    const { reader, h, pageChanges } = setup();
    reader.open(3);
    press("ArrowRight");
    press("ArrowRight");
    press("ArrowLeft");
    expect(reader.page).toBe(4);
    vi.advanceTimersByTime(REPLACE_THROTTLE_MS);
    expect(h.url().hash).toBe("#page=4");
    expect(h.entries).toHaveLength(2);
    expect(pageChanges).toEqual([3, 4, 5, 4]);
  });

  it("flips the arrow keys and click sides in right-to-left", () => {
    const { reader, $ } = setup();
    reader.open(10);
    reader.setRtl(true);
    press("ArrowRight");
    expect(reader.page).toBe(9);
    const stage = $(".stage")!;
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({ left: 0, width: 1000, top: 0, height: 800 } as DOMRect);
    stage.dispatchEvent(new MouseEvent("click", { clientX: 100, bubbles: true }));
    expect(reader.page).toBe(10);
    reader.setRtl(false);
    stage.dispatchEvent(new MouseEvent("click", { clientX: 100, bubbles: true }));
    expect(reader.page).toBe(9);
  });

  it("stays within the gallery", () => {
    const { reader } = setup({ pageCount: 5 });
    reader.open(9);
    expect(reader.page).toBe(5);
    press("ArrowRight");
    expect(reader.page).toBe(5);
    press("Home");
    expect(reader.page).toBe(1);
    press("ArrowLeft");
    expect(reader.page).toBe(1);
    press("End");
    expect(reader.page).toBe(5);
  });

  it("closes through Back and restores the gallery", () => {
    const { reader, h } = setup();
    document.documentElement.style.overflow = "scroll";
    reader.open(3);
    press("Escape");
    expect(h.url().href).toBe(GALLERY); // stepped back to the gallery's entry
    reader.handlePopState(h.url()); // the popstate that follows
    expect(reader.isOpen).toBe(false);
    expect(document.querySelector("#eroreader-reader")).toBeNull();
    expect(document.documentElement.style.overflow).toBe("scroll");
    expect(reader.bufferedPages).toEqual([]);
  });

  it("closes right away when opened from a pasted link, leaving the gallery's entry", () => {
    const { reader, h } = setup({ start: `${GALLERY}#page=7` });
    reader.open(7, { push: false });
    press("Escape");
    expect(reader.isOpen).toBe(false);
    expect(h.entries.map((e) => e.url)).toEqual([GALLERY]);
  });

  it("reopens on Forward without pushing", () => {
    const { reader, h } = setup();
    reader.handlePopState(new URL(`${GALLERY}#page=12`));
    expect(reader.isOpen).toBe(true);
    expect(reader.page).toBe(12);
    expect(h.entries).toHaveLength(1);
  });

  it("switches to strip mode and back, keeping the page", async () => {
    const { reader, $ } = setup({ pageCount: 30 });
    reader.open(4);
    await settle();
    press("m");
    expect(reader.mode).toBe("strip");
    expect($(".stage")!.hidden).toBe(true);
    expect(reader.shadowRoot!.querySelectorAll(".slot")).toHaveLength(30);
    expect($('.slot[data-page="4"] img')).not.toBeNull();
    press("m");
    expect(reader.mode).toBe("page");
    expect($(".stage img")!.getAttribute("alt")).toBe("Page 4");
    expect(reader.page).toBe(4);
  });

  it("leaves Page Down to native scrolling in strip mode, and turns the page with it in page mode", () => {
    const { reader } = setup();
    reader.open(4);
    reader.setMode("strip");
    expect(press("PageDown").defaultPrevented).toBe(false);
    reader.setMode("page");
    expect(press("PageDown").defaultPrevented).toBe(true);
    expect(reader.page).toBe(5);
  });

  it("hides behind a blank screen and comes back with the same key", () => {
    const { reader, $ } = setup();
    reader.open(4);
    press("b");
    expect($(".blank")!.hidden).toBe(false);
    press("ArrowRight");
    press("Escape");
    expect(reader.page).toBe(4); // other keys do nothing while hidden
    expect(reader.isOpen).toBe(true);
    press("B");
    expect($(".blank")!.hidden).toBe(true);
  });

  it("shows the shortcut list, and Esc closes the list before the reader", () => {
    const { reader, $ } = setup();
    reader.open(4);
    press("?", { shiftKey: true });
    expect(reader.helpOpen).toBe(true);
    expect(reader.shadowRoot!.querySelectorAll(".help tr").length).toBeGreaterThan(5);
    press("Escape");
    expect(reader.helpOpen).toBe(false);
    expect(reader.isOpen).toBe(true);
    expect($(".help")!.hidden).toBe(true);
  });

  it("zooms in and out, to actual size and back to fit", () => {
    const { reader } = setup();
    reader.open(4);
    press("+");
    expect(reader.zoom.fit).toBe(false);
    press("0");
    expect(reader.zoom).toEqual({ fit: false, scale: 1 });
    press("-");
    expect(reader.zoom).toEqual({ fit: false, scale: 0.8 });
    press("f");
    expect(reader.zoom.fit).toBe(true);
  });

  it("shows a plain notice at the image limit", async () => {
    const { reader, pages, $ } = setup();
    pages.set(hrefOf(4), imagePageHtml(4, 100, { imageUrl: "https://exhentai.org/img/509.gif" }));
    reader.open(4);
    await settle();
    expect($(".stage .placeholder")!.textContent).toContain("Image limit reached");
    expect($(".stage .placeholder button")!.textContent).toBe("Try again");
  });

  it("ignores keys with Ctrl, Alt or Meta", () => {
    const { reader } = setup();
    reader.open(4);
    expect(press("ArrowRight", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(reader.page).toBe(4);
  });

  it("cancels the browser's own image drag, so dragging a zoomed page pans it", async () => {
    const { reader, $ } = setup();
    reader.open(4);
    await settle();
    press("+");
    const img = $(".stage img")!;
    const dragstart = new Event("dragstart", { bubbles: true, cancelable: true });
    img.dispatchEvent(dragstart);
    expect(dragstart.defaultPrevented).toBe(true);
  });

  it("keeps focus off toolbar buttons, so Space can't press them again", () => {
    const { reader } = setup();
    reader.open(4);
    const modeButton = buttonLabelled(reader, "Page");
    const mousedown = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    modeButton.dispatchEvent(mousedown);
    expect(mousedown.defaultPrevented).toBe(true);
  });

  it("reports direction changes made by the user only", () => {
    const { reader, directionChanges } = setup();
    reader.setRtl(true); // e.g. the gallery's saved direction
    reader.open(4);
    press("r");
    buttonLabelled(reader, "LTR").click(); // already left to right: nothing changes
    buttonLabelled(reader, "RTL").click();
    expect(directionChanges).toEqual([false, true]);
  });

  it("reports closing", () => {
    const { reader, closed } = setup({ start: `${GALLERY}#page=4` });
    reader.open(4, { push: false });
    press("Escape");
    expect(closed()).toBe(1);
  });

  it("stops listening once closed", () => {
    const { reader } = setup({ start: `${GALLERY}#page=4` });
    reader.open(4, { push: false });
    reader.close();
    expect(press("ArrowRight").defaultPrevented).toBe(false);
  });
});

// In the fake gallery every fifth page has a landscape thumbnail, so it counts as wide.
describe("Reader spreads", () => {
  it("pairs pages, keeps the cover and wide pages alone, and steps a spread at a time", () => {
    const { reader, $, visibleChanges } = setup();
    reader.open(3);
    press("d");
    expect(reader.visiblePages).toEqual([2, 3]);
    expect(reader.page).toBe(2);
    expect($(".indicator")!.textContent).toBe("2–3 / 100");
    expect(reader.shadowRoot!.querySelectorAll(".stage .cell")).toHaveLength(2);
    const seen: number[][] = [];
    for (let i = 0; i < 4; i++) {
      press("ArrowRight");
      seen.push(reader.visiblePages);
    }
    expect(seen).toEqual([[4], [5], [6, 7], [8, 9]]);
    press("Home");
    expect(reader.visiblePages).toEqual([1]);
    expect(visibleChanges.at(-1)).toEqual([1]);
  });

  it("opens on the spread that holds the page", () => {
    const { reader } = setup();
    reader.toggleSpreads();
    reader.open(7);
    expect(reader.visiblePages).toEqual([6, 7]);
  });

  it("puts the first page on the right in right-to-left", () => {
    const { reader, $ } = setup();
    reader.open(2);
    press("d");
    expect($<HTMLElement>(".frame")!.style.flexDirection).toBe("row");
    press("r");
    expect($<HTMLElement>(".frame")!.style.flexDirection).toBe("row-reverse");
    expect([...reader.shadowRoot!.querySelectorAll<HTMLElement>(".frame .cell")].map((c) => c.dataset.page)).toEqual(["2", "3"]);
  });

  it("pairs the cover with the offset, and reports it", () => {
    const { reader, spreadChanges } = setup();
    reader.open(1);
    press("d");
    press("o");
    expect(reader.visiblePages).toEqual([1, 2]);
    expect(spreadChanges).toEqual([[true, []]]);
  });

  it("re-pairs from the current page on, and undoes it there", () => {
    const { reader, spreadChanges } = setup();
    reader.open(6);
    press("d");
    expect(reader.visiblePages).toEqual([6, 7]);
    press("p");
    expect(reader.visiblePages).toEqual([6]);
    press("ArrowRight");
    expect(reader.visiblePages).toEqual([7, 8]);
    press("ArrowLeft");
    press("p");
    expect(reader.visiblePages).toEqual([6, 7]);
    expect(spreadChanges).toEqual([[false, [6]], [false, []]]);
  });

  it("applies saved spread settings without reporting them", () => {
    const { reader, spreadChanges } = setup();
    reader.setSpreadSettings(false, [6]);
    reader.open(6);
    press("d");
    expect(reader.visiblePages).toEqual([6]);
    expect(spreadChanges).toEqual([]);
  });

  it("ignores O and P without spreads, and never pairs in strip mode", () => {
    const { reader, spreadChanges } = setup();
    reader.open(6);
    press("o");
    press("p");
    expect(spreadChanges).toEqual([]);
    press("d");
    press("m");
    expect(reader.visiblePages).toEqual([6]);
    press("p");
    expect(spreadChanges).toEqual([]);
  });

  it("preloads ahead of the whole spread", () => {
    const { reader } = setup();
    reader.toggleSpreads();
    reader.open(6);
    expect(reader.bufferedPages).toEqual([6, 7, 8, 9, 10, 5]);
  });
});

describe("Reader quick settings", () => {
  const panel = (reader: Reader) => reader.shadowRoot!.querySelector<HTMLElement>(".quick-settings")!;
  const input = (reader: Reader, name: string) => panel(reader).querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  const slide = (el: HTMLInputElement, value: number) => {
    el.value = String(value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const stepper = (reader: Reader, setting: string) => {
    const [less, value, more] = panel(reader).querySelector(`[data-setting="${setting}"]`)!.children as unknown as [HTMLButtonElement, HTMLElement, HTMLButtonElement];
    return { less, value, more };
  };

  it("opens from its toolbar button or S, and closes with Esc without leaving the reader", () => {
    const { reader } = setup();
    reader.open(1);
    expect(reader.quickSettingsOpen).toBe(false);
    buttonLabelled(reader, "Quick settings").click();
    expect(reader.quickSettingsOpen).toBe(true);
    press("Escape");
    expect(reader.quickSettingsOpen).toBe(false);
    expect(reader.isOpen).toBe(true);
    press("s");
    expect(reader.quickSettingsOpen).toBe(true);
  });

  it("closes on a click elsewhere, without turning the page", () => {
    const { reader } = setup();
    reader.open(3);
    press("s");
    const stage = reader.shadowRoot!.querySelector<HTMLElement>(".stage")!;
    stage.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, button: 0 }));
    stage.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, clientX: 900 }));
    expect(reader.quickSettingsOpen).toBe(false);
    expect(reader.page).toBe(3);
  });

  it("resizes the filmstrip and grid thumbnails and moves the filmstrip, saving each", () => {
    const { reader, saved, $ } = setup();
    reader.open(1);
    reader.toggleFilmstrip();
    press("s");
    slide(input(reader, "filmstripSize"), 120);
    expect(saved.at(-1)).toEqual({ thumbWidth: { filmstrip: 120, grid: 150 } });
    expect($(".thumbs.filmstrip")!.style.getPropertyValue("--cell-width")).toBe("120px");
    slide(input(reader, "gridSize"), 200);
    expect(saved.at(-1)).toEqual({ thumbWidth: { filmstrip: 120, grid: 200 } });
    [...panel(reader).querySelectorAll("button")].find((b) => b.textContent === "Left")!.click();
    expect(saved.at(-1)).toEqual({ filmstripVertical: true });
    expect($(".thumbs.filmstrip")!.classList.contains("vertical")).toBe(true);
  });

  it("sets how large each view's hovered thumbnails show, only while hover zoom is on", () => {
    const { reader, saved } = setup();
    reader.open(1);
    press("s");
    const hover = (view: string) => panel(reader).querySelector<HTMLElement>(`[aria-label="${view} hover size"]`)!;
    expect(hover("Grid").parentElement!.querySelector(".qs-label")!.textContent).toBe("Hover");
    slide(input(reader, "gridHoverScale"), 3.5);
    expect(saved.at(-1)).toEqual({ hoverSize: { ...DEFAULT_SETTINGS.hoverSize, grid: { ...DEFAULT_SETTINGS.hoverSize.grid, by: "scale", scale: 3.5 } } });
    [...hover("Filmstrip").querySelectorAll("button")].find((b) => b.textContent === "+200")!.click();
    expect(saved.at(-1)!.hoverSize!.filmstrip).toEqual({ ...DEFAULT_SETTINGS.hoverSize.filmstrip, by: "offset", offset: 200 });
    // Off, nothing about its size shows.
    const toggle = panel(reader).querySelector<HTMLInputElement>('input[name="hoverZoom"]')!;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    expect(saved.at(-1)).toEqual({ hoverZoom: false });
    expect([hover("Filmstrip").parentElement!.hidden, hover("Grid").parentElement!.hidden]).toEqual([true, true]);
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    expect(hover("Grid").parentElement!.hidden).toBe(false);
  });

  it("switches hover zoom with H, saying so", () => {
    const { reader, saved } = setup();
    reader.open(1);
    reader.toggleFilmstrip();
    press("h");
    expect(saved.at(-1)).toEqual({ hoverZoom: false });
    expect(reader.noticeText).toBe("Hover zoom off.");
    expect(buttonLabelled(reader, "Hover zoom").getAttribute("aria-pressed")).toBe("false");
  });

  it("changes the preload counts at once, within the cap", () => {
    const { reader, saved } = setup({ initial: { preloadAhead: 3, preloadBehind: 1 } });
    reader.open(10);
    expect(reader.bufferedPages).not.toContain(14);
    press("s");
    stepper(reader, "preloadAhead").more.click();
    expect(saved.at(-1)).toEqual({ preloadAhead: 4 });
    expect(reader.bufferedPages).toContain(14);
    expect(stepper(reader, "preloadAhead").value.textContent).toBe("4");
    for (let i = 0; i < 3; i++) stepper(reader, "preloadBehind").more.click();
    expect(stepper(reader, "preloadAhead").more.disabled).toBe(true); // 4 + 4 is the most
    expect(stepper(reader, "preloadBehind").more.disabled).toBe(true);
  });

  it("puts the auto pill back, once it has been moved", () => {
    const { reader, saved } = setup({ initial: { autoZone: { x: 0.2, y: 0.3 } } });
    reader.open(1);
    press("s");
    const reset = [...panel(reader).querySelectorAll("button")].find((b) => b.textContent?.startsWith("Put it back"))!;
    expect(reset.disabled).toBe(false);
    reset.click();
    expect(saved.at(-1)).toEqual({ autoZone: null });
    expect(reset.disabled).toBe(true);
  });

  it("links to all the settings", () => {
    const { reader, settingsOpened } = setup();
    reader.open(1);
    press("s");
    [...panel(reader).querySelectorAll("button")].find((b) => b.textContent === "All settings…")!.click();
    expect(settingsOpened()).toBe(1);
  });

  it("leaves arrow keys on a slider to the slider", () => {
    const { reader } = setup();
    reader.open(3);
    press("s");
    const event = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, composed: true, cancelable: true });
    input(reader, "gridHoverScale").dispatchEvent(event);
    expect(reader.page).toBe(3);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("Reader panning", () => {
  const frame = (reader: Reader) => reader.shadowRoot!.querySelector<HTMLElement>(".frame")!;
  const stage = (reader: Reader) => reader.shadowRoot!.querySelector<HTMLElement>(".stage")!;

  it("leaves half a screen of room around a zoomed page, along the axes it overflows", () => {
    const { reader } = setup();
    reader.open(1);
    expect(frame(reader).style.padding).toBe("0px");
    for (let i = 0; i < 6; i++) reader.zoomIn();
    // The 1024 × 768 test window.
    expect(frame(reader).style.padding).toBe("384px 512px");
  });

  it("shows each page from its top and first side, inside that room", () => {
    const { reader } = setup();
    reader.open(1);
    for (let i = 0; i < 6; i++) reader.zoomIn();
    stage(reader).scrollTop = 900;
    stage(reader).scrollLeft = 10;
    reader.next();
    expect([stage(reader).scrollTop, stage(reader).scrollLeft]).toEqual([384, 512]);
  });
});

describe("Reader zoom and panning in strip mode", () => {
  const strip = (reader: Reader) => reader.shadowRoot!.querySelector<HTMLElement>(".strip")!;
  const slot = (reader: Reader, page: number) => reader.shadowRoot!.querySelector<HTMLElement>(`.slot[data-page="${page}"]`)!;
  // Where the page's middle is on screen, across: the 1024 px test window's middle is 512.
  const middleOnScreen = (reader: Reader, page: number) => parseFloat(slot(reader, page).style.left) + parseFloat(slot(reader, page).style.width) / 2 - strip(reader).scrollLeft;

  it("keeps the page where it is across the screen while zooming, even once it's wider than the screen", () => {
    const { reader } = setup({ isWide: () => false });
    reader.open(10);
    reader.setMode("strip");
    expect(Math.abs(middleOnScreen(reader, 10) - 512)).toBeLessThanOrEqual(1);
    for (let i = 0; i < 6; i++) {
      reader.zoomIn();
      expect(Math.abs(middleOnScreen(reader, 10) - 512)).toBeLessThanOrEqual(1);
    }
    for (let i = 0; i < 6; i++) {
      reader.zoomOut();
      expect(Math.abs(middleOnScreen(reader, 10) - 512)).toBeLessThanOrEqual(1);
    }
  });

  it("leaves half a screen of room on both sides of pages wider than the screen, so any edge can come to the middle", () => {
    const { reader, $ } = setup({ isWide: () => false });
    reader.open(10);
    reader.setMode("strip");
    for (let i = 0; i < 6; i++) reader.zoomIn();
    const width = parseFloat(slot(reader, 10).style.width);
    expect(parseFloat(slot(reader, 10).style.left)).toBe(512);
    expect(parseFloat($(".strip-inner")!.style.width)).toBe(512 + width + 512);
  });

  it("marks the current page, and only it", async () => {
    const { reader, $ } = setup({ isWide: () => false });
    reader.open(10);
    reader.setMode("strip");
    const current = () => [...reader.shadowRoot!.querySelectorAll<HTMLElement>(".slot.current")].map((s) => Number(s.dataset.page));
    expect(current()).toEqual([10]);
    reader.goTo(20);
    expect(current()).toEqual([20]);
    // Scrolled there by hand: the page under the middle of the screen.
    const el = strip(reader);
    el.scrollTop = parseFloat(slot(reader, 30).style.top) + 10 - 768 / 2;
    el.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await settle();
    expect([current(), reader.page]).toEqual([[30], 30]);
    // Its number beside it, at its top, or at the top of the screen once its top is above it.
    expect($(".strip-current")!.textContent).toBe("30");
    expect($(".strip-current")!.style.top).toBe(slot(reader, 30).style.top);
    el.scrollTop = parseFloat(slot(reader, 30).style.top) + 100;
    el.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect($(".strip-current")!.style.top).toBe(`${el.scrollTop + 8}px`);
    expect($(".slot.current")!.classList.contains("snug")).toBe(false); // there's room beside it for the mark
  });

  it("pans a zoomed strip by dragging, both ways", () => {
    const { reader } = setup({ isWide: () => false });
    reader.open(10);
    reader.setMode("strip");
    for (let i = 0; i < 6; i++) reader.zoomIn();
    const el = strip(reader);
    const [left, top] = [el.scrollLeft, el.scrollTop];
    const pointer = (type: string, x: number, y: number) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, buttons: 1, clientX: x, clientY: y }));
    pointer("pointerdown", 500, 400);
    pointer("pointermove", 440, 300);
    pointer("pointerup", 440, 300);
    expect([el.scrollLeft, el.scrollTop]).toEqual([left + 60, top + 100]);
    expect(el.classList.contains("pannable")).toBe(true);
  });

  it("keeps the current page's number in view when a zoomed page's edge is panned away", async () => {
    const { reader, $ } = setup({ isWide: () => false });
    reader.open(10);
    reader.setMode("strip");
    for (let i = 0; i < 6; i++) reader.zoomIn();
    const el = strip(reader);
    const number = $(".strip-current")!;
    el.scrollLeft = parseFloat(slot(reader, 10).style.left) - 200; // its left edge in view
    el.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect([number.style.left, number.classList.contains("snug")]).toEqual([slot(reader, 10).style.left, false]);
    el.scrollLeft = parseFloat(slot(reader, 10).style.left) + 300; // the page's left edge well off screen
    el.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect([number.style.left, number.classList.contains("snug")]).toEqual([`${el.scrollLeft}px`, true]);
  });
});

describe("Reader insets for the toolbar and filmstrip", () => {
  // happy-dom has no layout: the toolbar is 40 px tall, the filmstrip 130 px tall along the
  // bottom or 104 px wide on the left.
  const rect = (width: number, height: number) => ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) }) as DOMRect;
  function measure() {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("toolbar")) return rect(1024, 40);
      if (this.classList.contains("thumbs")) return this.classList.contains("vertical") ? rect(104, 768) : rect(1024, 130);
      return rect(0, 0);
    });
  }
  afterEach(() => vi.restoreAllMocks());
  const frame = (reader: Reader) => reader.shadowRoot!.querySelector<HTMLElement>(".frame")!;
  const stage = (reader: Reader) => reader.shadowRoot!.querySelector<HTMLElement>(".stage")!;
  const pads = (el: HTMLElement) => [el.style.paddingTop, el.style.paddingRight, el.style.paddingBottom, el.style.paddingLeft];

  it("brings the hidden toolbar back only from the top, keeping it while pointed at", () => {
    vi.useFakeTimers();
    const { reader, $ } = setup();
    reader.open(1);
    const root = $(".reader")!;
    const hidden = () => root.classList.contains("bar-hidden");
    const move = (target: Element, y: number) => target.dispatchEvent(new MouseEvent("mousemove", { clientX: 500, clientY: y, bubbles: true, composed: true }));
    vi.advanceTimersByTime(3000);
    expect(hidden()).toBe(true);
    move(root, 60); // near the top, where the grid's top edge is
    move(root, 400);
    expect(hidden()).toBe(true);
    move(root, 0);
    expect(hidden()).toBe(false);
    move($(".toolbar")!, 20); // onto it: it stays
    vi.advanceTimersByTime(5000);
    expect(hidden()).toBe(false);
    move(root, 300); // off it: it goes
    vi.advanceTimersByTime(1000);
    expect(hidden()).toBe(true);
    // Pointing at a floating group doesn't bring it back either.
    move($(".tb-where")!, 20);
    expect(hidden()).toBe(true);
  });

  it("brings the hidden toolbar back within half its height of the top, not lower", () => {
    vi.useFakeTimers();
    measure(); // a 40 px toolbar
    const { reader, $ } = setup();
    reader.open(1);
    const root = $(".reader")!;
    const hidden = () => root.classList.contains("bar-hidden");
    const move = (y: number) => root.dispatchEvent(new MouseEvent("mousemove", { clientX: 500, clientY: y, bubbles: true, composed: true }));
    vi.advanceTimersByTime(3000);
    move(21); // below its upper half: where the grid's top edge is
    expect(hidden()).toBe(true);
    move(20);
    expect(hidden()).toBe(false);
  });

  it("starts the grid and the left filmstrip below the toolbar, pinned or not", () => {
    const { reader, $ } = setup();
    reader.open(1);
    // happy-dom doesn't cascade: what the stylesheet says.
    const css = $("style")!.textContent!;
    const rule = /\n([^\n{]*\.thumbs\.grid[^\n{]*) \{ top: var\(--toolbar-height/.exec(css);
    expect(rule?.[1]).toBe(".thumbs.filmstrip.vertical, .thumbs.grid");
    // Nothing after it puts their tops back at the screen's.
    const after = css.slice(css.indexOf(rule![0]) + rule![0].length);
    expect(after).not.toMatch(/\n\.thumbs\.(grid|filmstrip\.vertical) \{[^}]*(inset|top):/);
    expect($(".reader")!.style.getPropertyValue("--toolbar-height")).toMatch(/px$/); // measured, pinned or not
  });

  it("pins the toolbar from the quick settings", () => {
    const { reader, saved, $ } = setup();
    reader.open(1);
    press("s");
    const pin = $<HTMLInputElement>('.quick-settings input[name="toolbarPinned"]')!;
    pin.checked = true;
    pin.dispatchEvent(new Event("change", { bubbles: true }));
    expect(saved.at(-1)).toEqual({ toolbarPinned: true });
    expect($(".reader")!.classList.contains("pinned")).toBe(true);
  });

  it("leaves room for a pinned toolbar and an open filmstrip, showing each page clear of them", () => {
    measure();
    const { reader } = setup({ initial: { toolbarPinned: true } });
    reader.open(1);
    expect(pads(frame(reader))).toEqual(["40px", "0px", "0px", "0px"]);
    reader.toggleFilmstrip();
    expect(pads(frame(reader))).toEqual(["40px", "0px", "130px", "0px"]);
    reader.next();
    expect(stage(reader).scrollTop).toBe(0); // its top right below the toolbar
    reader.toggleFilmstripVertical();
    expect(pads(frame(reader))).toEqual(["40px", "0px", "0px", "104px"]);
    reader.next();
    expect(stage(reader).scrollLeft).toBe(0);
  });

  it("keeps a zoomed page's room when it's more than the insets", () => {
    measure();
    const { reader } = setup({ initial: { toolbarPinned: true } });
    reader.open(1);
    for (let i = 0; i < 6; i++) reader.zoomIn();
    reader.next();
    expect(pads(frame(reader))).toEqual(["384px", "512px", "384px", "512px"]);
    expect(stage(reader).scrollTop).toBe(344); // the page's top right below the toolbar
  });

  it("keeps the page still on screen when the UI comes or goes", () => {
    measure();
    const { reader, $ } = setup();
    reader.open(1);
    stage(reader).scrollTop = 10;
    reader.toggleFilmstrip();
    expect(stage(reader).scrollTop).toBe(10);
    press("s");
    const pin = $<HTMLInputElement>('.quick-settings input[name="toolbarPinned"]')!;
    pin.checked = true;
    pin.dispatchEvent(new Event("change", { bubbles: true }));
    expect(stage(reader).scrollTop).toBe(50);
  });

  it("leaves the same room in strip mode, above the first page, below the last and on the left", () => {
    measure();
    // No wide pages, so nothing needs the full width.
    const { reader, $ } = setup({ isWide: () => false, initial: { toolbarPinned: true, filmstripVertical: true } });
    reader.open(1);
    reader.setMode("strip");
    reader.toggleFilmstrip();
    const slot = $('.slot[data-page="1"]')!;
    const inner = $(".strip-inner")!;
    expect(slot.style.top).toBe("40px");
    // Centered in the 920 px right of the filmstrip.
    expect(parseFloat(slot.style.left)).toBe(104 + Math.round((1024 - 104 - parseFloat(slot.style.width)) / 2));
    const last = $('.slot[data-page="100"]')!;
    expect(parseFloat(inner.style.height)).toBe(parseFloat(last.style.top) + parseFloat(last.style.height));
    reader.toggleFilmstripVertical(); // along the bottom now
    expect(parseFloat(inner.style.height)).toBe(parseFloat(last.style.top) + parseFloat(last.style.height) + 130);
  });
});

describe("Reader filmstrip and grid", () => {
  it("opens the filmstrip on the current page, following page changes and the buffer", async () => {
    const { reader } = setup();
    reader.open(4);
    press("t");
    expect(reader.filmstripOpen).toBe(true);
    const current = () => [...reader.shadowRoot!.querySelectorAll<HTMLElement>(".filmstrip .current")].map((c) => c.dataset.page);
    const buffered = () => [...reader.shadowRoot!.querySelectorAll<HTMLElement>(".filmstrip .buffered")].map((c) => Number(c.dataset.page)).sort((a, b) => a - b);
    expect(current()).toEqual(["4"]);
    expect(buffered()).toEqual([3, 4, 5, 6, 7]);
    press("ArrowRight");
    expect(current()).toEqual(["5"]);
    expect(buffered()).toEqual([4, 5, 6, 7, 8]);
    press("t");
    expect(reader.filmstripOpen).toBe(false);
  });

  it("jumps from the grid and closes it, and Esc closes the grid before the reader", () => {
    const { reader } = setup();
    reader.open(4);
    press("g");
    expect(reader.gridOpen).toBe(true);
    reader.shadowRoot!.querySelector<HTMLElement>('.grid .cell[data-page="15"]')!.click();
    expect(reader.page).toBe(15);
    expect(reader.gridOpen).toBe(false);
    expect(reader.bufferedPages.sort((a, b) => a - b)).toEqual([14, 15, 16, 17, 18]);
    press("g");
    press("Escape");
    expect(reader.gridOpen).toBe(false);
    expect(reader.isOpen).toBe(true);
  });
});

describe("Reader spread feedback", () => {
  it("says spreads are off instead of doing nothing, and shows O and P buttons only with spreads", () => {
    const { reader } = setup();
    reader.open(6);
    expect(buttonLabelled(reader, "Pair cover").hidden).toBe(true);
    press("o");
    expect(reader.noticeText).toBe("Two-page spreads are off. Turn them on with D first.");
    press("d");
    expect(buttonLabelled(reader, "Pair cover").hidden).toBe(false);
    expect(buttonLabelled(reader, "Re-pair").hidden).toBe(false);
    press("m");
    expect(buttonLabelled(reader, "Pair cover").hidden).toBe(true);
    press("p");
    expect(reader.noticeText).toBe("Two-page spreads only show in page mode (M).");
  });

  it("says what O changed, and shows its state on the button", () => {
    const { reader } = setup();
    reader.open(1);
    press("d");
    buttonLabelled(reader, "Pair cover").click();
    expect(reader.noticeText).toBe("Cover paired with page 2.");
    expect(buttonLabelled(reader, "Pair cover").getAttribute("aria-pressed")).toBe("true");
    press("o");
    expect(reader.noticeText).toBe("Cover shown alone.");
    expect(buttonLabelled(reader, "Pair cover").getAttribute("aria-pressed")).toBe("false");
  });

  it("explains when O changes nothing at all: a wide cover", () => {
    const { reader, spreadChanges } = setup({ isWide: (page) => page === 1 || page % 5 === 0 });
    reader.open(1);
    press("d");
    press("o");
    expect(reader.noticeText).toBe("Cover paired with page 2. Nothing changes: the cover is a wide page.");
    expect(spreadChanges).toEqual([[true, []]]); // still saved, for when the pages' shapes are known better
  });

  it("explains when O leaves the spread on screen alone", () => {
    const { reader } = setup();
    reader.open(6); // 1 | 2-3 | 4 | 5 (wide) | 6-7
    press("d");
    press("o");
    expect(reader.visiblePages).toEqual([6, 7]);
    expect(reader.noticeText).toBe("Cover paired with page 2. The pages on screen stay as they are.");
  });

  it("says what P changed, or that it changed nothing", () => {
    const { reader } = setup();
    reader.open(6);
    press("d");
    buttonLabelled(reader, "Re-pair").click();
    expect(reader.noticeText).toBe("Pairing flipped from page 6 on.");
    expect(buttonLabelled(reader, "Re-pair").getAttribute("aria-pressed")).toBe("true");
    press("p");
    expect(reader.noticeText).toBe("Re-pair at page 6 removed.");
    press("Home");
    press("ArrowRight");
    press("ArrowRight"); // [4], alone before the wide page 5
    expect(reader.visiblePages).toEqual([4]);
    press("p");
    expect(reader.noticeText).toBe("Pairing flipped from page 4 on. Nothing changes: a wide page already starts a new pair here.");
  });
});

describe("Reader toolbar", () => {
  const checked = (reader: Reader, label: string) => buttonLabelled(reader, label).getAttribute("aria-checked");
  const pressed = (reader: Reader, label: string) => buttonLabelled(reader, label).getAttribute("aria-pressed");

  it("shows no badge where the button's label already is its key", () => {
    const { reader } = setup();
    reader.open(4);
    expect(buttonLabelled(reader, "Zoom in").querySelector<HTMLElement>(".key")!.hidden).toBe(true);
    expect(buttonLabelled(reader, "Fit").querySelector<HTMLElement>(".key")!.hidden).toBe(false);
  });

  it("shows mode and direction as two-way switches, and flips them from either side", () => {
    const { reader } = setup();
    reader.open(4);
    expect([checked(reader, "Page"), checked(reader, "Strip")]).toEqual(["true", "false"]);
    buttonLabelled(reader, "Strip").click();
    expect(reader.mode).toBe("strip");
    expect([checked(reader, "Page"), checked(reader, "Strip")]).toEqual(["false", "true"]);
    buttonLabelled(reader, "Strip").click(); // already on: nothing changes
    expect(reader.mode).toBe("strip");
    press("r");
    expect([checked(reader, "LTR"), checked(reader, "RTL")]).toEqual(["false", "true"]);
  });

  it("shows the real zoom in its field, tagged while pages are fitted", () => {
    const { reader, $ } = setup();
    reader.open(4);
    const field = $<HTMLInputElement>(".zoom-value")!;
    // Fitted: the scale it's drawn at, here a 1024 × 768 window showing a taller page.
    expect(field.value).toMatch(/^\d+%$/);
    expect(field.value).not.toBe("100%");
    expect($(".zoom-fit")!.hidden).toBe(false);
    buttonLabelled(reader, "1:1").click();
    expect(field.value).toBe("100%");
    expect($(".zoom-fit")!.hidden).toBe(true);
    buttonLabelled(reader, "Zoom in").click();
    expect(field.value).toBe("125%");
  });

  it("takes a typed zoom value on Enter, and leaves the reader's keys alone meanwhile", () => {
    const { reader, $ } = setup();
    reader.open(4);
    const field = $<HTMLInputElement>(".zoom-value")!;
    field.focus();
    field.value = "250";
    const typed = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, composed: true, cancelable: true });
    field.dispatchEvent(typed);
    expect(reader.page).toBe(4); // not the next page
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true, cancelable: true }));
    expect(reader.zoom).toEqual({ fit: false, scale: 2.5 });
    expect(reader.isOpen).toBe(true);
  });

  it("scrubs the zoom by dragging sideways on its value, and starts typing on a plain click", () => {
    const { reader, $ } = setup();
    reader.open(4);
    buttonLabelled(reader, "1:1").click();
    const field = $<HTMLInputElement>(".zoom-value")!;
    const pointer = (type: string, clientX: number) => field.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, clientX }));
    pointer("pointerdown", 100);
    pointer("pointermove", 200); // 100 px right
    pointer("pointerup", 200);
    expect(reader.zoom).toEqual({ fit: false, scale: expect.closeTo(1.004 ** 100, 5) });
    pointer("pointerdown", 50);
    pointer("pointerup", 50);
    expect(reader.shadowRoot!.activeElement).toBe(field);
  });

  it("shows the panels and quick settings as toggles", () => {
    const { reader } = setup();
    reader.open(4);
    expect([pressed(reader, "Filmstrip"), pressed(reader, "Grid"), pressed(reader, "Quick settings")]).toEqual(["false", "false", "false"]);
    buttonLabelled(reader, "Filmstrip").click();
    buttonLabelled(reader, "Quick settings").click();
    expect([pressed(reader, "Filmstrip"), pressed(reader, "Quick settings")]).toEqual(["true", "true"]);
  });

  it("shows every button's key in a badge and in its tooltip", () => {
    const { reader } = setup();
    reader.open(4);
    const buttons = [...reader.shadowRoot!.querySelectorAll<HTMLButtonElement>(".toolbar button")];
    expect(buttons.length).toBeGreaterThan(10);
    for (const button of buttons) {
      const badge = button.querySelector(".key")!.textContent!;
      expect(badge, button.title).not.toBe("");
      expect(button.title.endsWith(`(${badge})`), button.title).toBe(true);
    }
    expect(buttonLabelled(reader, "Grid").querySelector(".key")!.textContent).toBe("G");
    expect(buttonLabelled(reader, "← Gallery").querySelector(".key")!.textContent).toBe("Esc");
  });
});

describe("Reader thumbnail views", () => {
  it("resizes the open view's thumbnails and remembers the size per view", () => {
    const { reader, saved } = setup();
    reader.open(4);
    press("]"); // nothing open: nothing to resize
    expect(saved).toEqual([]);
    press("t");
    press("]");
    expect(saved.at(-1)).toEqual({ thumbWidth: { filmstrip: 96, grid: 150 } });
    expect(reader.shadowRoot!.querySelector<HTMLElement>(".filmstrip .cell")!.style.width).toBe("96px");
    press("g");
    press("[");
    expect(saved.at(-1)).toEqual({ thumbWidth: { filmstrip: 96, grid: 125 } });
  });

  it("passes the furthest page to the grid and filmstrip, before or after they open", () => {
    const { reader, $ } = setup({ pageCount: 200 });
    reader.setMarks({ furthest: 120 });
    reader.open(1);
    reader.toggleGrid();
    expect($('.thumbs.grid .cell[data-page="120"] .mark.furthest')).not.toBeNull();
    reader.setMarks({ furthest: 125 });
    expect($('.thumbs.grid .cell[data-page="125"] .mark.furthest')).not.toBeNull();
    expect($('.thumbs.grid .cell[data-page="120"] .mark.furthest')).toBeNull();
  });

  it("moves around the grid with Home and End while it's open, instead of turning pages", () => {
    const { reader, $ } = setup({ pageCount: 500 });
    reader.open(250);
    reader.toggleGrid();
    const scroller = $(".thumbs.grid .thumb-scroll")!;
    press("End");
    expect(scroller.scrollTop).toBeGreaterThan(0);
    press("Home");
    expect(scroller.scrollTop).toBe(0);
    expect(reader.page).toBe(250);
  });

  it("resizes the grid's thumbnails with + and − while it's open, instead of zooming", () => {
    const { reader, saved } = setup();
    reader.open(1);
    reader.toggleGrid();
    press("+");
    expect(saved.at(-1)).toEqual({ thumbWidth: { filmstrip: 80, grid: 180 } });
    press("-");
    expect(saved.at(-1)).toEqual({ thumbWidth: { filmstrip: 80, grid: 150 } });
    expect(reader.zoom).toEqual(FIT);
    reader.toggleGrid();
    press("+");
    expect(reader.zoom).not.toEqual(FIT);
  });

  it("gives the grid the same size buttons as the filmstrip", () => {
    const { reader, saved, $ } = setup();
    reader.open(1);
    reader.toggleGrid();
    const buttons = [...$(".thumbs.grid .thumb-controls")!.querySelectorAll("button")];
    expect(buttons.slice(-2).map((b) => b.firstChild?.textContent)).toEqual(["−", "+"]);
    buttons.at(-1)!.click();
    expect(saved.at(-1)).toEqual({ thumbWidth: { filmstrip: 80, grid: 180 } });
  });

  it("lays the grid over the filmstrip and the hands-free pill whichever opened first, leaving them out of sight", () => {
    const { reader, $ } = setup();
    reader.open(1);
    reader.toggleGrid();
    reader.toggleFilmstrip(); // built after the grid, so later in the reader
    expect($(".reader")!.classList.contains("grid-open")).toBe(true);
    // happy-dom doesn't cascade: what the stylesheet says for each.
    const css = $("style")!.textContent!;
    const zOf = (selector: string) => Number(new RegExp(`\\n${selector.replace(/[.]/g, "\\.")} \\{[^}]*z-index: (\\d+)`).exec(css)?.[1]);
    expect(zOf(".thumbs.grid")).toBeGreaterThan(zOf(".thumbs"));
    expect(zOf(".toolbar")).toBeGreaterThan(zOf(".thumbs.grid"));
    expect(css).toMatch(/\.reader\.grid-open \.thumbs\.filmstrip, \.reader\.grid-open \.auto-zone \{ visibility: hidden; \}/);
    reader.toggleGrid();
    expect($(".reader")!.classList.contains("grid-open")).toBe(false);
  });

  it("keeps the page count with its progress, and the panels' controls while one is open, to float when the toolbar hides", () => {
    const { reader, $ } = setup({ pageCount: 200 });
    reader.open(50);
    const where = $(".toolbar > .tb-float.tb-where")!;
    expect(where.querySelector(".indicator")!.textContent).toBe("50 / 200");
    expect(where.querySelector<HTMLElement>(".tb-progress > span")!.style.width).toBe("25%");
    const panels = $(".toolbar > .tb-float.tb-panels")!;
    expect([...panels.children].map((c) => c.getAttribute("aria-label"))).toEqual(["Filmstrip", "Grid", "Hover zoom", "Filmstrip position"]);
    const root = $(".reader")!;
    expect(root.classList.contains("panels-open")).toBe(false);
    reader.toggleFilmstrip();
    expect(root.classList.contains("panels-open")).toBe(true);
    reader.toggleGrid();
    reader.toggleFilmstrip();
    expect(root.classList.contains("panels-open")).toBe(true); // the grid still is
    reader.toggleGrid();
    expect(root.classList.contains("panels-open")).toBe(false);
    reader.goTo(200);
    expect(where.querySelector<HTMLElement>(".tb-progress > span")!.style.width).toBe("100%");
  });

  it("puts the page choices before the spread toggles: Page|Strip, LTR|RTL, Spread, Pair cover, Re-pair", () => {
    const { reader, $ } = setup();
    reader.open(1);
    const names = [...$(".toolbar")!.children].map((c) => c.getAttribute("aria-label") ?? c.firstChild?.textContent);
    const from = names.indexOf("Reading mode");
    expect(names.slice(from, from + 5)).toEqual(["Reading mode", "Reading direction", "Spread", "Pair cover", "Re-pair"]);
  });

  it("has hover zoom and the filmstrip's position beside the panel toggles, the position greyed out while the filmstrip is closed", () => {
    const { reader, saved, $ } = setup();
    reader.open(1);
    const panels = [...$(".toolbar .tb-panels")!.children];
    const at = (el: Element) => panels.indexOf(el);
    const hover = buttonLabelled(reader, "Hover zoom");
    const position = $('.toolbar [aria-label="Filmstrip position"]')!;
    expect([at(hover), at(position)]).toEqual([at(buttonLabelled(reader, "Grid")) + 1, at(buttonLabelled(reader, "Grid")) + 2]);
    expect([hover.getAttribute("aria-pressed"), position.getAttribute("aria-disabled")]).toEqual(["true", "true"]);
    reader.toggleFilmstrip();
    expect(position.getAttribute("aria-disabled")).toBe("false");
    position.querySelector<HTMLButtonElement>('[data-value="left"]')!.click();
    expect(saved.at(-1)).toEqual({ filmstripVertical: true });
    expect($(".thumbs.filmstrip")!.classList.contains("vertical")).toBe(true);
    hover.click();
    expect([saved.at(-1), hover.getAttribute("aria-pressed")]).toEqual([{ hoverZoom: false }, "false"]);
    reader.toggleFilmstrip();
    expect([position.getAttribute("aria-disabled"), position.querySelector('[aria-checked="true"]')!.getAttribute("data-value")]).toEqual(["true", "left"]);
  });

  it("moves the filmstrip to the left edge and back, remembering it", () => {
    const { reader, saved } = setup();
    reader.open(4);
    press("v");
    expect(reader.filmstripOpen).toBe(true);
    expect(reader.shadowRoot!.querySelector(".filmstrip")!.classList.contains("vertical")).toBe(true);
    expect(saved).toEqual([{ filmstripVertical: true }]);
    press("v");
    expect(reader.shadowRoot!.querySelector(".filmstrip")!.classList.contains("vertical")).toBe(false);
  });

  it("opens the filmstrip in the remembered orientation and size", () => {
    const { reader } = setup({ initial: { filmstripVertical: true, thumbWidth: { filmstrip: 64, grid: 150 } } });
    reader.open(4);
    press("t");
    const filmstrip = reader.shadowRoot!.querySelector(".filmstrip")!;
    expect(filmstrip.classList.contains("vertical")).toBe(true);
    expect(filmstrip.querySelector<HTMLElement>(".cell")!.style.width).toBe("64px");
  });
});

describe("Reader hands-free mode", () => {
  const FAKE = ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] as const;
  const moveTo = (reader: Reader, x: number, y: number, target?: Element) =>
    (target ?? reader.shadowRoot!.querySelector(".reader")!).dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }));
  // Spots on the pill's track at its default place.
  const box = () => placePill({ width: window.innerWidth, height: window.innerHeight }, null);
  const edge = () => box().left + box().width / 2;
  const low = () => box().top + PILL.grab + PILL.track - 1; // forward, slowest in page mode
  const forward = () => box().top + PILL.grab + PILL.track / 2 + 60;
  const quick = () => box().top + PILL.grab + PILL.track / 2 + deadZone(PILL.track) + 24; // forward, 2 s a page

  it("starts when the cursor rests on the right edge, and turns pages", () => {
    vi.useFakeTimers({ toFake: [...FAKE] });
    const { reader, voiceEvents } = setup();
    reader.open(10);
    moveTo(reader, edge(), quick());
    vi.advanceTimersByTime(400);
    expect(reader.autoState).toBe("running");
    expect(voiceEvents).toEqual(["start"]);
    vi.advanceTimersByTime(2100); // 24 px of liquid is 2 s a page
    expect(reader.page).toBe(11);
  });

  it("runs silently without a character: no voice, the same hands-free", () => {
    vi.useFakeTimers({ toFake: [...FAKE] });
    const { reader, voiceEvents, $ } = setup({ character: false });
    reader.open(10);
    expect($(".voice")).toBeNull();
    press(" ");
    vi.advanceTimersByTime(2100);
    expect([reader.autoState, reader.page, voiceEvents]).toEqual(["locked", 11, []]);
    press(" ");
    expect(reader.autoState).toBe("idle");
  });

  it("does one thing with Space in each state: starts locked when off, locks while steering, stops when locked", () => {
    vi.useFakeTimers({ toFake: [...FAKE] });
    const { reader, voiceEvents } = setup();
    reader.open(10);
    // Steering on the pill: Space locks the speed set there.
    moveTo(reader, edge(), forward());
    vi.advanceTimersByTime(400);
    expect(reader.autoState).toBe("running");
    press(" ");
    expect([reader.autoState, reader.page]).toEqual(["locked", 10]);
    moveTo(reader, 100, 100); // off the pill: a locked run keeps going
    expect(reader.autoState).toBe("locked");
    // Locked: Space stops it.
    press(" ");
    expect(reader.autoState).toBe("idle");
    // Off: Space starts it, locked.
    press(" ");
    expect(reader.autoState).toBe("locked");
    expect(voiceEvents).toEqual(["start", "locked", "stopped", "start"]);
  });

  it("stops with Esc before closing the reader", () => {
    vi.useFakeTimers({ toFake: [...FAKE] });
    const { reader, voiceEvents } = setup();
    reader.open(10);
    press(" ");
    press("Escape");
    expect([reader.autoState, reader.isOpen, voiceEvents]).toEqual(["idle", true, ["start", "stopped"]]);
  });

  it("starts with Space at the default pace when there's no last one, locked, and stops with Space", () => {
    vi.useFakeTimers({ toFake: [...FAKE] });
    const { reader, voiceEvents, saved } = setup();
    reader.open(10);
    const event = press(" ");
    expect([event.defaultPrevented, reader.autoState, reader.page]).toEqual([true, "locked", 10]);
    vi.advanceTimersByTime(2100); // 2 s a page, by default
    expect(reader.page).toBe(11);
    press(" ");
    expect(reader.autoState).toBe("idle");
    expect(voiceEvents).toEqual(["start", "stopped"]);
    expect(saved.at(-1)).toEqual({ autoPace: { page: 2, strip: null } });
  });

  it("starts with Space at the pace last used in the reading mode, each mode its own", () => {
    vi.useFakeTimers({ toFake: [...FAKE] });
    const { reader, saved } = setup({ initial: { autoPace: { page: 5, strip: null }, autoDefaultPace: { page: 2, strip: 1.5 } } });
    reader.open(10);
    press(" ");
    vi.advanceTimersByTime(4000);
    expect(reader.page).toBe(10); // 5 s a page
    vi.advanceTimersByTime(1100);
    expect(reader.page).toBe(11);
    press(" ");
    // Strip mode has none yet: its default.
    reader.setMode("strip");
    press(" ");
    expect(reader.autoState).toBe("locked");
    press(" ");
    expect(saved.at(-1)).toEqual({ autoPace: { page: 5, strip: 1.5 } });
    // A run set on the pill counts as used too.
    reader.setMode("page");
    moveTo(reader, edge(), quick()); // 2 s a page
    vi.advanceTimersByTime(400);
    press(" "); // locks it
    press(" "); // and stops it
    expect([reader.autoState, saved.at(-1)]).toEqual(["idle", { autoPace: { page: 2, strip: 1.5 } }]);
  });

  it("doesn't start hands-free with Space while the grid is open, saying why", () => {
    const { reader } = setup();
    reader.open(10);
    reader.toggleGrid();
    press(" ");
    expect([reader.autoState, reader.noticeText]).toEqual(["idle", "Hands-free mode doesn't run while the grid is open."]);
  });

  it("doesn't start over the toolbar or the pill's grab bar", () => {
    vi.useFakeTimers({ toFake: [...FAKE] });
    const { reader } = setup();
    reader.open(10);
    moveTo(reader, edge(), low(), reader.shadowRoot!.querySelector(".toolbar .indicator")!);
    vi.advanceTimersByTime(1000);
    moveTo(reader, edge(), low(), reader.shadowRoot!.querySelector(".auto-grab")!);
    vi.advanceTimersByTime(1000);
    expect(reader.autoState).toBe("idle");
  });

  it("puts the pill where it was dragged before, and saves a new place", () => {
    const { reader, saved } = setup({ initial: { autoZone: { x: 0, y: 0 } } });
    reader.open(10);
    const pill = reader.shadowRoot!.querySelector<HTMLElement>(".auto-zone")!;
    expect([pill.style.left, pill.style.top]).toEqual(["0px", "0px"]);
    const grab = pill.querySelector(".auto-grab")!;
    const pointer = (type: string, x: number, y: number) =>
      grab.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, button: 0, bubbles: true, cancelable: true }));
    pointer("pointerdown", 10, 5);
    pointer("pointermove", 210, 105);
    pointer("pointerup", 210, 105);
    expect(pill.style.left).toBe("200px");
    expect(saved.at(-1)!.autoZone!.x).toBeCloseTo(200 / (window.innerWidth - PILL.width));
  });

  it("stops without a message when the mode changes or the reader hides", () => {
    vi.useFakeTimers({ toFake: [...FAKE] });
    const { reader, voiceEvents } = setup();
    reader.open(10);
    moveTo(reader, edge(), low());
    vi.advanceTimersByTime(400);
    press("m");
    expect(reader.autoState).toBe("idle");
    press("m"); // back to page mode: happy-dom has no layout, so a strip counts as already at its end
    moveTo(reader, 100, 100);
    moveTo(reader, edge(), low());
    vi.advanceTimersByTime(400);
    press("b");
    expect(reader.autoState).toBe("idle");
    expect(voiceEvents).toEqual(["start", "start"]);
  });

  it("keeps the page when M switches to page mode while hands-free scrolls the strip", () => {
    vi.useFakeTimers({ toFake: [...FAKE] });
    const { reader, $ } = setup({ isWide: () => false });
    reader.open(20);
    reader.setMode("strip");
    vi.advanceTimersByTime(100);
    expect(reader.page).toBe(20);
    press(" "); // hands-free on: it scrolls every frame
    const strip = $(".strip")!;
    strip.dispatchEvent(new Event("scroll")); // its latest scroll, the strip's frame still to come
    press("m");
    // Firefox reads a strip hidden away as scrolled to its top.
    strip.scrollTop = 0;
    vi.advanceTimersByTime(100);
    expect([reader.mode, reader.page, $(".indicator")!.textContent]).toEqual(["page", 20, "20 / 100"]);
  });

  it("keeps the page switching modes either way, with hands-free running or not", () => {
    vi.useFakeTimers({ toFake: [...FAKE] });
    const { reader } = setup({ isWide: () => false });
    reader.open(30);
    press(" "); // hands-free in page mode
    press("m"); // to strip mode
    vi.advanceTimersByTime(100);
    expect([reader.mode, reader.page, reader.autoState]).toEqual(["strip", 30, "idle"]);
    press("m"); // back, without hands-free
    vi.advanceTimersByTime(100);
    expect([reader.mode, reader.page]).toEqual(["page", 30]);
  });

  it("ends a run steered on the pill when the cursor leaves the window", () => {
    vi.useFakeTimers({ toFake: [...FAKE] });
    const { reader, voiceEvents } = setup();
    reader.open(10);
    moveTo(reader, edge(), low());
    vi.advanceTimersByTime(400);
    document.dispatchEvent(new MouseEvent("mouseout", { relatedTarget: null }));
    expect(reader.autoState).toBe("idle");
    expect(voiceEvents.at(-1)).toBe("stopped");
  });

  it("keeps a locked run going when the cursor leaves the window or the window loses focus", () => {
    vi.useFakeTimers({ toFake: [...FAKE] });
    const { reader } = setup();
    reader.open(10);
    press(" "); // locked, 2 s a page
    document.dispatchEvent(new MouseEvent("mouseout", { relatedTarget: null }));
    expect(reader.autoState).toBe("locked");
    window.dispatchEvent(new Event("blur")); // alt-tab
    expect(reader.autoState).toBe("locked");
    vi.advanceTimersByTime(2100);
    expect(reader.page).toBe(11);
  });

  it("stops a locked run when the tab is hidden", () => {
    vi.useFakeTimers({ toFake: [...FAKE] });
    const { reader } = setup();
    reader.open(10);
    press(" ");
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(reader.autoState).toBe("idle");
    visibility.mockRestore();
  });

  it("restarts the countdown on the page landed on after a manual page change", () => {
    vi.useFakeTimers({ toFake: [...FAKE] });
    const { reader } = setup();
    reader.open(10);
    moveTo(reader, edge(), quick()); // 2 s a page
    vi.advanceTimersByTime(400); // running
    vi.advanceTimersByTime(1500); // most of the countdown used
    press("ArrowRight");
    expect(reader.page).toBe(11);
    vi.advanceTimersByTime(1000); // 2.5 s since starting, 1 s on page 11
    expect(reader.page).toBe(11); // the full 2 s starts again on page 11
    vi.advanceTimersByTime(1100);
    expect(reader.page).toBe(12);
  });

  it("refills the liquid to the full amount after a jump from the grid", () => {
    vi.useFakeTimers({ toFake: [...FAKE] });
    const { reader } = setup();
    reader.open(10);
    moveTo(reader, edge(), quick());
    vi.advanceTimersByTime(400);
    vi.advanceTimersByTime(1500);
    const gauge = () => parseFloat(reader.shadowRoot!.querySelector<HTMLElement>(".gauge")!.style.height);
    expect(gauge()).toBeLessThan(10); // mostly drained
    reader.goTo(40); // the grid and filmstrip jump through goTo
    expect(gauge()).toBeGreaterThan(23); // back to the cursor's 24 px
  });

  it("switches the pill's notches with the mode, without waiting for the mouse", () => {
    const { reader } = setup();
    reader.open(10);
    const labels = () => [...reader.shadowRoot!.querySelectorAll(".notch-label")].map((l) => l.textContent);
    expect(labels()[0]).toBe("2s");
    press("m");
    expect(labels()[0]).toBe("0.5×");
    press("m");
    expect(labels()[0]).toBe("2s");
  });

  it("lists the hands-free keys in the shortcut list", () => {
    const { reader } = setup();
    reader.open(4);
    expect(reader.shadowRoot!.querySelector(".help h3")!.textContent).toBe("While hands-free mode runs");
  });
});

describe("Reader with rebound keys", () => {
  it("uses the rebound key, and shows it on the badge, the tooltip and the shortcut list", () => {
    const { reader } = setup({ initial: { keys: { filmstrip: ["y"] } } });
    reader.open(4);
    press("t");
    expect(reader.filmstripOpen).toBe(false);
    press("y");
    expect(reader.filmstripOpen).toBe(true);
    const filmstrip = buttonLabelled(reader, "Filmstrip");
    expect(filmstrip.querySelector(".key")!.textContent).toBe("Y");
    expect(filmstrip.title).toBe("Filmstrip (Y)");
    const helpRow = [...reader.shadowRoot!.querySelectorAll(".help-keys tr")].find((tr) => tr.textContent!.includes("Filmstrip"))!;
    expect(helpRow.querySelector("kbd")!.textContent).toBe("Y");
  });

  it("follows a change made while it's open, including the filmstrip's own buttons", () => {
    const { reader } = setup();
    reader.open(4);
    press("t");
    reader.applySettings({ ...DEFAULT_SETTINGS, keys: { grid: ["k"], thumbsLarger: ["l"] } });
    expect(buttonLabelled(reader, "Grid").querySelector(".key")!.textContent).toBe("K");
    press("g");
    expect(reader.gridOpen).toBe(false);
    press("k");
    expect(reader.gridOpen).toBe(true);
    const larger = [...reader.shadowRoot!.querySelectorAll<HTMLButtonElement>(".filmstrip .thumb-controls button")].at(-1)!;
    expect(larger.querySelector(".key")!.textContent).toBe("L");
  });

  it("hides the badge of an action left without a key, and names the button instead in notices", () => {
    const { reader } = setup({ initial: { keys: { spreads: [] } } });
    reader.open(4);
    const spread = buttonLabelled(reader, "Spread");
    expect(spread.querySelector<HTMLElement>(".key")!.hidden).toBe(true);
    expect(spread.title).toBe("Two-page spreads on or off (page mode)");
    press("o");
    expect(reader.noticeText).toBe("Two-page spreads are off. Turn them on with the Spread button first.");
  });

  it("uses a rebound hands-free key", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] });
    const { reader } = setup({ initial: { keys: { autoPlay: ["k"] } } });
    reader.open(10);
    const box = placePill({ width: window.innerWidth, height: window.innerHeight }, null);
    reader.shadowRoot!.querySelector(".reader")!.dispatchEvent(new MouseEvent("mousemove", { clientX: box.left + 10, clientY: box.top + PILL.grab + PILL.track / 2 + 60, bubbles: true }));
    vi.advanceTimersByTime(400);
    press("k");
    expect(reader.autoState).toBe("locked");
    press(" "); // Space is free now
    expect(reader.autoState).toBe("locked");
  });
});
