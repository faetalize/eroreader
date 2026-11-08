// The History tab: galleries (grouped by day, or sorted otherwise) and searches, filters,
// selection and the storage figures.
import { getManyProgress } from "../../background/progressStore";
import { clearHistory, computeStats, deleteEntries, deleteSearches, putSnapshot, removeCovers, takeSnapshot, updateEntries, type HistorySnapshot } from "../../background/historyStore";
import { request } from "../../background/db";
import { QUOTA_WARNING_BYTES, totalBytes, type CoverRecord, type GalleryEntry, type StorageStats } from "../../shared/history";
import { send } from "../../shared/messages";
import { isRereading, type ProgressRecord } from "../../shared/progress";
import { categoriesOff, type SearchEntry } from "../../shared/searches";
import { button, CheckboxGroup, h, iconButton, Segmented, Toasts } from "./dom";
import { icon } from "../../shared/icons";
import { compareRows, dayLabel, EMPTY_FILTER, formatBytes, matches, readState, SITES, SORT_ORDERS, type HistoryFilter, type ReadState, type SortOrder, type SortRow } from "./historyQuery";
import { refreshEntries, RefreshError } from "./refresh";

export const PAGE_SIZE = 50;
export const SEARCH_DELAY_MS = 250; // typing in a filter field reloads once it pauses this long

const CATEGORIES = ["Doujinshi", "Manga", "Artist CG", "Game CG", "Western", "Non-H", "Image Set", "Cosplay", "Asian Porn", "Misc"];
const STATES: [ReadState, string][] = [["any", "All"], ["unread", "Unread"], ["reading", "In progress"], ["finished", "Finished"]];
const TAGS_SHOWN = 8;

type View = "galleries" | "searches";

type Row = SortRow;

export interface HistoryViewDeps {
  db: () => Promise<IDBDatabase>;
  fetch: typeof fetch;
  open: (url: string) => void; // in a new tab
  confirmClear: () => Promise<{ progress: boolean } | null>;
  now?: () => number;
}

function siteName(host: string): string {
  return SITES.find((site) => site.host === host)?.name ?? host;
}

function galleryUrl(entry: GalleryEntry): string {
  return `https://${entry.host}/g/${entry.gid}/${entry.token}/`;
}

function dateValue(input: HTMLInputElement, endOfDay: boolean): number | null {
  if (!input.value) return null;
  const [y, m, d] = input.value.split("-").map(Number);
  return new Date(y!, m! - 1, d! + (endOfDay ? 1 : 0)).getTime();
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export class HistoryView {
  readonly element: HTMLElement;
  readonly #deps: HistoryViewDeps;
  readonly #stats = h("p", { className: "stats" });
  readonly #meter = h("div", { className: "meter", attrs: { role: "meter", "aria-label": "Storage used", "aria-valuemin": "0" } }, h("span"));
  readonly #warning = h("p", { className: "warning", hidden: true });
  readonly #status = h("p", { className: "status", attrs: { role: "status" } });
  readonly #list = h("div", { className: "list" });
  readonly #more = h("div", { className: "more" });
  readonly #selected = new Set<number>();
  readonly #listHeader: HTMLElement;
  readonly #selectAll = h("input", { type: "checkbox", attrs: { "aria-label": "Select all shown" } });
  readonly #shownCount = h("span", { className: "shown-count" });
  readonly #bulk = h("div", { className: "bulk", hidden: true });
  readonly #covers = new Map<number, string>(); // gid → object URL
  readonly #toasts = new Toasts();
  readonly #inputs: Record<"text" | "tag" | "from" | "to", HTMLInputElement>;
  readonly #category: HTMLSelectElement;
  readonly #sites: CheckboxGroup<string>;
  readonly #sort: HTMLSelectElement;
  readonly #state: Segmented<ReadState>;
  readonly #moreFilters: HTMLElement;
  readonly #moreButton: HTMLButtonElement;
  readonly #resetButton: HTMLButtonElement;
  readonly #galleryOnly: HTMLElement[]; // filters that don't apply to searches
  readonly #views: Segmented<View>;
  #view: View = "galleries";
  #rows: Row[] = []; // matching rows found so far, in display order
  #shown = 0;
  #source: AsyncGenerator<Row> | null = null;
  #exhausted = false;
  #progress = new Map<number, ProgressRecord>();
  #observer: IntersectionObserver | null = null;
  #generation = 0;
  #snapshot = ""; // see #readSnapshot()
  #lastDay = ""; // the day heading the list ends with
  #typingTimer: ReturnType<typeof setTimeout> | null = null;
  #loading: { generation: number; promise: Promise<void> } | null = null; // see showMore()

  constructor(deps: HistoryViewDeps) {
    this.#deps = deps;
    // Typed filters reload once typing pauses; the others at once.
    const typed = (type: string, placeholder: string, label: string) =>
      h("input", { type, placeholder, attrs: { "aria-label": label }, on: { input: () => this.#reloadSoon() } });
    const date = (label: string) => h("input", { type: "date", attrs: { "aria-label": label }, on: { change: () => void this.reload() } });
    this.#inputs = { text: typed("search", "Search titles and tags", "Search"), tag: typed("text", "Exact tag, e.g. artist:name", "Tag"), from: date("Visited from"), to: date("Visited until") };
    this.#category = h(
      "select",
      { attrs: { "aria-label": "Category" }, on: { change: () => void this.reload() } },
      ...[["", "Any category"], ...CATEGORIES.map((c) => [c, c])].map(([value, label]) => h("option", { value, text: label })),
    );
    // The controls say what they are, so they have no labels of their own (their accessible
    // names stay).
    this.#sites = new CheckboxGroup("Sites", SITES.map((site) => [site.host, site.name]), () => void this.reload());
    this.#state = new Segmented("Reading state", STATES, () => void this.reload());
    this.#views = new Segmented("View", [["galleries", "Galleries"], ["searches", "Searches"]], (view) => void this.show(view));
    this.#views.element.classList.add("views");
    this.#sort = h(
      "select",
      { attrs: { "aria-label": "Sort galleries" }, title: "Sort galleries", on: { change: () => void this.reload() } },
      ...SORT_ORDERS.map(([value, label]) => h("option", { value, text: label })),
    );
    const sortGroup = h("label", { className: "sort" }, icon("sort"), this.#sort);

    this.#inputs.from.title = "Visited from";
    this.#inputs.to.title = "Visited until";
    this.#moreFilters = h(
      "div",
      { className: "more-filters", hidden: true },
      this.#inputs.tag,
      h("div", { className: "filter dates" }, this.#inputs.from, h("span", { className: "dash", text: "–" }), this.#inputs.to),
    );
    // A toggle: lit while the extra filters are open. Its label counts the ones in use.
    this.#moreButton = iconButton("sliders", "More filters", () => this.#toggleMoreFilters(), { className: "toggle" });
    this.#moreButton.setAttribute("aria-expanded", "false");
    this.#resetButton = iconButton("close", "Clear filters", () => this.resetFilters(), { className: "quiet" });
    const search = h("label", { className: "search-box" }, icon("search"), this.#inputs.text);
    this.#galleryOnly = [this.#state.element, this.#category, this.#moreButton, this.#moreFilters, sortGroup];

    this.#selectAll.addEventListener("change", () => this.#selectAllShown(this.#selectAll.checked));
    this.#listHeader = h("div", { className: "list-header" }, h("label", { className: "select-all" }, this.#selectAll, this.#shownCount), this.#bulk);

    this.element = h(
      "section",
      { className: "history" },
      h(
        "div",
        { className: "summary card" },
        h("div", { className: "usage" }, this.#stats, this.#meter),
        iconButton("trash", "Clear everything…", () => void this.clearAll(), { className: "danger quiet" }),
      ),
      this.#warning,
      h("div", { className: "toolbar" }, this.#views.element, search, sortGroup),
      h(
        "div",
        { className: "filters" },
        this.#sites.element,
        this.#state.element,
        this.#category,
        this.#moreButton,
        this.#resetButton,
      ),
      this.#moreFilters,
      this.#listHeader,
      this.#status,
      this.#list,
      this.#more,
      this.#toasts.element,
    );
    this.#renderSelection();
    this.#renderFilterState();

    if (typeof IntersectionObserver === "function") {
      this.#observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (entry.target === this.#more) void this.showMore();
          else void this.#loadCover(entry.target as HTMLElement);
        }
      }, { rootMargin: "600px 0px" });
      this.#observer.observe(this.#more);
    }
  }

  get view(): View {
    return this.#view;
  }

  // Titles shown, in order, for tests and the selection.
  get shownTitles(): string[] {
    return [...this.#list.querySelectorAll(".entry .title, .search .query")].map((el) => el.textContent ?? "");
  }

  get selected(): number[] {
    return [...this.#selected];
  }

  async start(): Promise<void> {
    await this.show("galleries");
  }

  // Reloads when history changed since the list was read, e.g. galleries opened in other tabs
  // while this one was in the background. An unchanged list keeps its place and selection.
  async refreshIfChanged(): Promise<void> {
    const before = this.#snapshot;
    if ((await this.#readSnapshot()) !== before) await this.reload();
  }

  async show(view: View): Promise<void> {
    this.#view = view;
    this.#views.value = view;
    // Searches only filter by text and site.
    for (const el of this.#galleryOnly) el.classList.toggle("off", view === "searches");
    this.#inputs.text.placeholder = view === "searches" ? "Search searches" : "Search titles and tags";
    await this.reload();
  }

  resetFilters(): void {
    for (const input of Object.values(this.#inputs)) input.value = "";
    this.#category.selectedIndex = 0;
    this.#sites.values = SITES.map((site) => site.host);
    this.#state.value = "any";
    void this.reload();
  }

  filter(): HistoryFilter {
    return {
      ...EMPTY_FILTER,
      text: this.#inputs.text.value,
      tag: this.#inputs.tag.value,
      category: this.#category.value,
      sites: this.#sites.values,
      state: this.#state.value,
      from: dateValue(this.#inputs.from, false),
      to: dateValue(this.#inputs.to, true),
    };
  }

  get sort(): SortOrder {
    return this.#sort.value as SortOrder;
  }

  // For tests: set filter fields or the sort order, and reload.
  async setFilter(patch: Partial<Record<"text" | "tag" | "from" | "to" | "category" | "state", string> & { sites: string[]; sort: SortOrder }>): Promise<void> {
    for (const [name, value] of Object.entries(patch)) {
      if (name === "category") this.#category.value = value as string;
      else if (name === "sites") this.#sites.values = value as string[];
      else if (name === "sort") this.#sort.value = value as string;
      else if (name === "state") this.#state.value = value as ReadState;
      else this.#inputs[name as "text" | "tag" | "from" | "to"].value = value as string;
    }
    await this.reload();
  }

  // Filters by one tag, from a tag chip.
  async filterByTag(tag: string): Promise<void> {
    this.#inputs.tag.value = tag;
    this.#toggleMoreFilters(true);
    await this.reload();
  }

  #emptyText(): string {
    if (!this.#resetButton.hidden) return "No galleries match these filters.";
    return "No galleries yet. Galleries you open on E-Hentai or ExHentai show up here.";
  }

  #reloadSoon(): void {
    if (this.#typingTimer !== null) clearTimeout(this.#typingTimer);
    this.#typingTimer = setTimeout(() => {
      this.#typingTimer = null;
      void this.reload();
    }, SEARCH_DELAY_MS);
  }

  #toggleMoreFilters(open = this.#moreFilters.hidden): void {
    this.#moreFilters.hidden = !open;
    this.#moreButton.setAttribute("aria-expanded", String(open));
  }

  // Marks the filters in use: the "More filters" button counts its own, and "Clear filters"
  // shows only when there's something to clear.
  #renderFilterState(): void {
    const f = this.filter();
    const more = [f.tag.trim(), f.from, f.to].filter(Boolean).length;
    this.#moreButton.lastChild!.textContent = more ? `More filters (${more})` : "More filters";
    const any = more > 0 || f.text.trim() !== "" || f.category !== "" || !this.#sites.allChecked || f.state !== "any";
    this.#resetButton.hidden = !any;
  }

  // Reads the list again from the start, with the storage figures.
  async reload(): Promise<void> {
    const generation = ++this.#generation;
    if (this.#typingTimer !== null) clearTimeout(this.#typingTimer);
    this.#typingTimer = null;
    this.#renderFilterState();
    void this.updateStats();
    void this.#readSnapshot();
    for (const url of this.#covers.values()) URL.revokeObjectURL(url);
    this.#covers.clear();
    this.#selected.clear();
    this.#renderSelection();
    this.#list.replaceChildren();
    this.#rows = [];
    this.#shown = 0;
    this.#lastDay = "";
    this.#exhausted = false;
    this.#progress.clear();
    if (this.#view === "searches") {
      await this.#renderSearches(generation);
      return;
    }
    this.#source = this.sort === "visited" ? this.#byVisit() : this.#sorted(this.sort);
    await this.showMore(generation);
  }

  // The next page of entries, read from the database as the list scrolls.
  // One page at a time: asking again while a page loads (the scroll observer seeing the list's
  // end as it loads) waits for that page instead of reading the same entries alongside it.
  showMore(generation = this.#generation): Promise<void> {
    if (this.#loading?.generation === generation) return this.#loading.promise;
    const promise = this.#loadMore(generation).finally(() => {
      if (this.#loading?.promise === promise) this.#loading = null;
    });
    this.#loading = { generation, promise };
    return promise;
  }

  async #loadMore(generation: number): Promise<void> {
    if (this.#view === "searches" || !this.#source) return;
    const source = this.#source;
    const batch: Row[] = [];
    while (batch.length < PAGE_SIZE) {
      const next = await source.next();
      if (generation !== this.#generation) return;
      if (next.done) {
        this.#exhausted = true;
        break;
      }
      batch.push(next.value);
    }
    this.#rows.push(...batch);
    this.#renderRows(batch);
    this.#more.replaceChildren(this.#exhausted ? (this.#rows.length ? "That's everything." : this.#emptyText()) : button("Show more", () => void this.showMore()));
  }

  async updateStats(): Promise<StorageStats> {
    const stats = await computeStats(await this.#deps.db());
    const total = totalBytes(stats);
    this.#stats.textContent = `${plural(stats.entries, "gallery", "galleries")}, ${formatBytes(stats.entryBytes)} · ${plural(stats.covers, "cover")}, ${formatBytes(stats.coverBytes)} · ${formatBytes(total)} of ${formatBytes(QUOTA_WARNING_BYTES)}`;
    this.#meter.setAttribute("aria-valuemax", String(QUOTA_WARNING_BYTES));
    this.#meter.setAttribute("aria-valuenow", String(total));
    this.#meter.firstElementChild!.setAttribute("style", `width: ${Math.min(100, (total / QUOTA_WARNING_BYTES) * 100)}%`);
    const over = total > QUOTA_WARNING_BYTES;
    this.#meter.classList.toggle("over", over);
    this.#warning.hidden = !over;
    this.#warning.textContent = over
      ? `History uses more than ${formatBytes(QUOTA_WARNING_BYTES)}. Nothing is deleted automatically: sorting galleries largest first shows what takes the most space, and removing covers keeps the entries.`
      : "";
    return stats;
  }

  async clearAll(): Promise<void> {
    const answer = await this.#deps.confirmClear();
    if (!answer) return;
    const db = await this.#deps.db();
    const copy = await takeSnapshot(db, { galleries: "all", covers: "all", searches: "all", ...(answer.progress ? { progress: "all" } : {}) });
    await clearHistory(db, answer);
    this.#offerUndo(answer.progress ? "History and reading progress cleared." : "History cleared.", copy);
    await this.#changed("", true);
  }

  // A toast saying what was deleted, with Undo for a while: it puts the copied records back.
  #offerUndo(message: string, copy: HistorySnapshot): void {
    this.#toasts.show(message, {
      label: "Undo",
      run: async () => {
        await putSnapshot(await this.#deps.db(), copy);
        this.#toasts.show("Undone.");
        await this.#changed("", true);
      },
    });
  }

  // Entries most recently visited first, filtered as they're read.
  async *#byVisit(): AsyncGenerator<Row> {
    const db = await this.#deps.db();
    const filter = this.filter();
    let after: { lastVisit: number; gid: number } | null = null;
    for (;;) {
      const chunk = await this.#readChunk(db, after);
      if (chunk.length === 0) return;
      after = { lastVisit: chunk.at(-1)!.lastVisit, gid: chunk.at(-1)!.gid };
      await this.#loadProgress(db, chunk);
      for (const entry of chunk) if (matches(entry, this.#progress.get(entry.gid), filter)) yield { entry, coverBytes: 0 };
    }
  }

  // Everything matching, in another order than by visit: read whole, then sorted.
  async *#sorted(order: SortOrder): AsyncGenerator<Row> {
    const db = await this.#deps.db();
    const filter = this.filter();
    const tx = db.transaction(["galleries", "covers"]);
    const entries = (await request(tx.objectStore("galleries").getAll())) as GalleryEntry[];
    const covers = (await request(tx.objectStore("covers").getAll())) as CoverRecord[];
    const coverBytes = new Map(covers.map((c) => [c.gid, c.size]));
    await this.#loadProgress(db, entries);
    const rows = entries
      .filter((entry) => matches(entry, this.#progress.get(entry.gid), filter))
      .map((entry) => ({ entry, coverBytes: coverBytes.get(entry.gid) ?? 0 }))
      .sort(compareRows(order));
    yield* rows;
  }

  async #readChunk(db: IDBDatabase, after: { lastVisit: number; gid: number } | null): Promise<GalleryEntry[]> {
    const index = db.transaction("galleries").objectStore("galleries").index("lastVisit");
    const range = after ? IDBKeyRange.upperBound(after.lastVisit) : null;
    const out: GalleryEntry[] = [];
    return new Promise((resolve, reject) => {
      const cursor = index.openCursor(range, "prev");
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c || out.length >= PAGE_SIZE) return resolve(out);
        const entry = c.value as GalleryEntry;
        // Entries visited in the same millisecond come by gid, descending.
        if (!after || entry.lastVisit < after.lastVisit || entry.gid < after.gid) out.push(entry);
        c.continue();
      };
    });
  }

  async #loadProgress(db: IDBDatabase, entries: GalleryEntry[]): Promise<void> {
    const records = await getManyProgress(db, entries.map((e) => e.gid).filter((gid) => !this.#progress.has(gid)));
    for (const record of records) this.#progress.set(record.gid, record);
  }

  #renderRows(rows: Row[]): void {
    const now = this.#deps.now?.() ?? Date.now();
    for (const { entry, coverBytes } of rows) {
      if (this.sort === "visited") {
        const label = dayLabel(entry.lastVisit, now);
        if (label !== this.#lastDay) {
          this.#list.append(h("h3", { className: "day", text: label }));
          this.#lastDay = label;
        }
      }
      this.#list.append(this.#renderEntry(entry, coverBytes));
      this.#shown++;
    }
    this.#renderSelection();
  }

  #renderEntry(entry: GalleryEntry, coverBytes: number): HTMLElement {
    const progress = this.#progress.get(entry.gid);
    const state = readState(progress);
    // The visit's time under its day's heading, else its date and time.
    const time =
      this.sort === "visited"
        ? new Date(entry.lastVisit).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
        : new Date(entry.lastVisit).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    const check = h("input", {
      type: "checkbox",
      checked: this.#selected.has(entry.gid),
      attrs: { "aria-label": `Select ${entry.title}` },
      on: {
        change: () => {
          if (check.checked) this.#selected.add(entry.gid);
          else this.#selected.delete(entry.gid);
          this.#renderSelection();
        },
      },
    });
    // The last page read leads, with the furthest page as a lighter fill when it's further.
    const readingChip = (record: ProgressRecord) => {
      const share = (page: number) => `width: ${Math.round((page / Math.max(1, record.pageCount)) * 100)}%`;
      const title = record.furthest > record.page ? `Last read page ${record.page} of ${record.pageCount}; furthest page ${record.furthest}` : `Read up to page ${record.page} of ${record.pageCount}`;
      return h(
        "span",
        { className: "chip state reading", title },
        `${record.page}/${record.pageCount}`,
        h("span", { className: "bar" }, h("span", { className: "furthest", attrs: { style: share(record.furthest) } }), h("span", { className: "last", attrs: { style: share(record.page) } })),
      );
    };
    const rereading = state === "finished" && isRereading(progress!);
    const stateChip =
      state === "finished"
        ? h("span", { className: "chip state finished" }, icon("check"), "Finished")
        : state === "reading"
          ? readingChip(progress!)
          : h("span", { className: "chip state unread", text: "Unread" });
    const details = [`${entry.pageCount} pages`, siteName(entry.host), this.sort === "visits" ? plural(entry.visits, "visit") : null, time].filter(Boolean).join(" · ");
    const tags: HTMLElement[] = entry.tags.slice(0, TAGS_SHOWN).map((tag) => {
      const [namespace, name] = tag.includes(":") ? [tag.slice(0, tag.indexOf(":") + 1), tag.slice(tag.indexOf(":") + 1)] : ["", tag];
      return h("button", { type: "button", className: "tag", title: `Show only galleries tagged ${tag}`, on: { click: () => void this.filterByTag(tag) } }, namespace ? h("span", { className: "ns", text: namespace }) : null, name);
    });
    if (entry.tags.length > TAGS_SHOWN) tags.push(h("span", { className: "tag extra", title: entry.tags.slice(TAGS_SHOWN).join(", "), text: `+${entry.tags.length - TAGS_SHOWN}` }));
    const cover = h("div", { className: "cover", attrs: { "data-gid": String(entry.gid) } });
    const row = h(
      "article",
      { className: `entry ${state}`, attrs: { "data-gid": String(entry.gid) } },
      check,
      h("a", { className: "cover-link", href: galleryUrl(entry), target: "_blank", rel: "noreferrer", tabIndex: -1 }, cover),
      h(
        "div",
        { className: "info" },
        h("a", { className: "title", text: entry.title || entry.titleJpn || `Gallery ${entry.gid}`, href: galleryUrl(entry), target: "_blank", rel: "noreferrer" }),
        h(
          "div",
          { className: "meta" },
          h("span", { className: "chip category", attrs: { "data-category": entry.category }, text: entry.category || "Unknown" }),
          stateChip,
          rereading ? readingChip(progress!) : null,
          h("span", { className: "details", text: details }),
        ),
        tags.length ? h("div", { className: "tags" }, ...tags) : null,
      ),
      this.sort === "size" ? h("span", { className: "size", text: formatBytes(entry.size + coverBytes) }) : null,
      h(
        "div",
        { className: "actions" },
        iconButton("coverOff", "Remove cover", () => void this.#removeCovers([entry.gid]), { labelHidden: true }),
        iconButton("trash", "Delete", () => void this.#delete([entry.gid]), { labelHidden: true, className: "danger" }),
      ),
    );
    this.#observer?.observe(cover);
    return row;
  }

  async #loadCover(target: HTMLElement): Promise<void> {
    const gid = Number(target.dataset.gid);
    if (this.#covers.has(gid) || target.querySelector("img")) return;
    const record = (await request((await this.#deps.db()).transaction("covers").objectStore("covers").get(gid))) as CoverRecord | undefined;
    if (!record) {
      target.classList.add("none");
      return;
    }
    const url = URL.createObjectURL(record.blob);
    this.#covers.set(gid, url);
    target.append(h("img", { src: url, alt: "" }));
  }

  #shownGids(): number[] {
    return [...this.#list.querySelectorAll<HTMLElement>(".entry")].map((el) => Number(el.dataset.gid));
  }

  #selectAllShown(on: boolean): void {
    for (const gid of this.#shownGids()) {
      if (on) this.#selected.add(gid);
      else this.#selected.delete(gid);
    }
    for (const box of this.#list.querySelectorAll<HTMLInputElement>(".entry input[type=checkbox]")) box.checked = on;
    this.#renderSelection();
  }

  // The list header: how many are shown, the select-all box, and the bulk actions once
  // something is selected.
  #renderSelection(): void {
    const searches = this.#view === "searches";
    this.#listHeader.hidden = searches;
    if (searches) return;
    const shown = this.#shownGids();
    const count = this.#selected.size;
    const selectedShown = shown.filter((gid) => this.#selected.has(gid)).length;
    this.#selectAll.checked = shown.length > 0 && selectedShown === shown.length;
    this.#selectAll.indeterminate = selectedShown > 0 && selectedShown < shown.length;
    this.#selectAll.disabled = shown.length === 0;
    this.#shownCount.textContent = count > 0 ? `${count} selected` : `${plural(shown.length, "gallery", "galleries")} shown${this.#exhausted ? "" : " so far"}`;
    this.#bulk.hidden = count === 0;
    this.#bulk.replaceChildren(
      iconButton("refresh", "Refresh", () => void this.#refresh([...this.#selected])),
      iconButton("coverOff", "Remove covers", () => void this.#removeCovers([...this.#selected])),
      iconButton("trash", "Delete", () => void this.#delete([...this.#selected]), { className: "danger" }),
      iconButton("close", "Clear selection", () => this.#selectAllShown(false), { className: "quiet" }),
    );
  }

  async #removeCovers(gids: number[]): Promise<void> {
    const db = await this.#deps.db();
    const copy = await takeSnapshot(db, { covers: gids });
    await removeCovers(db, gids);
    for (const gid of gids) {
      const url = this.#covers.get(gid);
      if (url) URL.revokeObjectURL(url);
      this.#covers.delete(gid);
      const cover = this.#list.querySelector(`.cover[data-gid="${gid}"]`);
      cover?.replaceChildren();
      cover?.classList.add("none");
    }
    this.#offerUndo(`Removed ${gids.length === 1 ? "the cover" : `${gids.length} covers`}; the ${gids.length === 1 ? "entry stays" : "entries stay"}.`, copy);
    await this.#changed("", false);
  }

  async #delete(gids: number[]): Promise<void> {
    const db = await this.#deps.db();
    const copy = await takeSnapshot(db, { galleries: gids, covers: gids });
    await deleteEntries(db, gids);
    for (const gid of gids) {
      this.#list.querySelector(`.entry[data-gid="${gid}"]`)?.remove();
      this.#selected.delete(gid);
    }
    this.#renderSelection();
    this.#offerUndo(`Deleted ${gids.length === 1 ? "1 entry" : `${gids.length} entries`}. Reading progress is kept.`, copy);
    await this.#changed("", false);
  }

  async #refresh(gids: number[]): Promise<void> {
    const rows = this.#rows.filter((row) => gids.includes(row.entry.gid)).map((row) => row.entry);
    const db = await this.#deps.db();
    this.#status.textContent = `Refreshing ${rows.length}…`;
    try {
      const updated = await refreshEntries(rows, {
        fetch: this.#deps.fetch,
        save: (updates) => updateEntries(db, updates),
        onProgress: (done, total) => (this.#status.textContent = `Refreshing: ${done} of ${total}…`),
      });
      await this.#changed(`Refreshed ${updated} of ${rows.length}.`);
    } catch (error) {
      this.#status.textContent = error instanceof RefreshError ? error.message : "Refreshing failed.";
    }
  }

  async #changed(message: string, reload = true): Promise<void> {
    await send("storageChanged", {}).catch(() => {}); // the toolbar badge
    if (reload) await this.reload();
    // The list is changed in place: what it shows now is the history as it is.
    else await Promise.all([this.updateStats(), this.#readSnapshot()]);
    this.#status.textContent = message;
  }

  // What changes whenever history does: the storage figures and the latest visit.
  async #readSnapshot(): Promise<string> {
    const db = await this.#deps.db();
    const latest = await request(db.transaction("galleries").objectStore("galleries").index("lastVisit").openCursor(null, "prev"));
    const stats = await computeStats(db);
    this.#snapshot = JSON.stringify([stats, latest ? (latest.value as GalleryEntry).lastVisit : 0]);
    return this.#snapshot;
  }

  async #deleteSearches(keys: string[]): Promise<void> {
    const db = await this.#deps.db();
    const copy = await takeSnapshot(db, { searches: keys });
    await deleteSearches(db, keys);
    this.#offerUndo(keys.length === 1 ? "Search deleted." : `Deleted ${plural(keys.length, "search", "searches")}.`, copy);
    await this.#changed("", true);
  }

  async #renderSearches(generation: number): Promise<void> {
    const db = await this.#deps.db();
    const all = ((await request(db.transaction("searches").objectStore("searches").getAll())) as SearchEntry[]).sort((a, b) => b.lastUsed - a.lastUsed);
    if (generation !== this.#generation) return;
    const text = this.#inputs.text.value.trim().toLowerCase();
    const sites = this.#sites.values;
    const shown = all.filter((s) => sites.includes(s.host) && s.query.toLowerCase().includes(text));
    this.#list.replaceChildren(
      ...shown.map((search) => {
        const off = categoriesOff(search.cats);
        const when = new Date(search.lastUsed).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
        const meta = [siteName(search.host), plural(search.uses, "use"), `last ${when}`].join(" · ");
        return h(
          "article",
          { className: "search" },
          h(
            "div",
            { className: "info" },
            h("span", { className: search.query ? "query" : "query empty", text: search.query || "Categories only" }),
            h("div", { className: "meta" }, off ? h("span", { className: "chip", text: `${plural(off, "category", "categories")} off` }) : null, h("span", { className: "details", text: meta })),
          ),
          iconButton("play", "Run again", () => this.#deps.open(search.url), { className: "primary" }),
          h(
            "div",
            { className: "actions" },
            iconButton("trash", "Delete", () => void this.#deleteSearches([search.key]), { labelHidden: true, className: "danger" }),
          ),
        );
      }),
    );
    this.#more.replaceChildren(
      shown.length
        ? iconButton("trash", "Delete all searches shown", () => void this.#deleteSearches(shown.map((s) => s.key)), { className: "danger quiet" })
        : "No searches.",
    );
  }
}
