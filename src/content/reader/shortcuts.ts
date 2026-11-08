// Every reader action with its keys. The key handler, the `?` list and the key badges on
// buttons all read from here.

export type ActionId =
  | "right"
  | "left"
  | "pageNext"
  | "pagePrev"
  | "first"
  | "last"
  | "mode"
  | "spreads"
  | "offset"
  | "repair"
  | "direction"
  | "zoomIn"
  | "zoomOut"
  | "actualSize"
  | "fit"
  | "filmstrip"
  | "filmstripVertical"
  | "grid"
  | "thumbsSmaller"
  | "thumbsLarger"
  | "hoverZoom"
  | "autoPlay"
  | "hide"
  | "settings"
  | "help"
  | "close";

export interface Action {
  id: ActionId;
  keys: string[]; // KeyboardEvent.key values, letters in lower case; the first one is shown
  description: string;
}

export const ACTIONS: Action[] = [
  { id: "right", keys: ["ArrowRight"], description: "Next page (previous in right-to-left)" },
  { id: "left", keys: ["ArrowLeft"], description: "Previous page (next in right-to-left)" },
  { id: "pageNext", keys: ["PageDown"], description: "Next page (page mode)" },
  { id: "pagePrev", keys: ["PageUp"], description: "Previous page (page mode)" },
  { id: "first", keys: ["Home"], description: "First page (the grid's start while it's open)" },
  { id: "last", keys: ["End"], description: "Last page (the grid's end while it's open)" },
  { id: "mode", keys: ["m"], description: "Switch between page and strip mode" },
  { id: "spreads", keys: ["d"], description: "Two-page spreads on or off (page mode)" },
  { id: "offset", keys: ["o"], description: "Pair the cover with page 2, or show it alone (spreads)" },
  { id: "repair", keys: ["p"], description: "Flip the pairing from this page on, or undo it here (spreads)" },
  { id: "direction", keys: ["r"], description: "Reading direction" },
  { id: "zoomIn", keys: ["+", "="], description: "Zoom in (larger thumbnails while the grid is open)" },
  { id: "zoomOut", keys: ["-", "_"], description: "Zoom out (smaller thumbnails while the grid is open)" },
  { id: "actualSize", keys: ["0"], description: "Actual size" },
  { id: "fit", keys: ["f"], description: "Fit to viewport" },
  { id: "filmstrip", keys: ["t"], description: "Filmstrip" },
  { id: "filmstripVertical", keys: ["v"], description: "Filmstrip along the bottom or on the left edge" },
  { id: "grid", keys: ["g"], description: "Grid of all pages" },
  { id: "thumbsSmaller", keys: ["["], description: "Smaller thumbnails in the filmstrip or grid" },
  { id: "thumbsLarger", keys: ["]"], description: "Larger thumbnails in the filmstrip or grid" },
  { id: "hoverZoom", keys: ["h"], description: "Hover zoom on or off in the filmstrip and grid" },
  { id: "autoPlay", keys: [" "], description: "Hands-free: start locked at the last speed, lock the speed while steering, or stop" },
  { id: "hide", keys: ["b"], description: "Hide the reader behind a blank screen, and show it again" },
  { id: "settings", keys: ["s"], description: "Quick settings" },
  { id: "help", keys: ["?"], description: "Show this list" },
  { id: "close", keys: ["Escape"], description: "Back to the gallery" },
];

// Keys that belong to hands-free mode while it runs, ahead of the actions above.
export type AutoActionId = "autoStop";

export const AUTO_ACTIONS: { id: AutoActionId; keys: string[]; description: string }[] = [
  { id: "autoStop", keys: ["Escape"], description: "Stop" },
];

const NAMES: Record<string, string> = {
  ArrowRight: "→",
  ArrowLeft: "←",
  ArrowUp: "↑",
  ArrowDown: "↓",
  " ": "Space",
  Escape: "Esc",
  PageDown: "Page Down",
  PageUp: "Page Up",
  "-": "−",
};

export function keyName(key: string): string {
  return NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

// KeyboardEvent.key as the keymap stores it.
export function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

// Keys the user chose, by action id; actions not listed keep their default keys.
export type KeyOverrides = Partial<Record<ActionId | AutoActionId, string[]>>;

// Keys can't use Ctrl, Alt or Meta (the reader leaves those to the browser), and modifier
// keys alone aren't keys.
const NOT_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "Dead", "Unidentified", "Process", "Tab"]);
export function isBindableKey(key: string): boolean {
  return key.length > 0 && !NOT_KEYS.has(key);
}

export function resolveActions(overrides: KeyOverrides = {}): Action[] {
  return ACTIONS.map((action) => ({ ...action, keys: overrides[action.id] ?? action.keys }));
}

export function resolveAutoActions(overrides: KeyOverrides = {}): typeof AUTO_ACTIONS {
  return AUTO_ACTIONS.map((action) => ({ ...action, keys: overrides[action.id] ?? action.keys }));
}

export function buildKeymap(actions: Action[] = ACTIONS): Map<string, ActionId> {
  const map = new Map<string, ActionId>();
  for (const action of actions) for (const key of action.keys) if (!map.has(key)) map.set(key, action.id);
  return map;
}

export function actionOf(id: ActionId, actions: Action[] = ACTIONS): Action {
  return actions.find((action) => action.id === id)!;
}

// The key shown on a button for an action.
export function badgeOf(id: ActionId, actions: Action[] = ACTIONS): string {
  const key = actionOf(id, actions).keys[0];
  return key === undefined ? "" : keyName(key);
}
