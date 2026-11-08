// Rebinding shortcuts: each action's keys, a key can be added by pressing it, removed, or the
// action reset. The reader, its key badges and its `?` list follow straight away.
import { ACTIONS, AUTO_ACTIONS, isBindableKey, keyName, normalizeKey, type ActionId, type KeyOverrides } from "../../content/reader/shortcuts";
import { button, h } from "./dom";
import { addKey, conflictOf, isOverridden, keysOf, removeKey, resetAction, type AnyActionId } from "./keyBindings";

export interface KeysEditorDeps {
  get: () => KeyOverrides;
  save: (overrides: KeyOverrides) => Promise<void>;
}

const DESCRIPTIONS = new Map<AnyActionId, string>([...ACTIONS, ...AUTO_ACTIONS].map((a) => [a.id, a.description]));

// The reader's actions in groups, for reading the list. Anything not listed goes last.
const GROUPS: [string, ActionId[]][] = [
  ["Turning pages", ["right", "left", "pageNext", "pagePrev", "first", "last"]],
  ["Viewing", ["mode", "direction", "zoomIn", "zoomOut", "actualSize", "fit", "hide"]],
  ["Spreads", ["spreads", "offset", "repair"]],
  ["Filmstrip and grid", ["filmstrip", "filmstripVertical", "grid", "thumbsSmaller", "thumbsLarger", "hoverZoom"]],
];

function groups(): [string, ActionId[]][] {
  const grouped = new Set(GROUPS.flatMap(([, ids]) => ids));
  return [...GROUPS, ["Other", ACTIONS.map((a) => a.id).filter((id) => !grouped.has(id))]];
}

export class KeysEditor {
  readonly element: HTMLElement;
  readonly #deps: KeysEditorDeps;
  readonly #message = h("p", { className: "key-message", attrs: { role: "status" } });
  #capturing: AnyActionId | null = null;
  #pending: { id: AnyActionId; key: string } | null = null; // a taken key, waiting for "Move it here"

  constructor(deps: KeysEditorDeps) {
    this.#deps = deps;
    this.element = h("div", { className: "keys" });
    this.render();
  }

  get capturing(): AnyActionId | null {
    return this.#capturing;
  }

  render(): void {
    const overrides = this.#deps.get();
    const table = (ids: AnyActionId[]) => h("table", { className: "keys-table" }, ...ids.map((id) => this.#row(id, overrides)));
    this.element.replaceChildren(
      ...groups().flatMap(([title, ids]) => [h("h3", { text: title }), table(ids)]),
      h("h3", { text: "While hands-free mode runs" }),
      h("p", { className: "hint", text: "These may share keys with the reader's, since they only apply while hands-free mode runs." }),
      table(AUTO_ACTIONS.map((a) => a.id)),
      this.#message,
      h("div", { className: "keys-footer" }, button("Reset all shortcuts", () => void this.#save({}, "All shortcuts are back to their defaults."), "danger")),
    );
  }

  // Starts listening for the next key for `id`.
  capture(id: AnyActionId): void {
    this.#capturing = id;
    this.#pending = null;
    this.#message.textContent = `Press a key for "${DESCRIPTIONS.get(id)}"…`;
    this.render();
    this.element.querySelector<HTMLButtonElement>(`[data-capture="${id}"]`)?.focus();
  }

  cancel(): void {
    this.#capturing = null;
    this.#pending = null;
    this.#message.textContent = "";
    this.render();
  }

  // A key pressed while capturing.
  async press(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "metaKey">): Promise<void> {
    const id = this.#capturing;
    if (!id) return;
    if (event.ctrlKey || event.altKey || event.metaKey) {
      this.#message.textContent = "Keys with Ctrl, Alt or Meta can't be used here.";
      return;
    }
    if (!isBindableKey(event.key)) return; // e.g. Shift on its own: wait for the real key
    const key = normalizeKey(event.key);
    const overrides = this.#deps.get();
    this.#capturing = null;
    if (keysOf(overrides, id).includes(key)) {
      this.#message.textContent = `${keyName(key)} is already a key for "${DESCRIPTIONS.get(id)}".`;
      this.render();
      return;
    }
    const owner = conflictOf(overrides, id, key);
    if (owner) {
      this.#pending = { id, key };
      this.#message.textContent = `${keyName(key)} is used by "${DESCRIPTIONS.get(owner)}".`;
      this.render();
      this.#message.append(" ", button("Move it here", () => void this.confirmMove()), " ", button("Cancel", () => this.cancel()));
      return;
    }
    await this.#save(addKey(overrides, id, key), `${keyName(key)} now runs "${DESCRIPTIONS.get(id)}".`);
  }

  async confirmMove(): Promise<void> {
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = null;
    await this.#save(addKey(this.#deps.get(), pending.id, pending.key), `${keyName(pending.key)} moved to "${DESCRIPTIONS.get(pending.id)}".`);
  }

  async #save(overrides: KeyOverrides, message: string): Promise<void> {
    await this.#deps.save(overrides);
    this.#capturing = null;
    this.render();
    this.#message.textContent = message;
  }

  #row(id: AnyActionId, overrides: KeyOverrides): HTMLTableRowElement {
    const keys = keysOf(overrides, id);
    const capturing = this.#capturing === id;
    const chips = keys.map((key) =>
      h(
        "span",
        { className: "key-chip" },
        h("kbd", { text: keyName(key) }),
        h("button", {
          type: "button",
          className: "remove",
          text: "×",
          attrs: { "aria-label": `Remove ${keyName(key)}` },
          on: { click: () => void this.#save(removeKey(this.#deps.get(), id, key), `${keyName(key)} removed from "${DESCRIPTIONS.get(id)}".`) },
        }),
      ),
    );
    const add = h("button", {
      type: "button",
      className: capturing ? "capture active" : "capture",
      text: capturing ? "Press a key… (click to cancel)" : "Add key",
      attrs: { "data-capture": id },
      on: {
        click: () => (capturing ? this.cancel() : this.capture(id)),
        keydown: (event) => {
          if (!this.#capturing) return;
          event.preventDefault();
          event.stopPropagation();
          void this.press(event);
        },
        blur: () => {
          if (this.#capturing === id) this.cancel();
        },
      },
    });
    return h(
      "tr",
      { className: isOverridden(overrides, id) ? "changed" : "", attrs: { "data-action": id } },
      h("td", { className: "action", text: DESCRIPTIONS.get(id) ?? id }),
      h("td", { className: "chips" }, ...(chips.length ? chips : [h("span", { className: "none", text: "No key" })])),
      h("td", { className: "edit" }, add, isOverridden(overrides, id) ? button("Reset", () => void this.#save(resetAction(this.#deps.get(), id), `"${DESCRIPTIONS.get(id)}" is back to its default keys.`)) : null),
    );
  }
}
