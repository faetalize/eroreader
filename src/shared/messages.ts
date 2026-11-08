// Request/response protocol between the content scripts or extension pages and the background.
import { ext } from "./browser";
import type { GalleryVisit } from "./history";
import type { ProgressRecord } from "./progress";
import type { SearchEntry, SearchInput } from "./searches";

export interface Requests {
  ping: { req: Record<string, never>; res: { ok: true } };
  progressGet: { req: { gid: number }; res: ProgressRecord | null };
  progressPut: { req: { record: ProgressRecord }; res: null };
  progressGetMany: { req: { gids: number[] }; res: ProgressRecord[] };
  searchRecord: { req: { search: SearchInput }; res: null };
  searchRecent: { req: { host: string; limit: number }; res: SearchEntry[] };
  historyVisit: { req: { visit: GalleryVisit }; res: null };
  storageChanged: { req: Record<string, never>; res: null }; // the history page changed storage
  openSettings: { req: Record<string, never>; res: null }; // from the reader's quick settings
  sessionFinish: { req: { gid: number }; res: number }; // galleries finished this session
  sessionRecent: { req: Record<string, never>; res: Record<string, string[]> };
  sessionSaveRecent: { req: { recent: Record<string, string[]> }; res: null };
}

export type RequestType = keyof Requests;

// The other way: the background asks an open history and settings page for its tab, switching
// it to `section` if given. Only that page answers.
export interface AppFocusMessage {
  type: "appFocus";
  section: "history" | "settings" | null;
}
export interface AppTab {
  tabId: number;
  windowId: number;
}
export type RequestOf<T extends RequestType> = Requests[T]["req"];
export type ResponseOf<T extends RequestType> = Requests[T]["res"];
export type Message<T extends RequestType = RequestType> = { type: T; payload: RequestOf<T> };

// Chromium serializes messages as JSON, so errors travel as plain strings.
export type Reply<T extends RequestType> =
  | { ok: true; value: ResponseOf<T> }
  | { ok: false; error: string };

export async function send<T extends RequestType>(type: T, payload: RequestOf<T>): Promise<ResponseOf<T>> {
  const reply = (await ext.runtime.sendMessage({ type, payload } satisfies Message<T>)) as Reply<T> | undefined;
  if (!reply) throw new Error(`No handler for message "${type}"`);
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}
