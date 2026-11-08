import { describe, expect, it } from "vitest";
import { parseListing } from "../src/site/listing";
import { fixture } from "./fixtures";

const BASE = new URL("https://e-hentai.org/?f_search=sample");

describe("parseListing", () => {
  it("reads every result once, with its row and cover", () => {
    const { cards } = parseListing(fixture("eh-listing-compact.html"), BASE);
    expect(cards.map(({ gid, token, title, pageCount }) => ({ gid, token, title, pageCount }))).toEqual([
      { gid: 1111003, token: "aaaaaaaaaa", title: "First Sample Gallery", pageCount: 24 },
      { gid: 1111002, token: "bbbbbbbbbb", title: "Second Sample Gallery", pageCount: 1 },
      { gid: 1111001, token: "cccccccccc", title: "Third Sample Gallery", pageCount: 310 },
    ]);
    expect(cards[0]!.url).toBe("https://e-hentai.org/g/1111003/aaaaaaaaaa/");
    expect(cards[0]!.element.tagName).toBe("TR");
    expect(cards[0]!.cover?.getAttribute("src")).toBe("https://ehgt.org/w/00/000/1111003-sample.webp");
  });

  it("finds the next page", () => {
    expect(parseListing(fixture("eh-listing-compact.html"), BASE).nextUrl).toBe("https://e-hentai.org/?f_search=sample&next=1111000");
  });

  it("has no next page on the last results page", () => {
    const doc = fixture("eh-listing-compact.html");
    doc.querySelectorAll("#unext, #dnext").forEach((a) => a.removeAttribute("href"));
    expect(parseListing(doc, BASE).nextUrl).toBeNull();
  });
});

describe("parseListing in Thumbnail mode", () => {
  const BASE_EX = new URL("https://exhentai.org/?f_search=sample+query");

  it("reads the tiles, their covers and page counts", () => {
    const { cards, nextUrl } = parseListing(fixture("ex-listing-thumb-p1.html"), BASE_EX);
    expect(cards).toHaveLength(25);
    expect(cards[0]).toMatchObject({ gid: 2222025, title: "Sample Gallery 25", pageCount: 10 + (2222025 % 90) }); // as the fixture generator made it
    expect(cards[0]!.element.className).toBe("gl1t");
    expect(cards[0]!.cover!.closest(".gl3t")).not.toBeNull();
    expect(nextUrl).toBe("https://exhentai.org/?f_search=sample+query&next=2222001");
  });

  it("keeps the category filter in the next page's URL, and has none on the last page", () => {
    expect(parseListing(fixture("ex-listing-thumb-cats.html"), BASE_EX).nextUrl).toBe("https://exhentai.org/?f_search=sample+query&f_cats=112&next=2222001");
    expect(parseListing(fixture("ex-listing-thumb-last.html"), BASE_EX).nextUrl).toBeNull();
  });
});
