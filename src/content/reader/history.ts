// The reader's place in browser history: opening pushes one entry with `#page=N`, page
// changes replace it, and Back closes the reader.

export function parsePageHash(hash: string): number | null {
  const match = /^#page=(\d+)$/.exec(hash);
  const page = match ? Number(match[1]) : 0;
  return page >= 1 ? page : null;
}

export function withPageHash(url: URL, page: number | null): URL {
  const next = new URL(url);
  next.hash = page === null ? "" : `page=${page}`;
  return next;
}

export interface HistoryLike {
  readonly state: unknown;
  pushState(data: unknown, unused: string, url?: string | URL | null): void;
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
  back(): void;
}

// Marks the entry the reader pushed, so closing can step back to the gallery's own entry.
// Firefox keeps history.state across reloads, so the mark survives a refresh.
const MARK = "eroreaderReader";

// Firefox refuses history calls past a rate limit, so page changes are written at most this often.
export const REPLACE_THROTTLE_MS = 300;

export class ReaderHistory {
  readonly #history: HistoryLike;
  readonly #currentUrl: () => URL;
  #pendingPage: number | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(history: HistoryLike, currentUrl: () => URL) {
    this.#history = history;
    this.#currentUrl = currentUrl;
  }

  // `push` is false when the current entry already holds the page (refresh, Forward).
  opened(page: number, push: boolean): void {
    this.cancel();
    if (push) this.#history.pushState({ [MARK]: true }, "", withPageHash(this.#currentUrl(), page));
  }

  pageChanged(page: number): void {
    this.#pendingPage = page;
    this.#timer ??= setTimeout(() => this.flush(), REPLACE_THROTTLE_MS);
  }

  flush(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    if (this.#pendingPage === null) return;
    const url = withPageHash(this.#currentUrl(), this.#pendingPage);
    this.#pendingPage = null;
    if (url.href !== this.#currentUrl().href) this.#history.replaceState(this.#history.state, "", url);
  }

  // Drops a page change not yet written, e.g. when Back closes the reader: writing it then
  // would put the hash back on the gallery's own entry.
  cancel(): void {
    this.#pendingPage = null;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }

  // Leaves the reader's entry. Returns "back" when that happens through history.back(), whose
  // popstate then closes the reader, or "replaced" when the caller should close right away.
  leave(): "back" | "replaced" {
    this.cancel();
    const state = this.#history.state;
    if (typeof state === "object" && state !== null && (state as Record<string, unknown>)[MARK] === true) {
      this.#history.back();
      return "back";
    }
    this.#history.replaceState(state, "", withPageHash(this.#currentUrl(), null));
    return "replaced";
  }
}
