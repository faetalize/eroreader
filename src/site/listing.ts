// Search and listing pages: front page, searches, tags, favorites and so on.
import { textOf } from "./html";
import { pageKind } from "./url";

export interface ListingCard {
  gid: number;
  token: string;
  url: string;
  title: string;
  pageCount: number | null;
  element: Element; // the result's row or tile
  cover: HTMLImageElement | null;
}

export interface Listing {
  cards: ListingCard[];
  nextUrl: string | null;
}

// Cover images in the Compact/Minimal, Extended and Thumbnail display modes.
// Checked against real pages: Compact (E-Hentai) and Thumbnail (ExHentai, favourites too).
const COVER = ".glthumb img, .gl1e img, .gl3t img";
const GALLERY_LINK = "a[href*='/g/']";

function cardElementOf(link: Element): Element {
  return link.closest("tr, .gl1t") ?? link;
}

// One result row or tile, or null if it holds no gallery link.
export function parseCard(element: Element, base: URL): ListingCard | null {
  const link = element.matches(GALLERY_LINK) ? element : element.querySelector(GALLERY_LINK);
  if (!link) return null;
  const url = new URL(link.getAttribute("href")!, base);
  const page = pageKind(url);
  if (page.kind !== "gallery") return null;
  const pages = /(\d+) pages?\b/.exec(element.textContent ?? "");
  return {
    gid: page.gid,
    token: page.token,
    url: url.href,
    title: textOf(element.querySelector(".glink")) || textOf(link),
    pageCount: pages ? Number(pages[1]) : null,
    element,
    cover: element.querySelector<HTMLImageElement>(COVER),
  };
}

export function parseListing(doc: Document, base: URL): Listing {
  const cards: ListingCard[] = [];
  const seen = new Set<number>();
  for (const link of doc.querySelectorAll(`.itg ${GALLERY_LINK}`)) {
    const card = parseCard(cardElementOf(link), base);
    if (!card || seen.has(card.gid)) continue;
    seen.add(card.gid);
    cards.push(card);
  }
  return { cards, nextUrl: nextUrlOf(doc, base) };
}

export function nextUrlOf(doc: Document, base: URL): string | null {
  const next = doc.querySelector<HTMLAnchorElement>("a#unext[href], a#dnext[href]");
  return next ? new URL(next.getAttribute("href")!, base).href : null;
}
