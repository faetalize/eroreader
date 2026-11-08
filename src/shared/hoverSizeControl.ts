// How large a hovered thumbnail shows, for one view, in three lines, one of which counts:
// - multi: a multiplier of the thumbnail's width;
// - +px: an amount added to it, a few offered or one typed in (while Custom is chosen, its
//   segment is the field to type it in, so it fits wherever the offered ones do);
// - px: a width of its own, from the thumbnail's width up, following the thumbnails as they
//   change size.
// Each line leads with a radio button and a short tag; the one that counts is checked and the
// others are dimmed. Touching a dimmed line's controls makes it the one that counts.
//
// It never sets a control the user has in hand (a slider being dragged, the custom amount
// being typed): settings arriving meanwhile can only be older than what's in it. And it saves
// only what the user set: what it shows of the thumbnails' width is never saved.
//
// The stylesheet using it styles `.hover-size` and its parts (see the class names below).
import { holding } from "./holding";
import { SegmentedControl } from "./segmented";
import { HOVER_OFFSET_RANGE, HOVER_OFFSETS, HOVER_SCALE_RANGE, HOVER_WIDTH_MAX, THUMB_WIDTH_RANGE, type HoverSize } from "./settings";

export interface HoverSizeControlOptions {
  doc: Document;
  name: string; // unique on the page, e.g. "filmstripHover"
  label: string; // the group's accessible name
  value: HoverSize;
  onChange: (size: HoverSize) => void;
}

type By = HoverSize["by"];
type Offset = `${number}` | "custom";

const LINES: { by: By; tag: string; name: string }[] = [
  { by: "scale", tag: "multi", name: "Multiplier" },
  { by: "offset", tag: "+px", name: "Added width" },
  { by: "width", tag: "px", name: "Width" },
];

const scaleText = (scale: number) => `${scale.toFixed(1)}×`;
// The width slider's start until the thumbnails' width is known: the smallest they get.
const THUMB_FALLBACK = THUMB_WIDTH_RANGE.filmstrip.min;

export class HoverSizeControl {
  readonly element: HTMLDivElement;
  readonly scaleInput: HTMLInputElement;
  readonly widthInput: HTMLInputElement;
  readonly customInput: HTMLInputElement;
  readonly offsets: SegmentedControl<Offset>;
  readonly #onChange: (size: HoverSize) => void;
  readonly #radios = {} as Record<By, HTMLInputElement>;
  readonly #lines = {} as Record<By, HTMLElement>;
  readonly #scaleText: HTMLOutputElement;
  readonly #widthText: HTMLOutputElement;
  readonly #customBox: HTMLElement;
  readonly #held: { scale: () => boolean; width: () => boolean };
  #value: HoverSize;
  #thumbWidth: number | null = null;
  #customChosen = false; // "Custom" picked, even while its amount equals an offered one

  constructor(options: HoverSizeControlOptions) {
    const doc = options.doc;
    this.#onChange = options.onChange;
    this.#value = { ...options.value };
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = "") => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text) node.textContent = text;
      return node;
    };
    const slider = (className: string, name: string, label: string, min: number, max: number, step: number, set: (value: number) => Partial<HoverSize>) => {
      const input = el("input", className);
      input.type = "range";
      input.name = name;
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.setAttribute("aria-label", label);
      input.addEventListener("input", () => this.#set(set(Number(input.value))));
      return input;
    };

    this.scaleInput = slider("hs-scale", `${options.name}Scale`, "Multiplier", HOVER_SCALE_RANGE.min, HOVER_SCALE_RANGE.max, 0.1, (scale) => ({ by: "scale", scale }));
    this.#scaleText = el("output", "hs-value");
    this.widthInput = slider("hs-width", `${options.name}Width`, "Width", THUMB_FALLBACK, HOVER_WIDTH_MAX, 10, (width) => ({ by: "width", width }));
    this.#widthText = el("output", "hs-value");
    this.#held = { scale: holding(this.scaleInput), width: holding(this.widthInput) };

    this.offsets = new SegmentedControl<Offset>({
      doc,
      label: "Added width",
      options: [...HOVER_OFFSETS.map((px) => ({ value: `${px}` as Offset, label: `+${px}` })), { value: "custom", label: "Custom", title: "Type your own" }],
      value: "100",
      className: "hs-offsets",
      onChange: (value) => {
        this.#customChosen = value === "custom";
        if (value === "custom") {
          this.#set({ by: "offset", offset: this.#customAmount() });
          this.customInput.focus();
          this.customInput.select();
        } else {
          this.#set({ by: "offset", offset: Number(value) });
        }
      },
    });
    this.customInput = el("input", "hs-custom");
    this.customInput.type = "number";
    this.customInput.name = `${options.name}Offset`;
    this.customInput.min = String(HOVER_OFFSET_RANGE.min);
    this.customInput.max = String(HOVER_OFFSET_RANGE.max);
    this.customInput.step = "10";
    this.customInput.setAttribute("aria-label", "Pixels wider");
    this.customInput.addEventListener("change", () => {
      this.#customChosen = true;
      this.#set({ by: "offset", offset: this.#customAmount() });
      this.customInput.value = String(this.#value.offset); // brought within range
    });
    // In the offered amounts' track, in place of the Custom segment while it's chosen.
    this.#customBox = el("label", "hs-custom-box");
    this.#customBox.append(el("span", "hs-unit", "+"), this.customInput, el("span", "hs-unit", "px"));
    this.offsets.element.append(this.#customBox);

    const controls: Record<By, HTMLElement[]> = {
      scale: [this.scaleInput, this.#scaleText],
      offset: [this.offsets.element],
      width: [this.widthInput, this.#widthText],
    };
    this.element = el("div", "hover-size");
    this.element.setAttribute("role", "group");
    this.element.setAttribute("aria-label", options.label);
    for (const { by, tag, name } of LINES) {
      const radio = el("input", "hs-radio");
      radio.type = "radio";
      radio.name = `${options.name}-by`;
      radio.value = by;
      radio.setAttribute("aria-label", name);
      radio.addEventListener("change", () => radio.checked && this.#set({ by }));
      this.#radios[by] = radio;
      // The radio and its tag, one target: a click on the tag picks the line.
      const head = el("label", "hs-head");
      head.title = name;
      head.append(radio, el("span", "hs-tag", tag));
      const line = el("div", `hs-line ${by}`);
      line.append(head, ...controls[by]);
      // Using a dimmed line's controls makes it the one that counts.
      const touch = (event: Event) => {
        if (!head.contains(event.target as Node) && this.#value.by !== by) this.#set({ by });
      };
      line.addEventListener("pointerdown", touch);
      line.addEventListener("focusin", touch);
      this.#lines[by] = line;
      this.element.append(line);
    }
    this.update(options.value, null);
  }

  get value(): HoverSize {
    return { ...this.#value };
  }

  // Shows `size` for thumbnails `thumbWidth` wide (null when unknown), leaving alone whatever
  // the user has in hand.
  update(size: HoverSize, thumbWidth: number | null): void {
    this.#value = { ...size };
    this.#render(thumbWidth);
  }

  // Shown at once, whatever changed (picking Custom with the amount as it was changes only
  // what's shown); saved only when the value did change.
  #set(patch: Partial<HoverSize>): void {
    const next = { ...this.#value, ...patch };
    const same = (Object.keys(next) as (keyof HoverSize)[]).every((key) => next[key] === this.#value[key]);
    this.#value = next;
    this.#render(this.#thumbWidth);
    if (!same) this.#onChange({ ...next });
  }

  #customAmount(): number {
    const typed = Number(this.customInput.value);
    const amount = Number.isFinite(typed) && this.customInput.value !== "" ? typed : this.#value.offset;
    return Math.round(Math.min(HOVER_OFFSET_RANGE.max, Math.max(HOVER_OFFSET_RANGE.min, amount)));
  }

  #render(thumbWidth: number | null): void {
    this.#thumbWidth = thumbWidth;
    const { by, scale, offset, width } = this.#value;
    for (const { by: which } of LINES) {
      this.#radios[which].checked = which === by;
      this.#lines[which].classList.toggle("hs-off", which !== by);
    }
    if (!this.#held.scale()) this.scaleInput.value = String(scale);
    this.#scaleText.textContent = scaleText(scale);
    // A width of its own starts at the thumbnails' width, whatever that is now.
    if (!this.#held.width()) {
      const min = thumbWidth ?? THUMB_FALLBACK;
      this.widthInput.min = String(min);
      this.widthInput.value = String(Math.max(min, width));
    }
    this.#widthText.textContent = String(Math.max(thumbWidth ?? 0, width));
    const custom = this.#customChosen || !HOVER_OFFSETS.includes(offset);
    this.offsets.value = custom ? "custom" : (`${offset}` as Offset);
    this.#customBox.hidden = !custom;
    this.offsets.buttons.get("custom")!.hidden = custom;
    const typing = (this.customInput.getRootNode() as Document | ShadowRoot).activeElement === this.customInput;
    if (!typing) this.customInput.value = String(offset);
  }
}
