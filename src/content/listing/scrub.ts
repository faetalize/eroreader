// Scrub preview: moving the mouse sideways across a gallery's cover flips through its pages,
// like scrubbing a video. A fixed number of frames spreads across the whole gallery; they come
// from a few of its thumbnail pages, each fetched only on a deliberate hover.
import { Lru } from "../../shared/lru";
import type { FetchQueue } from "../../site/fetchQueue";
import { thumbsPerPage, type GalleryPage, type Thumb } from "../../site/gallery";
import type { ListingCard } from "../../site/listing";
import { loadGalleryPage } from "../../site/loaders";
import { HOST } from "./badges";

export const SCRUB_DWELL_MS = 300; // hovering this long fetches the first thumbnail page
export const SCRUB_PAUSE_MS = 150; // resting this long on a frame fetches its thumbnail page
export const SCRUB_FRAMES = 20;
export const SCRUB_MAX_SHEETS = 5; // thumbnail pages per gallery, at most
export const SCRUB_CACHE_SIZE = 50; // galleries; the frames' thumbnail URLs only, a few KB each

// One thumbnail page of a gallery, through the shared request queue.
export type ThumbLoader = (card: ListingCard, thumbPage: number, signal: AbortSignal) => Promise<GalleryPage>;

const PRIORITY_SCRUB = 2;

export function createThumbLoader(queue: FetchQueue, origin: string): ThumbLoader {
  return (card, thumbPage, signal) => loadGalleryPage(queue, origin, card.gid, card.token, thumbPage, { priority: PRIORITY_SCRUB, signal });
}

export interface Frame {
  page: number;
  sheet: number; // the thumbnail page holding it
}

// Up to `frames` pages spread across the whole gallery, taken from at most `maxSheets`
// thumbnail pages spread from the first to the last. Short galleries get every page.
export function planFrames(pageCount: number, perPage: number, frames = SCRUB_FRAMES, maxSheets = SCRUB_MAX_SHEETS): Frame[] {
  if (pageCount <= 0 || perPage <= 0) return [];
  const sheetCount = Math.ceil(pageCount / perPage);
  const k = Math.min(sheetCount, maxSheets);
  const sheets = [...new Set(Array.from({ length: k }, (_, j) => (k === 1 ? 0 : Math.round((j * (sheetCount - 1)) / (k - 1)))))];
  const sizes = sheets.map((sheet) => Math.min(pageCount, (sheet + 1) * perPage) - sheet * perPage);
  const total = Math.min(frames, sizes.reduce((a, b) => a + b, 0));
  // An even share each, then whatever a short sheet couldn't take goes to the others.
  const counts = sizes.map(() => 0);
  for (let given = 0; given < total; ) {
    let progressed = false;
    for (let j = 0; j < sheets.length && given < total; j++) {
      if (counts[j]! < sizes[j]!) {
        counts[j]!++;
        given++;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  const out: Frame[] = [];
  sheets.forEach((sheet, j) => {
    const first = sheet * perPage + 1;
    const size = sizes[j]!;
    const want = counts[j]!;
    for (let i = 0; i < want; i++) {
      out.push({ page: want === 1 ? first : first + Math.round((i * (size - 1)) / (want - 1)), sheet });
    }
  });
  return out;
}

// What the mouse moves across, and where the preview shows. In Compact and Minimal mode the
// cover is a popup that vanishes when the mouse moves onto it, so the title row is scrubbed
// and the popup shows the pages.
export function scrubSpots(card: ListingCard): { surface: Element; display: Element } | null {
  const cover = card.cover;
  if (!cover?.parentElement) return null;
  if (cover.closest(".glthumb")) return { surface: card.element, display: cover.parentElement };
  const display = cover.closest(".gl3t") ?? cover.parentElement;
  return { surface: display, display };
}

// Which frame a position across the surface shows: the first at the left edge, the last at the right.
export function thumbIndexAt(fraction: number, count: number): number {
  return Math.min(count - 1, Math.max(0, Math.floor(fraction * count)));
}

interface GalleryFrames {
  pageCount: number;
  frames: Frame[];
  thumbs: Map<number, Thumb>; // by page, for the frames only
  loaded: Set<number>; // thumbnail pages fetched
}

export class ScrubPreview {
  readonly #cache = new Lru<number, GalleryFrames>(SCRUB_CACHE_SIZE);
  readonly #pending = new Map<string, Promise<void>>(); // `${gid}:${sheet}`
  readonly #load: ThumbLoader;
  readonly #dwellMs: number;

  constructor(load: ThumbLoader, dwellMs = SCRUB_DWELL_MS) {
    this.#load = load;
    this.#dwellMs = dwellMs;
  }

  framesOf(gid: number): Frame[] | undefined {
    return this.#cache.get(gid)?.frames;
  }

  attach(card: ListingCard): void {
    const spots = scrubSpots(card);
    if (!spots) return;
    const { surface, display } = spots;
    let fraction = 0;
    let hovering = false;
    let dwell: ReturnType<typeof setTimeout> | null = null;
    let pause: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let overlay: HTMLElement | null = null;

    const show = () => {
      const state = this.#cache.get(card.gid);
      if (!state || state.frames.length === 0 || !hovering) return;
      const frame = state.frames[thumbIndexAt(fraction, state.frames.length)]!;
      const thumb = state.thumbs.get(frame.page) ?? nearestLoaded(state, frame.page);
      if (!thumb) return;
      overlay ??= this.#overlay(display);
      this.#draw(overlay, display, thumb, state.pageCount);
      if (state.loaded.has(frame.sheet)) return;
      // Rest a moment on a frame whose thumbnail page isn't here yet, and it's fetched.
      if (pause !== null) clearTimeout(pause);
      pause = setTimeout(() => {
        pause = null;
        const now = this.#cache.get(card.gid);
        const target = now?.frames[thumbIndexAt(fraction, now.frames.length)];
        if (!hovering || !target || now.loaded.has(target.sheet)) return;
        controller ??= new AbortController();
        this.#sheet(card, target.sheet, controller.signal).then(show, () => {});
      }, SCRUB_PAUSE_MS);
    };
    const leave = () => {
      hovering = false;
      if (dwell !== null) clearTimeout(dwell);
      if (pause !== null) clearTimeout(pause);
      dwell = pause = null;
      controller?.abort(); // drops requests that haven't started yet
      controller = null;
      overlay?.remove();
      overlay = null;
    };

    surface.addEventListener("mouseenter", (event) => {
      hovering = true;
      fraction = this.#fraction(surface, event as MouseEvent);
      if (this.#cache.has(card.gid)) return show();
      dwell = setTimeout(() => {
        dwell = null;
        controller = new AbortController();
        this.#sheet(card, 0, controller.signal).then(show, () => {}); // no preview: the cover stays
      }, this.#dwellMs);
    });
    surface.addEventListener("mousemove", (event) => {
      fraction = this.#fraction(surface, event as MouseEvent);
      if (this.#cache.has(card.gid)) show();
    });
    surface.addEventListener("mouseleave", leave);
  }

  // Fetches one thumbnail page and keeps the thumbnails of the frames on it. The first one
  // also tells the gallery's length and thumbnail page size, which plan the frames.
  #sheet(card: ListingCard, sheet: number, signal: AbortSignal): Promise<void> {
    const key = `${card.gid}:${sheet}`;
    let pending = this.#pending.get(key);
    if (!pending) {
      pending = this.#load(card, sheet, signal).then((page) => {
        let state = this.#cache.get(card.gid);
        if (!state) {
          state = { pageCount: page.pageCount, frames: planFrames(page.pageCount, thumbsPerPage(page)), thumbs: new Map(), loaded: new Set() };
          this.#cache.set(card.gid, state);
        }
        const wanted = new Set(state.frames.filter((frame) => frame.sheet === sheet).map((frame) => frame.page));
        for (const thumb of page.thumbs) if (wanted.has(thumb.page)) state.thumbs.set(thumb.page, thumb);
        state.loaded.add(sheet);
      });
      const settle = () => this.#pending.delete(key);
      pending.then(settle, settle);
      this.#pending.set(key, pending);
    }
    return pending;
  }

  #fraction(surface: Element, event: MouseEvent): number {
    const rect = surface.getBoundingClientRect();
    return rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
  }

  #overlay(display: Element): HTMLElement {
    const doc = display.ownerDocument;
    display.classList.add(HOST);
    const overlay = doc.createElement("div");
    overlay.className = "eroreader-scrub";
    const sprite = doc.createElement("div");
    sprite.className = "eroreader-scrub-sprite";
    const label = doc.createElement("span");
    label.className = "eroreader-scrub-label";
    const bar = doc.createElement("div");
    bar.className = "eroreader-scrub-bar";
    overlay.append(sprite, label, bar);
    display.append(overlay);
    return overlay;
  }

  #draw(overlay: HTMLElement, display: Element, thumb: Thumb, pageCount: number): void {
    const sprite = overlay.querySelector<HTMLElement>(".eroreader-scrub-sprite")!;
    const s = thumb.sprite;
    const box = { width: (display as HTMLElement).clientWidth, height: (display as HTMLElement).clientHeight };
    if (s && s.width > 0 && s.height > 0) {
      const scale = box.width > 0 && box.height > 0 ? Math.min(box.width / s.width, box.height / s.height) : 1;
      sprite.style.width = `${s.width}px`;
      sprite.style.height = `${s.height}px`;
      sprite.style.backgroundImage = `url("${s.url.replace(/["\\\n]/g, encodeURIComponent)}")`;
      sprite.style.backgroundPosition = `${s.x}px ${s.y}px`;
      sprite.style.transform = `scale(${scale})`;
      sprite.style.left = `${Math.round((box.width - s.width * scale) / 2)}px`;
      sprite.style.top = `${Math.round((box.height - s.height * scale) / 2)}px`;
    }
    overlay.querySelector(".eroreader-scrub-label")!.textContent = `${thumb.page} / ${pageCount}`;
    overlay.querySelector<HTMLElement>(".eroreader-scrub-bar")!.style.width = `${(100 * thumb.page) / Math.max(1, pageCount)}%`;
  }
}

// The loaded frame closest to `page`, shown until that page's thumbnail page arrives.
function nearestLoaded(state: GalleryFrames, page: number): Thumb | undefined {
  let best: Thumb | undefined;
  for (const thumb of state.thumbs.values()) {
    if (!best || Math.abs(thumb.page - page) < Math.abs(best.page - page)) best = thumb;
  }
  return best;
}
