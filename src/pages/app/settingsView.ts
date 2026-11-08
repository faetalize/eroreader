// The Settings tab: everything that doesn't belong to one gallery.
import { HoverSizeControl } from "../../shared/hoverSizeControl";
import { PAGE_SECONDS_RANGE, STRIP_SPEED_RANGE } from "../../content/reader/auto/speed";
import { CharacterError, type Character } from "../../shared/character";
import { gridSizeText, PRELOAD_CAP, THUMB_WIDTH_RANGE, type Settings, type ThumbView } from "../../shared/settings";
import { button, h, Segmented } from "./dom";
import { KeysEditor } from "./keysEditor";

export interface SettingsViewDeps {
  get: () => Settings;
  save: (patch: Partial<Settings>) => Promise<void>;
  // Each returns what happened, to show; restoring returns null when cancelled.
  backup?: { save: () => Promise<string>; restore: (file: File) => Promise<string | null> };
  // The optional character for hands-free mode. `load` throws a CharacterError for a file that
  // isn't one.
  character?: { current: () => Character | null; load: (file: File) => Promise<void>; remove: () => Promise<void> };
}

export class SettingsView {
  readonly element: HTMLElement;
  readonly keys: KeysEditor;
  readonly #deps: SettingsViewDeps;
  readonly #fields: Record<string, HTMLInputElement> = {};
  readonly #notes: Record<string, HTMLElement> = {};
  #gridReset: HTMLButtonElement | null = null;
  readonly #position: Segmented<"bottom" | "left">;
  readonly #hover: Record<ThumbView, { control: HoverSizeControl; row: HTMLElement }>;
  #character: { name: HTMLElement; remove: HTMLButtonElement } | null = null;

  constructor(deps: SettingsViewDeps) {
    this.#deps = deps;
    this.keys = new KeysEditor({ get: () => deps.get().keys, save: (keys) => deps.save({ keys }) });
    // A number between − and + buttons.
    const stepper = (name: string, min: number, max: number, label: string) => {
      const input = h("input", { type: "number", min: String(min), max: String(max), step: "1", name, attrs: { "aria-label": label }, on: { change: () => void this.#changed(name) } });
      this.#fields[name] = input;
      const step = (by: number) => () => {
        input.value = String(Math.min(max, Math.max(min, Number(input.value) + by)));
        input.dispatchEvent(new Event("change"));
      };
      const less = h("button", { type: "button", text: "−", attrs: { "aria-label": `Fewer: ${label}` }, on: { click: step(-1) } });
      const more = h("button", { type: "button", text: "+", attrs: { "aria-label": `More: ${label}` }, on: { click: step(1) } });
      return h("span", { className: "stepper" }, less, input, more);
    };
    const range = (name: string, min: number, max: number, step: number, label: string, format: (v: number) => string) => {
      const input = h("input", { type: "range", min: String(min), max: String(max), step: String(step), name, attrs: { "aria-label": label }, on: { input: () => (this.#notes[name]!.textContent = format(Number(input.value))), change: () => void this.#changed(name) } });
      this.#fields[name] = input;
      this.#notes[name] = h("output", { className: "value" });
      return h("span", { className: "range-control row-control" }, input, this.#notes[name]);
    };
    // A starting pace, in the unit the pill shows.
    const pace = (name: string, range: { min: number; max: number }, step: number, unit: string, label: string) => {
      const input = h("input", { type: "number", min: String(range.min), max: String(range.max), step: String(step), name, attrs: { "aria-label": label }, on: { change: () => void this.#changed(name) } });
      this.#fields[name] = input;
      return h("span", { className: "pace" }, input, h("span", { className: "unit", text: unit }));
    };
    const toggle = (name: string, label: string) => {
      const input = h("input", { type: "checkbox", className: "switch", name, attrs: { role: "switch", "aria-label": label }, on: { change: () => void this.#changed(name) } });
      this.#fields[name] = input;
      return input;
    };
    this.#position = new Segmented<"bottom" | "left">("Filmstrip position", [["bottom", "Bottom"], ["left", "Left edge"]], (value) => void this.#deps.save({ filmstripVertical: value === "left" }));
    // A setting: what it is and what it does on the left, its control on the right.
    const row = (label: string, control: Node, note?: string) =>
      h("div", { className: "row" }, h("div", { className: "row-text" }, h("span", { className: "row-label", text: label }), note ? h("p", { className: "note", text: note }) : null), h("div", { className: "row-control" }, control));
    const card = (title: string, ...children: (Node | null)[]) => h("section", { className: "card" }, h("h2", { text: title }), ...children);
    // How large a hovered thumbnail shows, per view: only while hover zoom is on.
    const hover = (view: ThumbView, label: string, note?: string) => {
      const control = new HoverSizeControl({
        doc: document,
        name: `${view}Hover`,
        label: `${label} size`,
        value: deps.get().hoverSize[view],
        onChange: (size) => void this.#deps.save({ hoverSize: { ...this.#deps.get().hoverSize, [view]: size } }),
      });
      return { control, row: row(label, control.element, note) };
    };
    this.#hover = {
      filmstrip: hover("filmstrip", "Filmstrip hover"),
      grid: hover("grid", "Grid hover"),
    };

    this.element = h(
      "section",
      { className: "settings" },
      card(
        "Reader",
        row("Keep the toolbar shown", toggle("toolbarPinned", "Keep the toolbar shown"), "Instead of hiding it when the mouse rests."),
        row("Pages to preload ahead", stepper("preloadAhead", 0, PRELOAD_CAP, "Pages to preload ahead")),
        row("Pages to preload behind", stepper("preloadBehind", 0, PRELOAD_CAP, "Pages to preload behind")),
      ),
      card(
        "Filmstrip and grid",
        row("Filmstrip position", this.#position.element),
        row("Filmstrip thumbnails", range("filmstripWidth", THUMB_WIDTH_RANGE.filmstrip.min, THUMB_WIDTH_RANGE.filmstrip.max, 1, "Filmstrip thumbnail width", (v) => `${v} px`)),
        row("Grid space", this.#gridWidthControl(), "Drag the handles around the grid in the reader for fewer columns or rows without larger thumbnails. Double-click one to give that side all the space."),
        row("Grid thumbnails", range("gridWidth", THUMB_WIDTH_RANGE.grid.min, THUMB_WIDTH_RANGE.grid.max, 1, "Grid thumbnail width", (v) => `${v} px`)),
        row("Hover zoom", toggle("hoverZoom", "Hover zoom"), "A thumbnail under the mouse shows larger. H turns it on or off in the reader."),
        this.#hover.filmstrip.row,
        this.#hover.grid.row,
      ),
      card(
        "Hands-free mode",
        h("p", { className: "note", text: "Space starts hands-free mode, locked, at the pace you last used in that reading mode, or at these until you've used one." }),
        row("Page mode", pace("pageDefault", PAGE_SECONDS_RANGE, 0.5, "s a page", "Starting pace in page mode, in seconds per page")),
        row("Strip mode", pace("stripDefault", STRIP_SPEED_RANGE, 0.05, "×", "Starting speed in strip mode")),
        row("Auto pill position", button("Put it back in its default place", () => void this.#deps.save({ autoZone: null })), "Drag the pill by either end in the reader to move it."),
        ...(deps.character ? this.#characterRows(deps.character, row) : []),
      ),
      card(
        "History",
        row("Pause recording", toggle("recordingPaused", "Pause recording"), "Galleries, covers and searches aren't recorded. Reading progress is still saved."),
      ),
      deps.backup ? this.#backupCard(deps.backup, row, card) : null,
      card("Keyboard shortcuts", h("p", { className: "note", text: "Each key runs one action. An action can have several keys. Changes reach open readers straight away." }), this.keys.element),
    );
    this.update(deps.get());
  }

  #gridWidthControl(): HTMLElement {
    this.#notes.gridWidthValue = h("output", { className: "value" });
    this.#gridReset = button("All the space", () => void this.#deps.save({ gridWidth: null, gridHeight: null }));
    return h("span", { className: "row-control" }, this.#notes.gridWidthValue, this.#gridReset);
  }

  // Loading and removing the character, with what's loaded and what went wrong.
  #characterRows(character: NonNullable<SettingsViewDeps["character"]>, row: (label: string, control: Node, note?: string) => HTMLElement): HTMLElement[] {
    const status = h("p", { className: "note character-status", attrs: { role: "status" } });
    const file = h("input", { type: "file", accept: ".json,application/json", hidden: true });
    file.addEventListener("change", () => {
      const chosen = file.files?.[0];
      file.value = ""; // the same file can be chosen again
      if (!chosen) return;
      status.textContent = "";
      character.load(chosen).then(
        () => this.showCharacter(character.current()),
        (error) => (status.textContent = error instanceof CharacterError ? error.message : "That file couldn't be read."),
      );
    });
    this.#character = {
      name: h("span", { className: "character-name" }),
      remove: button("Remove", () => {
        status.textContent = "";
        void character.remove().then(() => this.showCharacter(null));
      }),
    };
    const control = h("span", { className: "row-control" }, this.#character.name, button("Load a file…", () => file.click()), this.#character.remove, file);
    this.showCharacter(character.current());
    return [row("Character", control, "Gives hands-free mode a voice: short lines when it starts, stops, reaches the end and so on. Without one it stays silent."), status];
  }

  // Shows which character is loaded, e.g. after a change in another tab.
  showCharacter(character: Character | null): void {
    if (!this.#character) return;
    this.#character.name.textContent = character ? character.name : "None";
    this.#character.name.classList.toggle("none", !character);
    this.#character.remove.hidden = !character;
  }

  #backupCard(
    backup: NonNullable<SettingsViewDeps["backup"]>,
    row: (label: string, control: Node, note?: string) => HTMLElement,
    card: (title: string, ...children: (Node | null)[]) => HTMLElement,
  ): HTMLElement {
    const status = h("p", { className: "note backup-status", attrs: { role: "status" } });
    const run = (work: () => Promise<string | null>) => async () => {
      status.textContent = "Working…";
      try {
        status.textContent = (await work()) ?? "";
      } catch {
        status.textContent = "That didn't work. Nothing was changed.";
      }
    };
    const file = h("input", { type: "file", accept: ".json,application/json", hidden: true });
    file.addEventListener("change", () => {
      const chosen = file.files?.[0];
      file.value = ""; // the same file can be chosen again
      if (chosen) void run(() => backup.restore(chosen))();
    });
    return card(
      "Backup",
      row("Save a backup", button("Save backup…", () => void run(backup.save)()), "Reading progress, history, covers and settings in one file, to keep somewhere safe or move to another computer."),
      row("Restore a backup", h("span", {}, button("Choose file…", () => file.click()), file), "Adds the file's contents to what's here. Nothing is deleted."),
      status,
    );
  }

  // Shows the stored settings, e.g. after a change in another tab.
  update(settings: Settings): void {
    const f = this.#fields;
    f.preloadAhead!.value = String(settings.preloadAhead);
    f.preloadBehind!.value = String(settings.preloadBehind);
    f.hoverZoom!.checked = settings.hoverZoom;
    for (const view of ["filmstrip", "grid"] as const) {
      this.#hover[view].row.hidden = !settings.hoverZoom;
      this.#hover[view].control.update(settings.hoverSize[view], settings.thumbWidth[view]);
    }
    this.#position.value = settings.filmstripVertical ? "left" : "bottom";
    f.filmstripWidth!.value = String(settings.thumbWidth.filmstrip);
    this.#notes.filmstripWidth!.textContent = `${settings.thumbWidth.filmstrip} px`;
    f.gridWidth!.value = String(settings.thumbWidth.grid);
    this.#notes.gridWidth!.textContent = `${settings.thumbWidth.grid} px`;
    f.recordingPaused!.checked = settings.recordingPaused;
    this.#notes.gridWidthValue!.textContent = gridSizeText(settings);
    this.#gridReset!.disabled = settings.gridWidth === null && settings.gridHeight === null;
    f.toolbarPinned!.checked = settings.toolbarPinned;
    f.pageDefault!.value = String(settings.autoDefaultPace.page);
    f.stripDefault!.value = String(settings.autoDefaultPace.strip);
    if (!this.keys.capturing) this.keys.render();
  }

  async #changed(name: string): Promise<void> {
    const f = this.#fields;
    const value = (field: string) => Number(f[field]!.value);
    const patch: Partial<Settings> =
      name === "preloadAhead" || name === "preloadBehind"
        ? { preloadAhead: value("preloadAhead"), preloadBehind: value("preloadBehind") }
        : name === "hoverZoom"
          ? { hoverZoom: f.hoverZoom!.checked }
          : name === "filmstripWidth" || name === "gridWidth"
              ? { thumbWidth: { filmstrip: value("filmstripWidth"), grid: value("gridWidth") } }
              : name === "recordingPaused"
                ? { recordingPaused: f.recordingPaused!.checked }
                : name === "toolbarPinned"
                  ? { toolbarPinned: f.toolbarPinned!.checked }
                  : name === "pageDefault" || name === "stripDefault"
                    ? { autoDefaultPace: { page: value("pageDefault"), strip: value("stripDefault") } }
                    : {};
    await this.#deps.save(patch);
    this.update(this.#deps.get()); // as stored, e.g. preload counts brought within the cap
  }
}
