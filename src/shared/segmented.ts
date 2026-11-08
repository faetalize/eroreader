// A choice between exclusive options, drawn as one control: the options sit on a track, and a
// thumb slides to the chosen one. Clicking an option picks it; the thumb can also be dragged
// and dropped on another. It's a radio group: one option is tabbable, and the arrow keys move
// the choice.
//
// The stylesheet using it styles `.seg` (the track), `.seg-thumb` and `.seg button`. The thumb
// is placed by measuring the chosen button; until the control can be measured (hidden, or no
// layout), `.seg` lacks the `measured` class, so the chosen button can be styled on its own.

export interface SegmentOption<T extends string> {
  value: T;
  label: string | Node;
  title?: string;
}

export interface SegmentedOptions<T extends string> {
  doc: Document;
  label: string; // the group's accessible name
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void; // only for the user's picks, not for `value` being set
  className?: string;
}

const DRAG_THRESHOLD = 4; // px before a press on the thumb counts as a drag

export class SegmentedControl<T extends string> {
  readonly element: HTMLDivElement;
  readonly buttons = new Map<T, HTMLButtonElement>();
  readonly #thumb: HTMLSpanElement;
  readonly #onChange: (value: T) => void;
  #value: T;
  #dragged = false; // a drag just ended: the click it ends with isn't a pick

  constructor(options: SegmentedOptions<T>) {
    const doc = options.doc;
    this.#onChange = options.onChange;
    this.#value = options.value;
    this.element = doc.createElement("div");
    this.element.className = `seg ${options.className ?? ""}`.trim();
    this.element.setAttribute("role", "radiogroup");
    this.element.setAttribute("aria-label", options.label);
    this.#thumb = doc.createElement("span");
    this.#thumb.className = "seg-thumb";
    this.#thumb.setAttribute("aria-hidden", "true");
    this.element.append(this.#thumb);
    for (const option of options.options) {
      const button = doc.createElement("button");
      button.type = "button";
      button.setAttribute("role", "radio");
      button.dataset.value = option.value;
      if (option.title) button.title = option.title;
      button.append(option.label);
      button.addEventListener("click", () => {
        if (!this.#dragged && !this.disabled) this.#pick(option.value);
      });
      this.buttons.set(option.value, button);
      this.element.append(button);
    }
    this.element.addEventListener("keydown", (event) => this.#onKey(event));
    this.#attachDrag();
    this.value = options.value;
    // Placed once it has a size, and again whenever that changes (fonts, a panel opening).
    const view = doc.defaultView as (Window & typeof globalThis) | null;
    if (view?.ResizeObserver) new view.ResizeObserver(() => this.#place(false)).observe(this.element);
  }

  get value(): T {
    return this.#value;
  }

  // Greyed out and out of reach (the choice it shows still stands), e.g. while what it's about
  // isn't on screen.
  get disabled(): boolean {
    return this.element.classList.contains("disabled");
  }

  set disabled(disabled: boolean) {
    this.element.classList.toggle("disabled", disabled);
    this.element.setAttribute("aria-disabled", String(disabled));
    for (const button of this.buttons.values()) button.disabled = disabled;
  }

  set value(value: T) {
    this.#value = value;
    for (const [v, button] of this.buttons) {
      button.setAttribute("aria-checked", String(v === value));
      button.tabIndex = v === value ? 0 : -1;
    }
    this.#place(true);
  }

  #pick(value: T): void {
    if (value === this.#value) return;
    this.value = value;
    this.#onChange(value);
  }

  #onKey(event: KeyboardEvent): void {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    // Only from its options: anything else in its track (a field) keeps its own arrow keys.
    if (!step || this.disabled || !(event.target instanceof Element) || ![...this.buttons.values()].includes(event.target as HTMLButtonElement)) return;
    event.preventDefault();
    event.stopPropagation();
    const values = [...this.buttons.keys()];
    const next = values[(values.indexOf(this.#value) + step + values.length) % values.length]!;
    this.#pick(next);
    this.buttons.get(next)!.focus();
  }

  // Moves the thumb under the chosen button: slides there, or jumps when not `animate`.
  #place(animate: boolean): void {
    const button = this.buttons.get(this.#value);
    const width = button?.offsetWidth ?? 0;
    const measured = width > 0;
    this.element.classList.toggle("measured", measured);
    if (!measured) return;
    this.#thumb.classList.toggle("instant", !animate);
    this.#thumb.style.width = `${width}px`;
    this.#thumb.style.transform = `translateX(${button!.offsetLeft}px)`;
  }

  // Pressing the chosen option and moving drags the thumb along the track; letting go picks the
  // option under the thumb's middle.
  #attachDrag(): void {
    let drag: { startX: number; startLeft: number; moved: boolean } | null = null;
    this.element.addEventListener("pointerdown", (event) => {
      const button = (event.target as Element).closest?.("button");
      if (event.button !== 0 || this.disabled || !button || button.getAttribute("aria-checked") !== "true") return;
      drag = { startX: event.clientX, startLeft: button.offsetLeft, moved: false };
      this.element.setPointerCapture?.(event.pointerId);
    });
    this.element.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
      drag.moved = true;
      this.element.classList.add("dragging");
      const width = this.#thumb.offsetWidth;
      const max = this.element.clientWidth - width - 2;
      this.#thumb.style.transform = `translateX(${Math.min(max, Math.max(2, drag.startLeft + dx))}px)`;
    });
    const end = () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      this.element.classList.remove("dragging");
      if (!moved) return;
      // The click this press ends with, right after, isn't a pick of its own.
      this.#dragged = true;
      setTimeout(() => (this.#dragged = false), 0);
      const middle = this.#thumbLeft() + this.#thumb.offsetWidth / 2;
      let nearest = this.#value;
      let distance = Infinity;
      for (const [value, button] of this.buttons) {
        const d = Math.abs(button.offsetLeft + button.offsetWidth / 2 - middle);
        if (d < distance) [nearest, distance] = [value, d];
      }
      if (nearest === this.#value) this.#place(true);
      else this.#pick(nearest);
    };
    this.element.addEventListener("pointerup", end);
    this.element.addEventListener("pointercancel", end);
  }

  #thumbLeft(): number {
    return Number(/translateX\((-?[\d.]+)px\)/.exec(this.#thumb.style.transform)?.[1] ?? 0);
  }
}
