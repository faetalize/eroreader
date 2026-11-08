// The pages whose images are loaded. Retargeting to a new window loads what's missing and
// releases the rest, so the decoded images can be freed.
import type { PageSource } from "./pageSource";
import { PRIORITY_PRELOAD, PRIORITY_SHOWN } from "./priorities";

export type PageState =
  | { status: "pending" } // waiting for the image page
  | { status: "loading"; img: HTMLImageElement }
  | { status: "loaded"; img: HTMLImageElement }
  | { status: "error" }
  | { status: "limit" };

export const MAX_RETRIES = 2;

interface Entry {
  page: number;
  priority: number;
  controller: AbortController;
  img: HTMLImageElement | null;
  retries: number;
  state: PageState;
}

export interface ImageBufferOptions {
  source: PageSource;
  // `undefined` means the page was released.
  onChange: (page: number, state: PageState | undefined) => void;
  createImage?: () => HTMLImageElement;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export class ImageBuffer {
  readonly #entries = new Map<number, Entry>();
  readonly #source: PageSource;
  readonly #onChange: ImageBufferOptions["onChange"];
  readonly #createImage: () => HTMLImageElement;

  constructor(options: ImageBufferOptions) {
    this.#source = options.source;
    this.#onChange = options.onChange;
    this.#createImage = options.createImage ?? (() => document.createElement("img"));
  }

  state(page: number): PageState | undefined {
    return this.#entries.get(page)?.state;
  }

  pages(): number[] {
    return [...this.#entries.keys()];
  }

  // `order` lists the pages to keep, most important first, starting with the `shown` pages on
  // screen. Preloads share one priority and go out in order, nearest first.
  retarget(order: number[], shown = 1): void {
    const wanted = new Set(order);
    for (const entry of [...this.#entries.values()]) if (!wanted.has(entry.page)) this.#release(entry);
    order.forEach((page, index) => {
      if (this.#entries.has(page)) return;
      const entry: Entry = {
        page,
        priority: index < shown ? PRIORITY_SHOWN : PRIORITY_PRELOAD,
        controller: new AbortController(),
        img: null,
        retries: 0,
        state: { status: "pending" },
      };
      this.#entries.set(page, entry);
      this.#start(entry);
    });
  }

  // Starts a page over after an error, or after the image limit, which this lifts.
  retry(page: number): void {
    const entry = this.#entries.get(page);
    if (!entry || (entry.state.status !== "error" && entry.state.status !== "limit")) return;
    if (entry.state.status === "limit") this.#source.resetLimit();
    entry.retries = 0;
    this.#start(entry);
  }

  clear(): void {
    for (const entry of [...this.#entries.values()]) this.#release(entry);
  }

  #set(entry: Entry, state: PageState): void {
    entry.state = state;
    this.#onChange(entry.page, state);
  }

  #start(entry: Entry): void {
    if (this.#source.limitReached) {
      this.#set(entry, { status: "limit" });
      return;
    }
    this.#set(entry, { status: "pending" });
    this.#source
      .resolve(entry.page, { priority: entry.priority, signal: entry.controller.signal })
      .then((resolved) => {
        if (resolved.isLimit) this.#set(entry, { status: "limit" });
        else this.#load(entry, resolved.imageUrl);
      })
      .catch((error: unknown) => {
        if (!isAbort(error) && this.#entries.get(entry.page) === entry) this.#set(entry, { status: "error" });
      });
  }

  #load(entry: Entry, url: string): void {
    if (this.#entries.get(entry.page) !== entry) return;
    this.#dropImage(entry);
    const img = this.#createImage();
    img.decoding = "async";
    img.alt = `Page ${entry.page}`;
    img.onload = () => this.#set(entry, { status: "loaded", img });
    img.onerror = () => this.#failed(entry);
    entry.img = img;
    img.src = url;
    this.#set(entry, { status: "loading", img });
  }

  #failed(entry: Entry): void {
    if (this.#entries.get(entry.page) !== entry) return;
    this.#dropImage(entry);
    if (entry.retries >= MAX_RETRIES || !this.#source.resolvedNow(entry.page)?.nlKey) {
      this.#set(entry, { status: "error" });
      return;
    }
    entry.retries++;
    this.#set(entry, { status: "pending" });
    this.#source
      .retry(entry.page, { priority: entry.priority, signal: entry.controller.signal })
      .then((resolved) => (resolved.isLimit ? this.#set(entry, { status: "limit" }) : this.#load(entry, resolved.imageUrl)))
      .catch((error: unknown) => {
        if (!isAbort(error) && this.#entries.get(entry.page) === entry) this.#set(entry, { status: "error" });
      });
  }

  #dropImage(entry: Entry): void {
    const img = entry.img;
    if (!img) return;
    img.onload = img.onerror = null;
    img.removeAttribute("src"); // stops the download and lets the decoded image go
    img.remove();
    entry.img = null;
  }

  #release(entry: Entry): void {
    entry.controller.abort();
    this.#dropImage(entry);
    this.#entries.delete(entry.page);
    this.#onChange(entry.page, undefined);
  }
}
