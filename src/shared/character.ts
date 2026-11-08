// An optional character for hands-free mode: a JSON file of lines for its events, loaded on
// the Settings page and kept in extension storage. None by default, and then hands-free mode
// is silent. See content/reader/auto/messages.ts for the file's format.
import { AUTO_EVENTS, readMessages, type MessagesFile } from "../content/reader/auto/messages";
import { ext } from "./browser";

export interface Character {
  name: string; // the file's name, to show
  messages: MessagesFile;
}

// A file that can't be loaded, with a reason fit to show.
export class CharacterError extends Error {}

const KEY = "character";

// Reads a character file's text, or throws a CharacterError saying what's wrong with it.
export function parseCharacter(text: string, name: string): Character {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CharacterError("That file isn't a character file.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new CharacterError("That file isn't a character file.");
  const messages = readMessages(value);
  const lines = AUTO_EVENTS.some((event) => (messages.events[event]?.length ?? 0) > 0);
  if (!lines) throw new CharacterError("That file has no lines for hands-free mode.");
  return { name: name.trim() || "Character", messages };
}

// A stored or restored character, or null when there's none or it isn't one.
export function normalizeCharacter(value: unknown): Character | null {
  if (typeof value !== "object" || value === null) return null;
  const { name, messages } = value as Record<string, unknown>;
  if (typeof name !== "string") return null;
  try {
    return parseCharacter(JSON.stringify(messages ?? null), name);
  } catch {
    return null;
  }
}

export async function loadCharacter(): Promise<Character | null> {
  try {
    const stored = await ext.storage.local.get(KEY);
    return normalizeCharacter(stored[KEY]);
  } catch {
    return null;
  }
}

// Stores a character, or removes it when null.
export async function saveCharacter(character: Character | null): Promise<void> {
  if (character) await ext.storage.local.set({ [KEY]: character });
  else await ext.storage.local.remove(KEY);
}

// Calls `listener` whenever the character changes, from any tab or the Settings page.
export function watchCharacter(listener: (character: Character | null) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === "local" && KEY in changes) listener(normalizeCharacter(changes[KEY]!.newValue));
  };
  ext.storage.onChanged.addListener(onChanged);
  return () => ext.storage.onChanged.removeListener(onChanged);
}
