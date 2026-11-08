// Recent searches under the site's search box: shown on focus, narrowed as you type.
import { categoriesOff, type SearchEntry } from "../../shared/searches";

export const DROPDOWN_SIZE = 8;

export function matchSearches(entries: SearchEntry[], typed: string, limit = DROPDOWN_SIZE): SearchEntry[] {
  const needle = typed.trim().toLowerCase();
  return entries.filter((entry) => entry.query.toLowerCase().includes(needle)).slice(0, limit);
}

export interface SearchDropdownDeps {
  input: HTMLInputElement;
  dark?: boolean; // ExHentai's dark theme
  recent: () => Promise<SearchEntry[]>; // most recent first
  go: (url: string) => void;
}

export class SearchDropdown {
  readonly element: HTMLDivElement;
  readonly #deps: SearchDropdownDeps;
  #entries: SearchEntry[] | null = null;
  #shown: SearchEntry[] = [];
  #active = -1;

  constructor(deps: SearchDropdownDeps) {
    this.#deps = deps;
    const doc = deps.input.ownerDocument;
    this.element = doc.createElement("div");
    this.element.className = deps.dark ? "eroreader-searches dark" : "eroreader-searches";
    this.element.hidden = true;
    this.element.setAttribute("role", "listbox");
    doc.body.append(this.element);
    const input = deps.input;
    input.setAttribute("autocomplete", "off");
    input.addEventListener("focus", () => void this.open());
    input.addEventListener("input", () => void this.open());
    input.addEventListener("blur", () => this.close());
    input.addEventListener("keydown", (event) => this.#onKey(event));
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  get items(): string[] {
    return this.#shown.map((entry) => entry.query);
  }

  async open(): Promise<void> {
    this.#entries ??= await this.#deps.recent().catch(() => []);
    this.#shown = matchSearches(this.#entries, this.#deps.input.value);
    this.#active = -1;
    this.#render();
  }

  close(): void {
    this.element.hidden = true;
    this.#active = -1;
  }

  #render(): void {
    const doc = this.element.ownerDocument;
    if (this.#shown.length === 0) {
      this.close();
      return;
    }
    this.element.replaceChildren(
      ...this.#shown.map((entry, i) => {
        const item = doc.createElement("div");
        item.className = i === this.#active ? "item active" : "item";
        item.setAttribute("role", "option");
        const query = doc.createElement("span");
        query.className = "query";
        query.textContent = entry.query || "(categories only)";
        item.append(query);
        const off = categoriesOff(entry.cats);
        if (off > 0) {
          const note = doc.createElement("span");
          note.className = "note";
          note.textContent = `${off} ${off === 1 ? "category" : "categories"} off`;
          item.append(note);
        }
        // mousedown, so it fires before the input's blur closes the list
        item.addEventListener("mousedown", (event) => {
          event.preventDefault();
          this.#deps.go(entry.url);
        });
        return item;
      }),
    );
    const rect = this.#deps.input.getBoundingClientRect();
    const win = doc.defaultView;
    this.element.style.left = `${rect.left + (win?.scrollX ?? 0)}px`;
    this.element.style.top = `${rect.bottom + (win?.scrollY ?? 0) + 2}px`;
    this.element.style.minWidth = `${rect.width}px`;
    this.element.hidden = false;
  }

  #onKey(event: KeyboardEvent): void {
    if (!this.isOpen) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      // Cycles through no selection (-1) and each item.
      let next = this.#active + (event.key === "ArrowDown" ? 1 : -1);
      if (next >= this.#shown.length) next = -1;
      if (next < -1) next = this.#shown.length - 1;
      this.#active = next;
      this.#render();
    } else if (event.key === "Enter" && this.#active >= 0) {
      event.preventDefault();
      this.#deps.go(this.#shown[this.#active]!.url);
    } else if (event.key === "Escape") {
      this.close();
    }
  }
}
