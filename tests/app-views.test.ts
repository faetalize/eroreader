import "fake-indexeddb/auto"; // IDBKeyRange and friends, which browsers have and happy-dom doesn't
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDb, request, transactionDone } from "../src/background/db";
import { putCover, recordVisit } from "../src/background/historyStore";
import { putProgress } from "../src/background/progressStore";
import { DB_NAME, MIGRATIONS } from "../src/background/schema";
import { recordSearch } from "../src/background/searchStore";
import { HistoryView, PAGE_SIZE, SEARCH_DELAY_MS } from "../src/pages/app/historyView";
import { TOAST_MS } from "../src/pages/app/dom";
import { KeysEditor } from "../src/pages/app/keysEditor";
import { SettingsView } from "../src/pages/app/settingsView";
import { parseCharacter, type Character } from "../src/shared/character";
import { QUOTA_WARNING_BYTES } from "../src/shared/history";
import { emptyProgress } from "../src/shared/progress";
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from "../src/shared/settings";
import type { KeyOverrides } from "../src/content/reader/shortcuts";

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 7, 15).getTime();

const visit = (gid: number, extra: Record<string, unknown> = {}) => ({
  gid, token: "abcdef0123", host: "exhentai.org", title: `Gallery ${gid}`, titleJpn: "", category: "Doujinshi",
  tags: ["language:english"], pageCount: 20, coverUrl: null, ...extra,
});

async function seed(): Promise<IDBDatabase> {
  const db = await openDb(DB_NAME, MIGRATIONS, new IDBFactory());
  await recordVisit(db, visit(1, { title: "Old Manga", category: "Manga" }), NOW - 3 * DAY);
  await recordVisit(db, visit(2, { title: "Yesterday's One", host: "e-hentai.org" }), NOW - DAY);
  await recordVisit(db, visit(3, { title: "Today Finished", tags: ["artist:sample artist"] }), NOW - 1000);
  await recordVisit(db, visit(4, { title: "Today Reading" }), NOW - 500);
  await putCover(db, 1, new Blob(["x".repeat(4000)]), NOW);
  await putProgress(db, { ...emptyProgress({ gid: 3, token: "t", host: "exhentai.org", title: "", pageCount: 20 }), page: 20, finished: true });
  await putProgress(db, { ...emptyProgress({ gid: 4, token: "t", host: "exhentai.org", title: "", pageCount: 20 }), page: 5 });
  await recordSearch(db, { host: "exhentai.org", query: "sample query", cats: 112, url: "https://exhentai.org/?f_search=sample+query&f_cats=112" }, NOW);
  return db;
}

function makeView(db: IDBDatabase, extra: Partial<ConstructorParameters<typeof HistoryView>[0]> = {}) {
  const opened: string[] = [];
  const view = new HistoryView({
    db: async () => db,
    fetch: vi.fn() as unknown as typeof fetch,
    open: (url) => opened.push(url),
    confirmClear: async () => ({ progress: false }),
    now: () => NOW,
    ...extra,
  });
  document.body.append(view.element);
  return { view, opened };
}
const text = (selector: string) => [...document.querySelectorAll(selector)].map((el) => el.textContent);
// A button by its visible label, or by its accessible name when it only shows an icon.
const byLabel = (root: ParentNode, label: string) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent === label || b.getAttribute("aria-label") === label)!;
const click = (label: string) => byLabel(document, label).click();
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("History view", () => {
  it("lists galleries by day, most recent first, with their progress and storage figures", async () => {
    const { view } = makeView(await seed());
    await view.start();
    expect(view.shownTitles).toEqual(["Today Reading", "Today Finished", "Yesterday's One", "Old Manga"]);
    expect(text(".day")).toEqual(["Today", "Yesterday", new Date(NOW - 3 * DAY).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })]);
    expect(text(".entry .meta")[0]).toContain("5/20");
    expect(text(".entry .meta")[1]).toContain("Finished");
    expect(text(".stats")[0]).toMatch(/^4 galleries, .* · 1 cover, 3\.9 KB/);
    expect(document.querySelector<HTMLElement>(".warning")!.hidden).toBe(true);
  });

  it("counts galleries visited since the page opened once the list reloads", async () => {
    const db = await seed();
    const { view } = makeView(db);
    await view.start();
    await recordVisit(db, visit(5, { title: "Opened Meanwhile" }), NOW - 100);
    await putCover(db, 5, new Blob(["x".repeat(2000)]), NOW);
    await view.show("galleries");
    expect(view.shownTitles[0]).toBe("Opened Meanwhile");
    expect(text(".stats")[0]).toMatch(/^5 galleries, .* · 2 covers/);
  });

  it("reloads when history changed since the list was read, and only then", async () => {
    const db = await seed();
    const { view } = makeView(db);
    await view.start();
    await view.setFilter({ text: "today" });
    document.querySelector<HTMLInputElement>(".entry input[type=checkbox]")!.click();
    await view.refreshIfChanged();
    expect(view.selected).toHaveLength(1); // nothing changed: the selection stays
    await recordVisit(db, visit(2, { title: "Yesterday's One" }), NOW - 10);
    await view.refreshIfChanged();
    expect(view.selected).toHaveLength(0);
    expect(view.shownTitles).toEqual(["Today Reading", "Today Finished"]);
  });

  it("reloads after a deletion is undone elsewhere, e.g. by restoring a backup", async () => {
    const db = await seed();
    const { view } = makeView(db);
    await view.start();
    const before = (await request(db.transaction("galleries").objectStore("galleries").get(2))) as Record<string, unknown>;
    byLabel(document.querySelector('.entry[data-gid="2"]')!, "Delete").click();
    await vi.waitFor(() => expect(view.shownTitles).not.toContain("Yesterday's One"));
    // Restored from the Settings tab: the counts are back to what they were before deleting.
    const tx = db.transaction("galleries", "readwrite");
    tx.objectStore("galleries").put(before);
    await transactionDone(tx);
    await view.refreshIfChanged();
    expect(view.shownTitles).toContain("Yesterday's One");
  });

  it("shows the furthest page read beside the last one, and a finished gallery being reread", async () => {
    const db = await seed();
    await putProgress(db, { ...emptyProgress({ gid: 4, token: "t", host: "exhentai.org", title: "", pageCount: 20 }), page: 5, furthest: 15 });
    await putProgress(db, { ...emptyProgress({ gid: 3, token: "t", host: "exhentai.org", title: "", pageCount: 20 }), page: 2, furthest: 20, finished: true });
    const { view } = makeView(db);
    await view.start();
    const chips = (gid: number) => [...document.querySelectorAll(`.entry[data-gid="${gid}"] .chip.state`)].map((c) => [c.textContent, c.getAttribute("title")]);
    expect(chips(4)).toEqual([["5/20", "Last read page 5 of 20; furthest page 15"]]);
    expect(chips(3).map(([text]) => text)).toEqual(["Finished", "2/20"]);
  });

  it("filters by text, tag, site, category, reading state and date", async () => {
    const { view } = makeView(await seed());
    await view.start();
    await view.setFilter({ text: "today" });
    expect(view.shownTitles).toEqual(["Today Reading", "Today Finished"]);
    await view.setFilter({ text: "", tag: "sample artist" });
    expect(view.shownTitles).toEqual(["Today Finished"]);
    await view.setFilter({ tag: "", sites: ["e-hentai.org"] });
    expect(view.shownTitles).toEqual(["Yesterday's One"]);
    await view.setFilter({ sites: ["e-hentai.org", "exhentai.org"], category: "Manga" });
    expect(view.shownTitles).toEqual(["Old Manga"]);
    await view.setFilter({ category: "", state: "unread" });
    expect(view.shownTitles).toEqual(["Yesterday's One", "Old Manga"]);
    const day = new Date(NOW - DAY);
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    await view.setFilter({ state: "any", from: iso, to: iso });
    expect(view.shownTitles).toEqual(["Yesterday's One"]);
  });

  it("waits for typing to pause before searching", async () => {
    const { view } = makeView(await seed());
    await view.start();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const reload = vi.spyOn(view, "reload");
      const box = document.querySelector<HTMLInputElement>('input[type="search"]')!;
      for (const typed of ["t", "to", "tod"]) {
        box.value = typed;
        box.dispatchEvent(new Event("input"));
        vi.advanceTimersByTime(SEARCH_DELAY_MS - 50);
      }
      expect(reload).not.toHaveBeenCalled();
      vi.advanceTimersByTime(50);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
    await vi.waitFor(() => expect(view.shownTitles).toEqual(["Today Reading", "Today Finished"]));
  });

  it("filters by a tag from its chip, and offers to clear the filters only while some are on", async () => {
    const { view } = makeView(await seed());
    await view.start();
    const reset = byLabel(document, "Clear filters");
    expect(reset.hidden).toBe(true);
    const chip = [...document.querySelectorAll<HTMLButtonElement>('.entry[data-gid="3"] .tag')].find((t) => t.textContent === "artist:sample artist")!;
    chip.click();
    await vi.waitFor(() => expect(view.shownTitles).toEqual(["Today Finished"]));
    expect(document.querySelector<HTMLElement>(".more-filters")!.hidden).toBe(false);
    expect(byLabel(document, "More filters (1)")).toBeDefined();
    expect(reset.hidden).toBe(false);
    reset.click();
    await vi.waitFor(() => expect(view.shownTitles).toHaveLength(4));
    expect(reset.hidden).toBe(true);
  });

  it("reads entries a page at a time", async () => {
    const db = await openDb(DB_NAME, MIGRATIONS, new IDBFactory());
    for (let gid = 1; gid <= PAGE_SIZE + 10; gid++) await recordVisit(db, visit(gid), NOW - gid * 1000);
    const { view } = makeView(db);
    await view.start();
    expect(view.shownTitles).toHaveLength(PAGE_SIZE);
    await view.showMore();
    expect(view.shownTitles).toHaveLength(PAGE_SIZE + 10);
    expect(text(".more")[0]).toBe("That's everything.");
  });

  it("keeps the order when the next page is asked for while one is still loading", async () => {
    const { view } = makeView(await seed());
    // The list's end in view as it loads, the way the scroll observer sees it on a short list.
    await Promise.all([view.reload(), view.showMore()]);
    expect(view.shownTitles).toEqual(["Today Reading", "Today Finished", "Yesterday's One", "Old Manga"]);
    expect(text(".day")).toHaveLength(3);
  });

  it("keeps entries visited in the same millisecond across pages", async () => {
    const db = await openDb(DB_NAME, MIGRATIONS, new IDBFactory());
    for (let gid = 1; gid <= PAGE_SIZE + 5; gid++) await recordVisit(db, visit(gid), NOW);
    const { view } = makeView(db);
    await view.start();
    await view.showMore();
    expect(new Set(view.shownTitles).size).toBe(PAGE_SIZE + 5);
  });

  it("has two views, galleries and searches, and sorts galleries instead of a size view", async () => {
    const { view } = makeView(await seed());
    await view.start();
    expect(text('[aria-label="View"] button')).toEqual(["Galleries", "Searches"]);
    const sort = document.querySelector<HTMLSelectElement>('select[aria-label="Sort galleries"]')!;
    expect([...sort.options].map((o) => o.textContent)).toEqual(["Recently visited", "Title, A to Z", "Largest first", "Most pages first", "Most visited first"]);
    sort.value = "size";
    sort.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(view.shownTitles[0]).toBe("Old Manga")); // it has the cover
    // Sorted otherwise than by visit, no day headings: each entry says its visit's date.
    expect(document.querySelectorAll(".day")).toHaveLength(0);
    expect(document.querySelectorAll(".entry .size")).toHaveLength(4);
    expect(text(".entry .details")[0]).toMatch(/2026/);
    await view.setFilter({ sort: "title" });
    expect(view.shownTitles).toEqual(["Old Manga", "Today Finished", "Today Reading", "Yesterday's One"]);
    expect(document.querySelectorAll(".entry .size")).toHaveLength(0);
    await view.setFilter({ sort: "visited" });
    expect(text(".day")).toEqual(["Today", "Yesterday", expect.any(String)]);
    // Searches have no sort.
    await view.show("searches");
    expect(sort.closest(".sort")!.classList.contains("off")).toBe(true);
  });

  it("filters by site with a checkbox each and one for all of them", async () => {
    const { view } = makeView(await seed());
    await view.start();
    const box = (name: string) => [...document.querySelectorAll<HTMLLabelElement>('[aria-label="Sites"] label')].find((l) => l.textContent === name)!.querySelector("input")!;
    const toggle = (name: string) => {
      box(name).checked = !box(name).checked;
      box(name).dispatchEvent(new Event("change"));
    };
    expect([box("All").checked, box("E-Hentai").checked, box("ExHentai").checked]).toEqual([true, true, true]);
    toggle("ExHentai");
    await vi.waitFor(() => expect([view.shownTitles, document.querySelector(".more")!.textContent]).toEqual([["Yesterday's One"], "That's everything."]));
    expect([box("All").checked, box("All").indeterminate]).toEqual([false, true]);
    expect(byLabel(document, "Clear filters").hidden).toBe(false);
    toggle("All"); // checks them all
    await vi.waitFor(() => expect(view.shownTitles).toHaveLength(4));
    expect([box("ExHentai").checked, box("All").indeterminate]).toEqual([true, false]);
    toggle("All"); // and clears them all
    await vi.waitFor(() => expect(document.querySelector(".more")!.textContent).toBe("No galleries match these filters."));
    expect(view.shownTitles).toEqual([]);
    view.resetFilters();
    await vi.waitFor(() => expect(view.shownTitles).toHaveLength(4));
    expect(box("All").checked).toBe(true);
  });

  it("labels no filter whose control already says what it is", async () => {
    const { view } = makeView(await seed());
    await view.start();
    const words = [...document.querySelectorAll(".filters span, .filters label, .more-filters span, .more-filters label")].map((el) => el.firstChild?.textContent?.trim());
    for (const label of ["Site", "Reading", "Visited", "Tag"]) expect(words).not.toContain(label);
    // Their names stay for assistive technology.
    expect(document.querySelector('[aria-label="Reading state"]')).not.toBeNull();
    expect(document.querySelector('input[aria-label="Visited from"]')!.getAttribute("title")).toBe("Visited from");
  });

  it("removes a cover but keeps the entry, or deletes the entry", async () => {
    const db = await seed();
    const { view } = makeView(db);
    await view.start();
    const row = (gid: number) => document.querySelector(`.entry[data-gid="${gid}"]`)!;
    byLabel(row(1), "Remove cover").click();
    await vi.waitFor(async () => expect(await request(db.transaction("covers").objectStore("covers").count())).toBe(0));
    expect(view.shownTitles).toContain("Old Manga");
    byLabel(row(2), "Delete").click();
    await vi.waitFor(() => expect(view.shownTitles).not.toContain("Yesterday's One"));
    expect(text(".toast-text").at(-1)).toBe("Deleted 1 entry. Reading progress is kept.");
  });

  it("undoes a deletion from its toast, cover included", async () => {
    const db = await seed();
    const { view } = makeView(db);
    await view.start();
    byLabel(document.querySelector('.entry[data-gid="1"]')!, "Delete").click();
    await vi.waitFor(() => expect(view.shownTitles).not.toContain("Old Manga"), { timeout: 4000 });
    expect(await request(db.transaction("covers").objectStore("covers").count())).toBe(0);
    click("Undo");
    // Undo goes through the database and a reload, which can take a while under a busy suite.
    await vi.waitFor(() => expect(view.shownTitles).toContain("Old Manga"), { timeout: 4000 });
    expect(await request(db.transaction("covers").objectStore("covers").count())).toBe(1);
    expect(text(".toast-text").at(-1)).toBe("Undone.");
  });

  it("undoes clearing everything, reading progress included", async () => {
    const db = await seed();
    const { view } = makeView(db, { confirmClear: async () => ({ progress: true }) });
    await view.start();
    await view.clearAll();
    expect(view.shownTitles).toEqual([]);
    expect(text(".toast-text").at(-1)).toBe("History and reading progress cleared.");
    click("Undo");
    await vi.waitFor(() => expect(view.shownTitles).toHaveLength(4));
    expect(await request(db.transaction("progress").objectStore("progress").count())).toBe(2);
    expect(await request(db.transaction("searches").objectStore("searches").count())).toBe(1);
  });

  it("lets the undo go after ten seconds", async () => {
    const { view } = makeView(await seed());
    await view.start();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      byLabel(document.querySelector('.entry[data-gid="2"]')!, "Remove cover").click();
      await vi.waitFor(() => expect(text(".toast-text")).toHaveLength(1));
      vi.advanceTimersByTime(TOAST_MS);
      expect(document.querySelector(".toast")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("selects entries and deletes them together", async () => {
    const { view } = makeView(await seed());
    await view.start();
    const all = document.querySelector<HTMLInputElement>('input[aria-label="Select all shown"]')!;
    all.click();
    expect(view.selected.sort()).toEqual([1, 2, 3, 4]);
    expect(text(".select-all")[0]).toBe("4 selected");
    document.querySelector<HTMLInputElement>('.entry[data-gid="2"] input[type=checkbox]')!.click();
    expect(all.indeterminate).toBe(true);
    all.click();
    [...document.querySelectorAll(".bulk button")].find((b) => b.textContent === "Delete")!.dispatchEvent(new MouseEvent("click"));
    await vi.waitFor(() => expect(view.shownTitles).toEqual([]));
  });

  it("refreshes selected entries through the API and shows the new details", async () => {
    const db = await seed();
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      const { gidlist } = JSON.parse(String(init.body)) as { gidlist: [number, string][] };
      return new Response(JSON.stringify({ gmetadata: gidlist.map(([gid]) => ({ gid, title: `Refreshed ${gid}`, category: "Manga", filecount: "9", tags: [] })) }));
    });
    const { view } = makeView(db, { fetch: fetchFn as unknown as typeof fetch });
    await view.start();
    document.querySelector<HTMLInputElement>('.entry[data-gid="4"] input[type=checkbox]')!.click();
    click("Refresh");
    await vi.waitFor(() => expect(view.shownTitles).toContain("Refreshed 4"));
    expect(text(".status")[0]).toBe("Refreshed 1 of 1.");
  });

  it("clears everything after asking", async () => {
    const db = await seed();
    const confirmClear = vi.fn(async () => ({ progress: true }));
    const { view } = makeView(db, { confirmClear });
    await view.start();
    await view.clearAll();
    expect(view.shownTitles).toEqual([]);
    expect(await request(db.transaction("progress").objectStore("progress").count())).toBe(0);
  });

  it("does nothing when clearing is cancelled", async () => {
    const { view } = makeView(await seed(), { confirmClear: async () => null });
    await view.start();
    await view.clearAll();
    expect(view.shownTitles).toHaveLength(4);
  });

  it("lists searches, runs one again and deletes one", async () => {
    const { view, opened } = makeView(await seed());
    await view.start();
    await view.show("searches");
    expect(view.shownTitles).toEqual(["sample query"]);
    expect(text(".search .meta")[0]).toContain("3 categories off");
    click("Run again");
    expect(opened).toEqual(["https://exhentai.org/?f_search=sample+query&f_cats=112"]);
    byLabel(document.querySelector(".search")!, "Delete").click();
    await vi.waitFor(() => expect(view.shownTitles).toEqual([]));
  });

  it("warns past the storage mark", async () => {
    const db = await seed();
    const tx = db.transaction("covers", "readwrite");
    tx.objectStore("covers").put({ gid: 2, blob: new Blob(["x"]), size: QUOTA_WARNING_BYTES, savedAt: 1 });
    await transactionDone(tx);
    const { view } = makeView(db);
    await view.start();
    expect(document.querySelector<HTMLElement>(".warning")!.hidden).toBe(false);
    expect(text(".warning")[0]).toContain("Nothing is deleted automatically");
  });
});

describe("Settings view", () => {
  function setup(initial: Partial<Settings> = {}) {
    let settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...initial });
    const patches: Partial<Settings>[] = [];
    const view = new SettingsView({
      get: () => settings,
      save: async (patch) => {
        patches.push(patch);
        settings = normalizeSettings({ ...settings, ...patch });
      },
    });
    document.body.append(view.element);
    const field = (name: string) => view.element.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    const change = async (input: HTMLInputElement, value?: string) => {
      if (value !== undefined) input.value = value;
      input.dispatchEvent(new Event("change"));
      await settle();
    };
    return { view, patches, field, change, settings: () => settings };
  }

  describe("character", () => {
    function withCharacter(initial: Character | null = null) {
      let character = initial;
      const view = new SettingsView({
        get: () => DEFAULT_SETTINGS,
        save: async () => {},
        character: {
          current: () => character,
          load: async (file) => {
            character = parseCharacter(await file.text(), file.name.replace(/\.json$/i, ""));
          },
          remove: async () => {
            character = null;
          },
        },
      });
      document.body.append(view.element);
      const input = view.element.querySelector<HTMLInputElement>('input[type="file"][accept^=".json"]')!;
      const choose = async (name: string, text: string) => {
        Object.defineProperty(input, "files", { value: [new File([text], name)], configurable: true });
        input.dispatchEvent(new Event("change"));
        await vi.waitFor(() => expect(document.querySelector(".character-name")!.textContent !== "" || document.querySelector(".character-status")!.textContent !== "").toBe(true));
        await settle();
      };
      return { view, choose, name: () => document.querySelector(".character-name")!.textContent, status: () => document.querySelector(".character-status")!.textContent, current: () => character };
    }

    it("has none by default, and loads one from a file", async () => {
      const { choose, name, status, current } = withCharacter();
      expect([name(), byLabel(document, "Remove").hidden]).toEqual(["None", true]);
      await choose("Narrator.json", JSON.stringify({ pill: "{speed}×", events: { start: ["Here we go."] } }));
      await vi.waitFor(() => expect(name()).toBe("Narrator"));
      expect([status(), byLabel(document, "Remove").hidden, current()?.messages.events.start]).toEqual(["", false, ["Here we go."]]);
    });

    it("says what's wrong with a file that isn't a character, keeping the one loaded", async () => {
      const { choose, name, status } = withCharacter({ name: "Narrator", messages: { pill: "", events: { start: ["Hi."] }, rare: {} } });
      await choose("notes.json", "not json");
      await vi.waitFor(() => expect(status()).toBe("That file isn't a character file."));
      expect(name()).toBe("Narrator");
    });

    it("removes it", async () => {
      const { name, current } = withCharacter({ name: "Narrator", messages: { pill: "", events: { start: ["Hi."] }, rare: {} } });
      byLabel(document, "Remove").click();
      await vi.waitFor(() => expect(name()).toBe("None"));
      expect(current()).toBeNull();
    });
  });

  it("shows the stored settings", () => {
    const { field } = setup({ preloadAhead: 5, recordingPaused: true, filmstripVertical: true, hoverZoom: true, hoverSize: { filmstrip: { by: "offset", scale: 3, offset: 140, width: 300 }, grid: { by: "scale", scale: 2, offset: 100, width: 300 } } });
    expect(field("preloadAhead").value).toBe("5");
    expect(field("recordingPaused").checked).toBe(true);
    expect(document.querySelector('[aria-label="Filmstrip position"] [data-value="left"]')!.getAttribute("aria-checked")).toBe("true");
    expect(field("hoverZoom").checked).toBe(true);
    // A custom amount counts for the filmstrip; the multiplier for the grid.
    expect([field("filmstripHoverOffset").value, field("filmstripHoverScale").value]).toEqual(["140", "3"]);
    expect(document.querySelector('[aria-label="Filmstrip hover size"] .hs-line.offset')!.classList.contains("hs-off")).toBe(false);
    expect(document.querySelector('[aria-label="Grid hover size"] .hs-line.offset')!.classList.contains("hs-off")).toBe(true);
  });

  it("shows the hover sizes only while hover zoom is on, labelled Hover", async () => {
    const { field, change } = setup({ hoverZoom: true });
    const rows = () => [...document.querySelectorAll<HTMLElement>(".hover-size")].map((c) => c.closest<HTMLElement>(".row")!);
    expect(rows().map((r) => r.querySelector(".row-label")!.textContent)).toEqual(["Filmstrip hover", "Grid hover"]);
    field("hoverZoom").checked = false;
    await change(field("hoverZoom"));
    expect(rows().map((r) => r.hidden)).toEqual([true, true]);
  });

  it("shows and saves hands-free's starting paces, within what the pill reaches", async () => {
    const { field, change, settings } = setup({ autoDefaultPace: { page: 3, strip: 1.25 } });
    expect([field("pageDefault").value, field("stripDefault").value]).toEqual(["3", "1.25"]);
    await change(field("pageDefault"), "4.5");
    await change(field("stripDefault"), "9");
    expect(settings().autoDefaultPace).toEqual({ page: 4.5, strip: 4 });
    expect(field("stripDefault").value).toBe("4");
  });

  it("saves changes, keeping preloading within the cap", async () => {
    const { field, change, settings } = setup();
    await change(field("preloadAhead"), "7");
    await change(field("preloadBehind"), "5");
    expect([settings().preloadAhead, settings().preloadBehind]).toEqual([7, 1]);
    expect(field("preloadBehind").value).toBe("1");
    await change(field("recordingPaused"), undefined);
    field("recordingPaused").checked = true;
    await change(field("recordingPaused"));
    expect(settings().recordingPaused).toBe(true);
    document.querySelector<HTMLButtonElement>('[aria-label="Filmstrip position"] [data-value="left"]')!.click();
    await settle();
    expect(settings().filmstripVertical).toBe(true);
    await change(field("gridWidth"), "200");
    expect(settings().thumbWidth).toEqual({ filmstrip: 80, grid: 200 });
  });

  it("pins the reader's toolbar, and steps the preload counts", async () => {
    const { field, change, settings } = setup();
    field("toolbarPinned").checked = true;
    await change(field("toolbarPinned"));
    expect(settings().toolbarPinned).toBe(true);
    click("More: Pages to preload ahead");
    await settle();
    expect(settings().preloadAhead).toBe(DEFAULT_SETTINGS.preloadAhead + 1);
    click("Fewer: Pages to preload behind");
    await settle();
    expect(settings().preloadBehind).toBe(DEFAULT_SETTINGS.preloadBehind - 1);
  });

  it("saves a backup and restores a chosen file, saying what happened", async () => {
    const restored: File[] = [];
    let answer: string | null = "Restored. Galleries: 2 added";
    const view = new SettingsView({
      get: () => DEFAULT_SETTINGS,
      save: async () => {},
      backup: { save: async () => "Saved a backup with 2 galleries.", restore: async (file) => (restored.push(file), answer) },
    });
    document.body.append(view.element);
    const status = () => view.element.querySelector(".backup-status")!.textContent;
    click("Save backup…");
    await vi.waitFor(() => expect(status()).toBe("Saved a backup with 2 galleries."));
    const input = view.element.querySelector<HTMLInputElement>('input[type="file"]')!;
    const choose = (file: File) => {
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new Event("change"));
    };
    choose(new File(["{}"], "backup.json"));
    await vi.waitFor(() => expect(status()).toBe("Restored. Galleries: 2 added"));
    expect(restored.map((f) => f.name)).toEqual(["backup.json"]);
    answer = null; // cancelled
    choose(new File(["{}"], "other.json"));
    await vi.waitFor(() => expect(status()).toBe(""));
  });

  it("puts the auto pill back in its default place", async () => {
    const { settings } = setup({ autoZone: { x: 0.2, y: 0.3 } });
    click("Put it back in its default place");
    await settle();
    expect(settings().autoZone).toBeNull();
  });
});

describe("Shortcut editor", () => {
  function setup(initial: KeyOverrides = {}) {
    let overrides = initial;
    const editor = new KeysEditor({ get: () => overrides, save: async (next) => void (overrides = next) });
    document.body.append(editor.element);
    const row = (id: string) => editor.element.querySelector(`tr[data-action="${id}"]`)!;
    const keys = (id: string) => [...row(id).querySelectorAll("kbd")].map((k) => k.textContent);
    const message = () => editor.element.querySelector(".key-message")!.textContent;
    return { editor, row, keys, message, overrides: () => overrides };
  }

  it("adds a key by pressing it", async () => {
    const { editor, keys, message } = setup();
    editor.capture("fit");
    await editor.press({ key: "X", ctrlKey: false, altKey: false, metaKey: false });
    expect(keys("fit")).toEqual(["F", "X"]);
    expect(message()).toBe('X now runs "Fit to viewport".');
  });

  it("waits for a real key after a lone modifier, and refuses Ctrl, Alt or Meta combinations", async () => {
    const { editor, keys, message } = setup();
    editor.capture("fit");
    await editor.press({ key: "Shift", ctrlKey: false, altKey: false, metaKey: false });
    expect(editor.capturing).toBe("fit");
    await editor.press({ key: "s", ctrlKey: true, altKey: false, metaKey: false });
    expect(message()).toContain("Ctrl, Alt or Meta");
    expect(keys("fit")).toEqual(["F"]);
  });

  it("offers to move a key another action has", async () => {
    const { editor, keys, message } = setup();
    editor.capture("filmstrip");
    await editor.press({ key: "g", ctrlKey: false, altKey: false, metaKey: false });
    expect(message()).toContain('G is used by "Grid of all pages".');
    expect(keys("filmstrip")).toEqual(["T"]);
    await editor.confirmMove();
    expect(keys("filmstrip")).toEqual(["T", "G"]);
    expect(keys("grid")).toEqual([]);
    expect(editor.element.querySelector('tr[data-action="grid"] .none')!.textContent).toBe("No key");
  });

  it("removes keys and resets one action or all", async () => {
    const { editor, row, keys, overrides } = setup();
    [...row("zoomIn").querySelectorAll<HTMLButtonElement>(".remove")][1]!.click();
    await settle();
    expect(keys("zoomIn")).toEqual(["+"]);
    [...row("zoomIn").querySelectorAll("button")].find((b) => b.textContent === "Reset")!.click();
    await settle();
    expect(keys("zoomIn")).toEqual(["+", "="]);
    editor.capture("fit");
    await editor.press({ key: "x", ctrlKey: false, altKey: false, metaKey: false });
    click("Reset all shortcuts");
    await settle();
    expect(overrides()).toEqual({});
  });

  it("lets hands-free keys share keys with the reader's", async () => {
    const { editor, keys } = setup();
    editor.capture("autoStop");
    await editor.press({ key: "q", ctrlKey: false, altKey: false, metaKey: false });
    expect(keys("autoStop")).toEqual(["Esc", "Q"]);
    editor.capture("autoStop");
    await editor.press({ key: "f", ctrlKey: false, altKey: false, metaKey: false }); // F is the reader's Fit
    expect(keys("autoStop")).toEqual(["Esc", "Q", "F"]);
  });
});
