import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { galleryPageUrl, isContentWarning, parseGallery, thumbPageOf, thumbsPerPage } from "../src/site/gallery";
import { fixture, fixtureText } from "./fixtures";

const GALLERY = "https://e-hentai.org/g/1234567/0123456789/";

describe("parseGallery", () => {
  const first = parseGallery(fixture("eh-gallery-p0.html"), new URL(GALLERY))!;
  const last = parseGallery(fixture("eh-gallery-p8.html"), new URL(`${GALLERY}?p=8`))!;

  it("reads the gallery's details", () => {
    expect(first).toMatchObject({
      gid: 1234567,
      token: "0123456789",
      title: "Sample Gallery Title",
      titleJpn: "サンプル",
      category: "Non-H",
      pageCount: 172,
      coverUrl: "https://ehgt.org/w/00/000/00000-samplecv.webp",
      apiUrl: "https://api.e-hentai.org/api.php",
    });
  });

  it("reads tags with their namespace", () => {
    expect(first.tags).toEqual(["language:english", "artist:sample artist", "other:full color", "other:multi-work series"]);
  });

  it("reads thumbnails with their sprite cell", () => {
    expect(first.thumbs).toHaveLength(20);
    expect(first.thumbs[0]).toEqual({
      page: 1,
      imgkey: "0000001eef",
      href: "https://e-hentai.org/s/0000001eef/1234567-1",
      filename: "001.jpg",
      sprite: { url: "https://abcdefghij.hath.network/c2/samplespritepath/1234567-0.webp", x: 0, y: 0, width: 200, height: 280 },
    });
    expect(first.thumbs[4]!.sprite).toMatchObject({ x: -800, height: 141 });
    expect(last.thumbs.map((t) => t.page)).toEqual(Array.from({ length: 12 }, (_, i) => 161 + i));
  });

  it("works out the thumbnail page and the thumbnail page count, past the paginator's ellipsis", () => {
    expect([first.thumbPage, first.thumbPageCount]).toEqual([0, 9]);
    expect([last.thumbPage, last.thumbPageCount]).toEqual([8, 9]);
  });

  it("never reads the account's api key", () => {
    expect(JSON.stringify(first)).not.toContain("00000000000000000000");
    expect(Object.keys(first)).not.toContain("apikey");
  });

  it("returns null for a content warning or a page that isn't a gallery", () => {
    expect(parseGallery(fixture("content-warning.html"), new URL(GALLERY))).toBeNull();
    expect(parseGallery(fixture("eh-gallery-p0.html"), new URL("https://e-hentai.org/"))).toBeNull();
  });

  it("returns a single thumbnail page when there's no paginator", () => {
    const doc = fixture("eh-gallery-p0.html");
    doc.querySelectorAll("table.ptt, table.ptb").forEach((el) => el.remove());
    expect(parseGallery(doc, new URL(GALLERY))).toMatchObject({ thumbPage: 0, thumbPageCount: 1 });
  });
});

describe("thumbsPerPage", () => {
  it("is the same from the first and the last thumbnail page", () => {
    expect(thumbsPerPage(parseGallery(fixture("eh-gallery-p0.html"), new URL(GALLERY))!)).toBe(20);
    expect(thumbsPerPage(parseGallery(fixture("eh-gallery-p8.html"), new URL(`${GALLERY}?p=8`))!)).toBe(20);
  });
});

describe("thumbPageOf", () => {
  it("maps 1-based pages to 0-based thumbnail pages", () => {
    expect([1, 20, 21, 40, 172].map((page) => thumbPageOf(page, 20))).toEqual([0, 0, 1, 1, 8]);
  });
});

describe("galleryPageUrl", () => {
  it("leaves out p for the first thumbnail page", () => {
    expect(galleryPageUrl("https://exhentai.org", 1, "abc", 0).href).toBe("https://exhentai.org/g/1/abc/");
    expect(galleryPageUrl("https://exhentai.org", 1, "abc", 3).href).toBe("https://exhentai.org/g/1/abc/?p=3");
  });
});

describe("isContentWarning", () => {
  it("tells a warning page from a gallery page", () => {
    expect(isContentWarning(fixture("content-warning.html"))).toBe(true);
    expect(isContentWarning(fixture("eh-gallery-p0.html"))).toBe(false);
  });
});

describe("on ExHentai", () => {
  const EX = "https://exhentai.org/g/7654321/abcdef0123/";
  const first = parseGallery(fixture("ex-gallery-p0.html"), new URL(EX))!;
  const last = parseGallery(fixture("ex-gallery-p10.html"), new URL(`${EX}?p=10`))!;

  it("reads the same markup with ExHentai's hosts", () => {
    expect(first).toMatchObject({
      gid: 7654321,
      pageCount: 219,
      coverUrl: "https://s.exhentai.org/w/00/000/00000-samplecv.webp",
      apiUrl: "https://s.exhentai.org/api.php",
      thumbPageCount: 11,
    });
    expect(first.thumbs[0]!.href).toBe("https://exhentai.org/s/0000001eef/7654321-1");
  });

  it("works out the page size from a short last thumbnail page", () => {
    expect(last.thumbs).toHaveLength(19);
    expect([last.thumbPage, last.thumbPageCount]).toEqual([10, 11]);
    expect(thumbsPerPage(last)).toBe(20);
  });
});

// Fixtures copy real page structure with made-up values only.
it("fixtures use made-up gallery ids and hosts only", () => {
  const madeUp = (gid: number) => [1234567, 7654321, 1111001, 1111002, 1111003].includes(gid) || (gid > 2221900 && gid <= 2222025);
  for (const name of readdirSync(join(process.cwd(), "tests/fixtures"))) {
    const text = fixtureText(name);
    for (const [, gid] of text.matchAll(/\/(?:g\/|s\/[0-9a-f]+\/)(\d+)|gid=(\d+)/g)) if (gid) expect(madeUp(Number(gid)), `${name}: ${gid}`).toBe(true);
    for (const [host] of text.matchAll(/[\w.]+\.hath\.network/g)) expect(host, name).toMatch(/^abcdefghij\./);
    expect(text, name).not.toMatch(/var apikey = "[^0]|var apiuid = (?!-1;)/);
  }
});
