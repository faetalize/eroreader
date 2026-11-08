// The reader's quick settings: a popover under its toolbar button with the settings that matter
// while reading. Changes apply at once and are saved.
import { holding } from "../../shared/holding";
import { SegmentedControl } from "../../shared/segmented";
import { HoverSizeControl } from "../../shared/hoverSizeControl";
import { PRELOAD_CAP, THUMB_WIDTH_RANGE, type Settings, type ThumbView, gridSizeText } from "../../shared/settings";

export interface QuickSettingsDeps {
  doc: Document;
  settings: () => Settings;
  save: (patch: Partial<Settings>) => void;
  openAll?: () => void; // the extension's Settings page
}

export class QuickSettings {
  readonly element: HTMLDivElement;
  readonly #deps: QuickSettingsDeps;
  readonly #refresh: ((settings: Settings) => void)[] = [];

  constructor(deps: QuickSettingsDeps) {
    this.#deps = deps;
    const doc = deps.doc;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = "") => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text) node.textContent = text;
      return node;
    };
    // Actions, in the reader's control vocabulary.
    const button = (text: string, label: string, onClick: () => void) => {
      const node = el("button", "action", text);
      node.type = "button";
      node.setAttribute("aria-label", label);
      node.addEventListener("click", onClick);
      return node;
    };
    const row = (label: string, ...controls: HTMLElement[]) => {
      const line = el("div", "qs-row");
      line.append(el("span", "qs-label", label), ...controls);
      return line;
    };
    const section = (title: string, ...rows: HTMLElement[]) => {
      const box = el("section", "qs-section");
      box.append(el("h3", "", title), ...rows);
      return box;
    };
    const slider = (name: string, range: { min: number; max: number }, step: number, read: (s: Settings) => number, write: (value: number) => Partial<Settings>, text: (value: number) => string) => {
      const input = el("input");
      input.type = "range";
      input.name = name;
      input.min = String(range.min);
      input.max = String(range.max);
      input.step = String(step);
      const value = el("output", "qs-value");
      input.addEventListener("input", () => {
        value.textContent = text(Number(input.value));
        this.#deps.save(write(Number(input.value)));
      });
      const held = holding(input);
      this.#refresh.push((settings) => {
        if (held()) return; // the user's hand is on it: what arrives meanwhile is older
        input.value = String(read(settings));
        value.textContent = text(read(settings));
      });
      return [input, value];
    };
    const thumbSize = (view: ThumbView) =>
      slider(
        `${view}Size`,
        THUMB_WIDTH_RANGE[view],
        1,
        (s) => s.thumbWidth[view],
        (width) => ({ thumbWidth: { ...this.#deps.settings().thumbWidth, [view]: width } }),
        (width) => `${width} px`,
      );

    // Filmstrip position: an exclusive choice.
    const position = new SegmentedControl<"bottom" | "left">({
      doc,
      label: "Filmstrip position",
      options: [
        { value: "bottom", label: "Bottom", title: "Filmstrip along the bottom" },
        { value: "left", label: "Left", title: "Filmstrip on the left edge" },
      ],
      value: deps.settings().filmstripVertical ? "left" : "bottom",
      onChange: (value) => this.#deps.save({ filmstripVertical: value === "left" }),
    });
    this.#refresh.push((settings) => (position.value = settings.filmstripVertical ? "left" : "bottom"));

    // Preloading: steppers, at most PRELOAD_CAP pages in all.
    const stepper = (key: "preloadAhead" | "preloadBehind", label: string) => {
      const value = el("output", "qs-value");
      const less = button("−", `Fewer pages ${label}`, () => this.#deps.save({ [key]: this.#deps.settings()[key] - 1 }));
      const more = button("+", `More pages ${label}`, () => this.#deps.save({ [key]: this.#deps.settings()[key] + 1 }));
      this.#refresh.push((settings) => {
        value.textContent = String(settings[key]);
        less.disabled = settings[key] <= 0;
        more.disabled = settings.preloadAhead + settings.preloadBehind >= PRELOAD_CAP;
      });
      const box = el("div", "qs-stepper");
      box.dataset.setting = key;
      box.append(less, value, more);
      return box;
    };

    // A switch: a checkbox drawn as a toggle, with its label.
    const toggle = (name: "toolbarPinned" | "hoverZoom", label: string) => {
      const input = el("input", "qs-switch");
      input.type = "checkbox";
      input.name = name;
      input.setAttribute("role", "switch");
      input.addEventListener("change", () => this.#deps.save({ [name]: input.checked }));
      this.#refresh.push((settings) => (input.checked = settings[name]));
      const line = el("label", "qs-row");
      line.append(el("span", "qs-label", label), input);
      return line;
    };
    // How large a hovered thumbnail shows: only while hover zoom is on.
    const hoverSize = (view: ThumbView) => {
      const control = new HoverSizeControl({
        doc,
        name: `${view}Hover`,
        label: `${view === "grid" ? "Grid" : "Filmstrip"} hover size`,
        value: deps.settings().hoverSize[view],
        onChange: (size) => this.#deps.save({ hoverSize: { ...this.#deps.settings().hoverSize, [view]: size } }),
      });
      const line = el("div", "qs-row qs-stack");
      line.append(el("span", "qs-label", "Hover"), control.element);
      this.#refresh.push((settings) => {
        line.hidden = !settings.hoverZoom;
        control.update(settings.hoverSize[view], settings.thumbWidth[view]);
      });
      return line;
    };

    // The grid's size is set by dragging its handles; here it shows and resets.
    const gridWidth = el("output", "qs-value");
    const resetGridWidth = button("Reset", "Give the grid all the space", () => this.#deps.save({ gridWidth: null, gridHeight: null }));
    this.#refresh.push((settings) => {
      gridWidth.textContent = gridSizeText(settings);
      resetGridWidth.disabled = settings.gridWidth === null && settings.gridHeight === null;
    });

    const resetPill = button("Put it back in its default place", "Put the auto pill back in its default place", () => this.#deps.save({ autoZone: null }));
    resetPill.classList.add("qs-wide");
    this.#refresh.push((settings) => (resetPill.disabled = settings.autoZone === null));

    this.element = el("div", "quick-settings");
    this.element.hidden = true;
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-label", "Quick settings");
    this.element.append(
      section("Toolbar", toggle("toolbarPinned", "Keep it shown")),
      section("Thumbnails", toggle("hoverZoom", "Hover zoom")),
      section("Filmstrip", row("Position", position.element), row("Size", ...thumbSize("filmstrip")), hoverSize("filmstrip")),
      section("Grid", row("Size", ...thumbSize("grid")), hoverSize("grid"), row("Space", gridWidth, resetGridWidth)),
      section("Preloading", row("Pages ahead", stepper("preloadAhead", "ahead")), row("Pages behind", stepper("preloadBehind", "behind"))),
      section("Hands-free pill", resetPill),
    );
    if (deps.openAll) {
      const all = button("All settings…", "Open all settings in a new tab", () => deps.openAll!());
      all.classList.add("qs-wide", "qs-all");
      this.element.append(all);
    }
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  open(): void {
    this.update(this.#deps.settings());
    this.element.hidden = false;
  }

  close(): void {
    this.element.hidden = true;
  }

  // Shows `settings`, however they changed.
  update(settings: Settings): void {
    for (const refresh of this.#refresh) refresh(settings);
  }
}
