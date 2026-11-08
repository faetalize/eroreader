import { describe, expect, it } from "vitest";
import { pagerCells, renderPager, renderThumbs, showingText, type PagerCell } from "../src/content/gallery/render";
import { parseGallery } from "../src/site/gallery";
import { fixture } from "./fixtures";

// The paginator as text: page numbers, "*" on the current one, "<"/">" when enabled.
const describeCells = (cells: PagerCell[]) =>
  cells
    .map((c) => (c.kind === "gap" ? "..." : c.kind === "page" ? `${c.thumbPage + 1}${c.current ? "*" : ""}` : c.thumbPage === null ? "" : c.kind === "prev" ? "<" : ">"))
    .filter(Boolean)
    .join(" ");

describe("pagerCells", () => {
  it("matches the site's paginators", () => {
    // Both seen on real pages: E-Hentai's first page of 9 and ExHentai's last page of 11.
    expect(describeCells(pagerCells(0, 9))).toBe("1* 2 3 4 5 6 7 ... 9 >");
    expect(describeCells(pagerCells(10, 11))).toBe("< 1 ... 5 6 7 8 9 10 11*");
  });

  it("keeps the current page in the middle of the run", () => {
    expect(describeCells(pagerCells(10, 30))).toBe("< 1 ... 8 9 10 11* 12 13 14 ... 30 >");
  });

  it("handles short galleries", () => {
    expect(describeCells(pagerCells(0, 1))).toBe("1*");
    expect(describeCells(pagerCells(1, 3))).toBe("< 1 2* 3 >");
  });
});

describe("renderPager", () => {
  it("draws cells with the site's classes", () => {
    const table = document.createElement("table");
    renderPager(table, 0, 9, (p) => `https://e-hentai.org/g/1/a/?p=${p}`);
    const cells = [...table.querySelectorAll("td")];
    expect(cells[0]!.className).toBe("ptdd");
    expect(cells[1]!.className).toBe("ptds");
    expect(cells[2]!.querySelector("a")!.getAttribute("href")).toBe("https://e-hentai.org/g/1/a/?p=1");
    expect(cells.map((c) => c.textContent)).toEqual(["<", "1", "2", "3", "4", "5", "6", "7", "...", "9", ">"]);
  });
});

describe("renderThumbs", () => {
  it("draws thumbnails that parse back to the same data", () => {
    const url = new URL("https://e-hentai.org/g/1234567/0123456789/?p=8");
    const original = parseGallery(fixture("eh-gallery-p8.html"), url)!;
    const doc = fixture("eh-gallery-p0.html");
    renderThumbs(doc.querySelector("#gdt")!, original.thumbs);
    expect(parseGallery(doc, url)!.thumbs).toEqual(original.thumbs);
  });
});

describe("showingText", () => {
  it("matches the site's wording", () => {
    const thumbs = parseGallery(fixture("eh-gallery-p8.html"), new URL("https://e-hentai.org/g/1234567/0123456789/?p=8"))!.thumbs;
    expect(showingText(thumbs, 172)).toBe("Showing 161 - 172 of 172 images");
  });
});
