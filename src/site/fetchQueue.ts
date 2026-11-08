// Every request to the site goes through one queue: one request at a time, a pause between
// requests, higher priority first. Requests use the browser's normal session; nothing here
// sees or stores cookies.

export interface FetchResult {
  url: string; // after redirects
  text: string;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

export interface FetchQueueOptions {
  gapMs: number;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface RequestOptions {
  priority?: number; // higher runs first, ties in arrival order
  signal?: AbortSignal; // drops the request if it hasn't started, cancels it if it has
}

interface Job {
  url: string;
  priority: number;
  seq: number;
  signal: AbortSignal | undefined;
  resolve: (result: FetchResult) => void;
  reject: (error: unknown) => void;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}

export class FetchQueue {
  readonly #jobs: Job[] = [];
  readonly #gapMs: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  #running = false;
  #lastEnd = -Infinity;
  #seq = 0;

  constructor(options: FetchQueueOptions) {
    this.#gapMs = options.gapMs;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#now = options.now ?? (() => performance.now());
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  get size(): number {
    return this.#jobs.length;
  }

  get(url: string, { priority = 0, signal }: RequestOptions = {}): Promise<FetchResult> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    return new Promise((resolve, reject) => {
      const job: Job = { url, priority, seq: this.#seq++, signal, resolve, reject };
      signal?.addEventListener(
        "abort",
        () => {
          const index = this.#jobs.indexOf(job);
          if (index < 0) return; // already running: fetch itself rejects
          this.#jobs.splice(index, 1);
          reject(abortReason(signal));
        },
        { once: true },
      );
      this.#jobs.push(job);
      void this.#pump();
    });
  }

  #take(): Job | undefined {
    let best = -1;
    this.#jobs.forEach((job, i) => {
      const top = this.#jobs[best];
      if (!top || job.priority > top.priority || (job.priority === top.priority && job.seq < top.seq)) best = i;
    });
    return best < 0 ? undefined : this.#jobs.splice(best, 1)[0];
  }

  async #pump(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      while (this.#jobs.length > 0) {
        const wait = this.#lastEnd + this.#gapMs - this.#now();
        if (wait > 0) await this.#sleep(wait);
        const job = this.#take();
        if (!job) break;
        try {
          const response = await this.#fetch(job.url, { credentials: "same-origin", signal: job.signal });
          if (!response.ok) throw new HttpError(response.status, job.url);
          job.resolve({ url: response.url || job.url, text: await response.text() });
        } catch (error) {
          job.reject(error);
        } finally {
          this.#lastEnd = this.#now();
        }
      }
    } finally {
      this.#running = false;
    }
  }
}
