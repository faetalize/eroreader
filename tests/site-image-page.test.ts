import { describe, expect, it } from "vitest";
import { isLimitImage, parseImagePage, retryUrl } from "../src/site/imagePage";
import { fixture } from "./fixtures";

describe("parseImagePage", () => {
  it("reads the image, its size, the retry key and the showkey", () => {
    expect(parseImagePage(fixture("image-page.html"))).toEqual({
      imageUrl:
        "https://abcdefghij.klmnopqrst.hath.network:1024/h/samplefilehash-12345-1280-1810-jpg/keystamp=0000000000-0000000000;fileindex=000000000;xres=org/002.jpg",
      width: 1280,
      height: 1810,
      nlKey: "12345-678901",
      showkey: "sampleshow0",
      isLimit: false,
      prevHref: "https://exhentai.org/s/0000001eef/7654321-1",
      nextHref: "https://exhentai.org/s/0000002e96/7654321-3",
    });
  });

  it("flags the 509 placeholder", () => {
    const doc = fixture("image-page.html");
    doc.querySelector("#img")!.setAttribute("src", "https://exhentai.org/img/509.gif");
    expect(parseImagePage(doc)?.isLimit).toBe(true);
  });

  it("returns null without an image", () => {
    const doc = fixture("image-page.html");
    doc.querySelector("#img")!.remove();
    expect(parseImagePage(doc)).toBeNull();
  });

  it("tolerates a missing size line and retry link", () => {
    const doc = fixture("image-page.html");
    doc.querySelector("#i4")!.remove();
    doc.querySelector("#loadfail")!.remove();
    expect(parseImagePage(doc)).toMatchObject({ width: null, height: null, nlKey: null });
  });
});

describe("isLimitImage", () => {
  it("matches the placeholder only", () => {
    expect(isLimitImage("https://ehgt.org/g/509.gif")).toBe(true);
    expect(isLimitImage("https://exhentai.org/img/509s.gif?x=1")).toBe(true);
    expect(isLimitImage("https://a.hath.network/h/x/509.jpg")).toBe(false);
    expect(isLimitImage("https://a.hath.network/h/x/1509.gif")).toBe(false);
  });
});

describe("retryUrl", () => {
  it("appends one nl parameter per retry", () => {
    const once = retryUrl("https://e-hentai.org/s/abc/1-2", "k1");
    expect(once).toBe("https://e-hentai.org/s/abc/1-2?nl=k1");
    expect(retryUrl(once, "k2")).toBe("https://e-hentai.org/s/abc/1-2?nl=k1&nl=k2");
  });
});
