// Image page `/s/{imgkey}/{gid}-{page}`.
import { scriptVar, textOf } from "./html";

export interface ImagePage {
  imageUrl: string;
  width: number | null;
  height: number | null;
  nlKey: string | null; // asks for another server on retry
  showkey: string | null;
  isLimit: boolean; // the site served the 509 image-limit placeholder
  prevHref: string | null; // neighbouring image pages; the first and last pages link to themselves
  nextHref: string | null;
}

export function isLimitImage(url: string): boolean {
  return /\/509s?\.gif(?:$|[?#])/.test(url);
}

function linkHref(doc: Document, selector: string, base: string | null): string | null {
  const href = doc.querySelector(selector)?.getAttribute("href");
  if (!href) return null;
  try {
    return new URL(href, base ?? undefined).href;
  } catch {
    return null;
  }
}

export function parseImagePage(doc: Document): ImagePage | null {
  const img = doc.querySelector<HTMLImageElement>("img#img");
  const imageUrl = img?.getAttribute("src");
  if (!imageUrl) return null;
  const size = /::\s*(\d+)\s*x\s*(\d+)\s*::/.exec(textOf(doc.querySelector("#i4 > div:first-child")));
  const nl = /nl\('([^']+)'\)/.exec(doc.querySelector("#loadfail")?.getAttribute("onclick") ?? "");
  return {
    imageUrl,
    width: size ? Number(size[1]) : null,
    height: size ? Number(size[2]) : null,
    nlKey: nl ? nl[1]! : null,
    showkey: scriptVar(doc, "showkey"),
    isLimit: isLimitImage(imageUrl),
    prevHref: linkHref(doc, "a#prev", scriptVar(doc, "base_url")),
    nextHref: linkHref(doc, "a#next", scriptVar(doc, "base_url")),
  };
}

// The site's own retry appends one more `nl` parameter to the image page URL each time.
export function retryUrl(imagePageUrl: string, nlKey: string): string {
  const url = new URL(imagePageUrl);
  url.searchParams.append("nl", nlKey);
  return url.href;
}
