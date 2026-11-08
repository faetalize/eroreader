import { describe, expect, it, vi } from "vitest";
import { bannerStatus, createProgressBanner, markLastRead } from "../src/content/gallery/banner";
import { fixture } from "./fixtures";

const actions = () => ({ onOpen: vi.fn(), onShow: vi.fn(), onMarkFinished: vi.fn(), onReset: vi.fn() });
const buttons = (banner: HTMLElement) => [...banner.querySelectorAll<HTMLButtonElement>(".erb-actions > button")].map((b) => b.textContent);
const menuItems = (banner: HTMLElement) => [...banner.querySelectorAll<HTMLButtonElement>("[role=menuitem]")];
const progress = (page: number, furthest: number, finished = false) => ({ page, furthest, pageCount: 381, finished });

describe("createProgressBanner", () => {
  it("says where reading stands, with the furthest page as quieter detail when it's further", () => {
    expect(bannerStatus(progress(132, 132))).toEqual({ headline: "Page 132 of 381", detail: null });
    expect(bannerStatus(progress(132, 134))).toEqual({ headline: "Page 132 of 381", detail: "furthest page 134" });
    expect(bannerStatus(progress(12, 381, true))).toEqual({ headline: "Page 12 of 381", detail: "finished before" });
    expect(bannerStatus(progress(381, 381, true))).toEqual({ headline: "Finished", detail: "381 pages" });
    expect(bannerStatus(progress(12, 12, true))).toEqual({ headline: "Finished", detail: "381 pages" }); // marked by hand
  });

  it("offers one primary action, resuming, with jumping to the furthest page beside it", () => {
    const handlers = actions();
    const banner = createProgressBanner(document, progress(132, 134), handlers);
    expect(buttons(banner)).toEqual(["Resume", "Jump to furthest", "Show on page"]);
    expect(banner.querySelector(".erb-primary")!.textContent).toBe("Resume");
    banner.querySelector<HTMLButtonElement>(".erb-primary")!.click();
    [...banner.querySelectorAll<HTMLButtonElement>(".erb-actions > button")][1]!.click();
    [...banner.querySelectorAll<HTMLButtonElement>(".erb-actions > button")][2]!.click();
    expect(handlers.onOpen.mock.calls).toEqual([[132], [134]]);
    expect(handlers.onShow).toHaveBeenCalledWith(132);
  });

  it("shows both pages on one bar, the furthest as the lighter part", () => {
    const banner = createProgressBanner(document, progress(132, 134), actions());
    expect(banner.querySelector<HTMLElement>(".erb-fill")!.style.width).toMatch(/^34\.6/);
    expect(banner.querySelector<HTMLElement>(".erb-fill-furthest")!.style.width).toMatch(/^35\.1/);
    expect(banner.querySelector(".erb-bar")!.getAttribute("aria-valuetext")).toBe("Page 132 of 381, furthest page 134");
    expect(banner.querySelector(".erb-swatch")).not.toBeNull();
  });

  it("keeps Mark as finished and Reset progress in a small menu", () => {
    const handlers = actions();
    const banner = createProgressBanner(document, progress(132, 134), handlers);
    document.body.append(banner);
    const more = banner.querySelector<HTMLButtonElement>(".erb-more-button")!;
    const menu = banner.querySelector<HTMLElement>("[role=menu]")!;
    expect(menu.hidden).toBe(true);
    more.click();
    expect([menu.hidden, more.getAttribute("aria-expanded")]).toEqual([false, "true"]);
    expect(menuItems(banner).map((b) => b.textContent)).toEqual(["Show on page", "Mark as finished", "Reset progress…"]);
    menuItems(banner)[1]!.click();
    expect(handlers.onMarkFinished).toHaveBeenCalledTimes(1);
    expect(menu.hidden).toBe(true);
    more.click();
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(menu.hidden).toBe(true); // a click elsewhere
    more.click();
    more.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); // from the focused button
    expect(menu.hidden).toBe(true);
    document.body.innerHTML = "";
  });

  it("offers reading again once finished, and no Mark as finished", () => {
    const handlers = actions();
    const banner = createProgressBanner(document, progress(381, 381, true), handlers);
    expect(buttons(banner)).toEqual(["Read again", "Show on page"]);
    banner.querySelector<HTMLButtonElement>(".erb-primary")!.click();
    expect(handlers.onOpen).toHaveBeenCalledWith(1);
    expect(menuItems(banner).map((b) => b.textContent)).toEqual(["Show on page", "Reset progress…"]);
  });

  it("resumes a finished gallery being reread where it was left", () => {
    const banner = createProgressBanner(document, progress(12, 381, true), actions());
    expect(buttons(banner)).toEqual(["Resume", "Show on page"]);
  });
});

describe("markLastRead", () => {
  it("marks only the last-read page's thumbnail", () => {
    const grid = fixture("eh-gallery-p0.html").querySelector("#gdt")!;
    markLastRead(grid, 12);
    markLastRead(grid, 2);
    const marked = [...grid.querySelectorAll(".eroreader-last-read")].map((a) => a.getAttribute("href"));
    expect(marked).toEqual([grid.querySelectorAll("a")[1]!.getAttribute("href")]);
    expect(marked[0]).toMatch(/-2$/);
    markLastRead(grid, null);
    expect(grid.querySelectorAll(".eroreader-last-read")).toHaveLength(0);
  });

  it("marks the furthest page read apart from the last page read", () => {
    const grid = fixture("eh-gallery-p0.html").querySelector("#gdt")!;
    markLastRead(grid, 2, true, 5);
    expect([...grid.querySelectorAll(".eroreader-furthest")].map((a) => a.getAttribute("href"))).toEqual([expect.stringMatching(/-5$/)]);
    markLastRead(grid, 5, true, 5); // the same page: only the last-read mark
    expect(grid.querySelectorAll(".eroreader-furthest")).toHaveLength(0);
  });

  it("makes the mark pulse while the gallery is still being read", () => {
    const grid = fixture("eh-gallery-p0.html").querySelector("#gdt")!;
    markLastRead(grid, 2, true);
    expect(grid.querySelectorAll(".eroreader-last-read.eroreader-reading")).toHaveLength(1);
    markLastRead(grid, 2, false);
    expect(grid.querySelectorAll(".eroreader-reading")).toHaveLength(0);
  });
});
