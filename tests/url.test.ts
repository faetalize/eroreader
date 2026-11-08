import { describe, expect, it } from "vitest";
import { pageKind } from "../src/site/url";

const kind = (url: string) => pageKind(new URL(url));

describe("pageKind", () => {
  it("recognizes gallery pages with their id and token", () => {
    expect(kind("https://e-hentai.org/g/1234567/0123456789/")).toEqual({ kind: "gallery", gid: 1234567, token: "0123456789" });
    expect(kind("https://exhentai.org/g/42/abcdef0123/?p=2#page=5")).toEqual({ kind: "gallery", gid: 42, token: "abcdef0123" });
  });

  it("recognizes image pages", () => {
    expect(kind("https://e-hentai.org/s/0123456789/1234567-3").kind).toBe("image");
  });

  it("recognizes listing pages", () => {
    for (const url of [
      "https://e-hentai.org/",
      "https://e-hentai.org/?f_search=test",
      "https://exhentai.org/tag/language:english",
      "https://e-hentai.org/uploader/someone",
      "https://e-hentai.org/favorites.php?favcat=1",
      "https://e-hentai.org/popular",
      "https://exhentai.org/watched",
    ]) {
      expect(kind(url).kind, url).toBe("listing");
    }
  });

  it("leaves everything else alone", () => {
    for (const url of ["https://e-hentai.org/uconfig.php", "https://e-hentai.org/g/abc/def/", "https://e-hentai.org/mpv/1/abc/"]) {
      expect(kind(url).kind, url).toBe("other");
    }
  });
});
