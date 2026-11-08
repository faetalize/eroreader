// Rules for rebinding shortcuts. Reader actions and hands-free actions are two tables: within a
// table a key belongs to one action at most, while the tables may share keys (Space and Esc do
// by default, since hands-free keys only apply while it runs).
import { ACTIONS, AUTO_ACTIONS, type ActionId, type AutoActionId, type KeyOverrides } from "../../content/reader/shortcuts";

export type AnyActionId = ActionId | AutoActionId;

const READER = new Set<string>(ACTIONS.map((a) => a.id));
const DEFAULTS = new Map<AnyActionId, string[]>([...ACTIONS, ...AUTO_ACTIONS].map((a) => [a.id, a.keys]));

function tableOf(id: AnyActionId): AnyActionId[] {
  return (READER.has(id) ? ACTIONS : AUTO_ACTIONS).map((a) => a.id);
}

export function defaultKeys(id: AnyActionId): string[] {
  return DEFAULTS.get(id) ?? [];
}

export function keysOf(overrides: KeyOverrides, id: AnyActionId): string[] {
  return overrides[id] ?? defaultKeys(id);
}

export function isOverridden(overrides: KeyOverrides, id: AnyActionId): boolean {
  return overrides[id] !== undefined;
}

// The other action in the same table that already uses `key`, if any.
export function conflictOf(overrides: KeyOverrides, id: AnyActionId, key: string): AnyActionId | null {
  return tableOf(id).find((other) => other !== id && keysOf(overrides, other).includes(key)) ?? null;
}

// Keeps overrides minimal: an action back at its defaults has none.
function set(overrides: KeyOverrides, id: AnyActionId, keys: string[]): KeyOverrides {
  const next = { ...overrides };
  if (keys.join("\n") === defaultKeys(id).join("\n")) delete next[id];
  else next[id] = keys;
  return next;
}

// Adds `key` to `id`, taking it from the action that has it, if any.
export function addKey(overrides: KeyOverrides, id: AnyActionId, key: string): KeyOverrides {
  let next = overrides;
  const owner = conflictOf(next, id, key);
  if (owner) next = set(next, owner, keysOf(next, owner).filter((k) => k !== key));
  const keys = keysOf(next, id);
  return keys.includes(key) ? next : set(next, id, [...keys, key]);
}

export function removeKey(overrides: KeyOverrides, id: AnyActionId, key: string): KeyOverrides {
  return set(overrides, id, keysOf(overrides, id).filter((k) => k !== key));
}

export function resetAction(overrides: KeyOverrides, id: AnyActionId): KeyOverrides {
  const next = { ...overrides };
  delete next[id];
  // Its default keys may have been moved to other actions; they go back to it.
  for (const key of defaultKeys(id)) {
    const owner = conflictOf(next, id, key);
    if (owner) return resetAction(set(next, owner, keysOf(next, owner).filter((k) => k !== key)), id);
  }
  return next;
}
