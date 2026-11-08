// Gallery page `/g/{gid}/{token}/`, live or fetched (`?p=N` for later thumbnail pages).
import { scriptVar, styleUrl, stylePx, textOf } from "./html";
import { pageKind } from "./url";

// One cell of a thumbnail sprite sheet: draw `url` shifted by (x, y), clipped to width × height.
export interface Sprite {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Thumb {
  page: number; // 1-based
  imgkey: string;
  href: string; // the page's `/s/` URL
  filename: string;
  sprite: Sprite | null;
}

export interface GalleryPage {
  gid: number;
  token: string;
  title: string;
  titleJpn: string;
  category: string;
  pageCount: number;
  coverUrl: string | null;
  tags: string[]; // "namespace:name"
  apiUrl: string | null;
  thumbPage: number; // 0-based index of this thumbnail page
  thumbPageCount: number;
  thumbs: Thumb[];
}

const IMAGE_HREF = /\/s\/([0-9a-f]+)\/(\d+)-(\d+)/;

// The site draws a cell's sprite as its background. Cells the extension redrew hold it as an
// image shifted inside them instead.
function parseSprite(cell: Element): Sprite | null {
  const style = cell.getAttribute("style") ?? "";
  const width = stylePx(style, "width") ?? 0;
  const height = stylePx(style, "height") ?? 0;
  const url = styleUrl(style);
  if (url) {
    const offset = /url\([^)]*\)\s*(-?\d+)(?:px)?\s+(-?\d+)(?:px)?/.exec(style);
    // `|| 0` turns the site's "-0px" into 0.
    return { url, x: offset ? Number(offset[1]) || 0 : 0, y: offset ? Number(offset[2]) || 0 : 0, width, height };
  }
  const img = cell.querySelector(":scope > img[src]");
  if (!img) return null;
  const imgStyle = img.getAttribute("style") ?? "";
  return { url: img.getAttribute("src")!, x: stylePx(imgStyle, "left") || 0, y: stylePx(imgStyle, "top") || 0, width, height };
}

function parseThumb(link: HTMLAnchorElement, base: URL): Thumb | null {
  const href = new URL(link.getAttribute("href")!, base).href;
  const match = IMAGE_HREF.exec(href);
  if (!match) return null;
  const cell = link.querySelector("div[title]");
  const title = cell?.getAttribute("title") ?? "";
  return {
    page: Number(match[3]),
    imgkey: match[1]!,
    href,
    filename: title.replace(/^Page \d+:\s*/, ""),
    sprite: cell ? parseSprite(cell) : null,
  };
}

function thumbPageIndex(link: Element, base: URL): number {
  return Number(new URL(link.getAttribute("href")!, base).searchParams.get("p") ?? 0);
}

function detail(doc: Document, label: string): string {
  for (const row of doc.querySelectorAll("#gdd tr")) {
    if (textOf(row.querySelector(".gdt1")) === label) return textOf(row.querySelector(".gdt2"));
  }
  return "";
}

// The tag as its `/tag/` link names it. The link text can't be trusted: the site appends notes
// to it, such as "japanese | definition revised please read the wiki".
function tagOfLink(link: Element): string {
  const match = /\/tag\/([^?#]+)/.exec(link.getAttribute("href") ?? "");
  if (!match) return textOf(link);
  try {
    return decodeURIComponent(match[1]!.replace(/\+/g, " "));
  } catch {
    return textOf(link);
  }
}

function parseTags(doc: Document): string[] {
  const tags: string[] = [];
  for (const row of doc.querySelectorAll("#taglist tr")) {
    const namespace = textOf(row.querySelector("td.tc")).replace(/:$/, "");
    for (const link of row.querySelectorAll("div[id^='td_'] a")) {
      const tag = tagOfLink(link);
      if (!tag) continue;
      tags.push(tag.includes(":") || !namespace ? tag : `${namespace}:${tag}`);
    }
  }
  return tags;
}

// Returns null when the document isn't a gallery page with thumbnails (content warning, error page).
export function parseGallery(doc: Document, url: URL): GalleryPage | null {
  const page = pageKind(url);
  const grid = doc.querySelector("#gdt");
  if (page.kind !== "gallery" || !grid) return null;

  const thumbs = [...grid.querySelectorAll<HTMLAnchorElement>(":scope > a[href*='/s/']")]
    .map((link) => parseThumb(link, url))
    .filter((thumb) => thumb !== null);

  const pagerLinks = [...doc.querySelectorAll("table.ptt a[href]")];
  const current = doc.querySelector("table.ptt td.ptds a");

  return {
    gid: page.gid,
    token: page.token,
    title: textOf(doc.querySelector("#gn")),
    titleJpn: textOf(doc.querySelector("#gj")),
    category: textOf(doc.querySelector("#gdc .cs")),
    pageCount: parseInt(detail(doc, "Length:"), 10) || thumbs.length,
    coverUrl: styleUrl(doc.querySelector("#gd1 > div")?.getAttribute("style") ?? ""),
    tags: parseTags(doc),
    apiUrl: scriptVar(doc, "api_url"),
    thumbPage: current ? thumbPageIndex(current, url) : Number(url.searchParams.get("p") ?? 0),
    thumbPageCount: Math.max(1, ...pagerLinks.map((link) => thumbPageIndex(link, url) + 1)),
    thumbs,
  };
}

// How many thumbnails a full thumbnail page holds, worked out from any one thumbnail page.
export function thumbsPerPage(gallery: GalleryPage): number {
  const isLast = gallery.thumbPage === gallery.thumbPageCount - 1;
  if (!isLast || gallery.thumbPageCount === 1) return Math.max(1, gallery.thumbs.length);
  return Math.round((gallery.pageCount - gallery.thumbs.length) / (gallery.thumbPageCount - 1));
}

// 0-based thumbnail page holding a 1-based gallery page.
export function thumbPageOf(page: number, perPage: number): number {
  return Math.floor((page - 1) / perPage);
}

export function galleryPageUrl(origin: string, gid: number, token: string, thumbPage: number): URL {
  const url = new URL(`/g/${gid}/${token}/`, origin);
  if (thumbPage > 0) url.searchParams.set("p", String(thumbPage));
  return url;
}

export function isContentWarning(doc: Document): boolean {
  return !doc.querySelector("#gdt") && doc.querySelector("a[href*='nw=session']") !== null;
}
