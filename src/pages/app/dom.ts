// Small helpers for building the page's DOM.
import { icon, type IconName } from "../../shared/icons";
import { SegmentedControl } from "../../shared/segmented";

type Child = Node | string | null | undefined | false;

export interface Props {
  className?: string;
  text?: string;
  attrs?: Record<string, string>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (event: HTMLElementEventMap[K]) => void }>;
  [property: string]: unknown;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { className, text, attrs, on, ...rest } = props;
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  for (const [name, value] of Object.entries(attrs ?? {})) el.setAttribute(name, value);
  for (const [name, handler] of Object.entries(on ?? {})) el.addEventListener(name, handler as EventListener);
  Object.assign(el, rest);
  for (const child of children) if (child !== null && child !== undefined && child !== false) el.append(child);
  return el;
}

export function button(label: string, onClick: () => void, className = ""): HTMLButtonElement {
  return h("button", { type: "button", className, text: label, on: { click: onClick } });
}

// A button with an icon and a visible label, or only the icon when `labelHidden`: the label
// then becomes its tooltip and accessible name.
export function iconButton(name: IconName, label: string, onClick: () => void, { className = "", labelHidden = false } = {}): HTMLButtonElement {
  const node = h("button", { type: "button", className: `${className} ${labelHidden ? "icon-only" : "with-icon"}`.trim(), on: { click: onClick } }, icon(name));
  if (labelHidden) {
    node.title = label;
    node.setAttribute("aria-label", label);
  } else {
    node.append(label);
  }
  return node;
}

// An exclusive choice: the shared segmented control, with options as [value, label] pairs, the
// first chosen to begin with.
export class Segmented<T extends string> extends SegmentedControl<T> {
  constructor(label: string, options: [T, string][], onChange: (value: T) => void) {
    super({ doc: document, label, options: options.map(([value, text]) => ({ value, label: text })), value: options[0]![0], onChange });
  }
}

// A choice of any number of options from a set that may grow, as checkboxes, led by an "All"
// box that checks or clears them all and shows when only some are checked.
export class CheckboxGroup<T extends string> {
  readonly element: HTMLElement;
  readonly #all: HTMLInputElement;
  readonly #boxes = new Map<T, HTMLInputElement>();

  constructor(label: string, options: [T, string][], onChange: (values: T[]) => void) {
    const box = (text: string, input: HTMLInputElement, className = "") => h("label", { className: `check ${className}`.trim() }, input, text);
    this.#all = h("input", { type: "checkbox", checked: true });
    this.#all.addEventListener("change", () => {
      this.values = this.#all.checked ? [...this.#boxes.keys()] : [];
      onChange(this.values);
    });
    const items = options.map(([value, text]) => {
      const input = h("input", { type: "checkbox", checked: true, value });
      input.addEventListener("change", () => {
        this.#renderAll();
        onChange(this.values);
      });
      this.#boxes.set(value, input);
      return box(text, input);
    });
    this.element = h("div", { className: "checks", attrs: { role: "group", "aria-label": label } }, box("All", this.#all, "all"), ...items);
  }

  get values(): T[] {
    return [...this.#boxes].filter(([, input]) => input.checked).map(([value]) => value);
  }

  set values(values: T[]) {
    for (const [value, input] of this.#boxes) input.checked = values.includes(value);
    this.#renderAll();
  }

  get allChecked(): boolean {
    return this.values.length === this.#boxes.size;
  }

  #renderAll(): void {
    const count = this.values.length;
    this.#all.checked = count === this.#boxes.size;
    this.#all.indeterminate = count > 0 && count < this.#boxes.size;
  }
}

export const TOAST_MS = 10_000;

// Short notices at the bottom of the page, each with an optional action such as Undo, gone after
// `ms` with a thin bar running down meanwhile. The newest few stay; older ones make way.
export class Toasts {
  readonly element = h("div", { className: "toasts", attrs: { role: "status", "aria-live": "polite" } });

  show(message: string, action?: { label: string; run: () => unknown }, ms = TOAST_MS): void {
    const toast = h("div", { className: "toast" }, h("span", { className: "toast-text", text: message }));
    let timer: ReturnType<typeof setTimeout> | null = null;
    const close = () => {
      if (timer !== null) clearTimeout(timer);
      toast.remove();
    };
    if (action) {
      toast.append(
        button(action.label, () => {
          close();
          void action.run();
        }, "toast-action"),
      );
    }
    toast.append(iconButton("close", "Dismiss", close, { labelHidden: true, className: "quiet" }), h("span", { className: "toast-timer", attrs: { style: `animation-duration: ${ms}ms` } }));
    this.element.append(toast);
    while (this.element.children.length > 3) this.element.firstElementChild!.remove();
    timer = setTimeout(close, ms);
  }
}
