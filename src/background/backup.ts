// Backup files: everything kept locally (reading progress, history, covers, settings, the
// character) in one JSON file, and restoring one by merging it into what's here. Restoring
// never deletes.
import { entrySize, normalizeVisit, type CoverRecord, type GalleryEntry } from "../shared/history";
import { normalizeProgress, type ProgressRecord } from "../shared/progress";
import { normalizeSearchInput, searchKey, type SearchEntry } from "../shared/searches";
import { normalizeCharacter, type Character } from "../shared/character";
import { normalizeSettings, type Settings } from "../shared/settings";
import { request, transactionDone } from "./db";

export const BACKUP_FORMAT = "eroreader-backup";
export const BACKUP_VERSION = 1;

// A cover's image, as base64 text.
export interface CoverData {
  gid: number;
  type: string;
  data: string;
  savedAt: number;
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  settings: Settings;
  character: Character | null; // restored with the settings, when they are
  progress: ProgressRecord[];
  galleries: GalleryEntry[];
  searches: SearchEntry[];
  covers: CoverData[];
}

// A file that can't be restored, with a reason fit to show.
export class BackupError extends Error {}

export interface RestoreCounts {
  added: number;
  updated: number;
}

export interface RestoreSummary {
  progress: RestoreCounts;
  galleries: RestoreCounts;
  searches: RestoreCounts;
  covers: RestoreCounts;
}

const MAX_COVER_BYTES = 512 * 1024; // covers are about 15 KB; anything far bigger isn't one

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(data: string, type: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function exportBackup(db: IDBDatabase, settings: Settings, now: number, character: Character | null = null): Promise<Backup> {
  const tx = db.transaction(["progress", "galleries", "searches", "covers"]);
  const all = <T>(store: string) => request(tx.objectStore(store).getAll()) as Promise<T[]>;
  const [progress, galleries, searches, covers] = await Promise.all([
    all<ProgressRecord>("progress"),
    all<GalleryEntry>("galleries"),
    all<SearchEntry>("searches"),
    all<CoverRecord>("covers"),
  ]);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now,
    settings,
    character,
    progress,
    galleries,
    searches,
    covers: await Promise.all(covers.map(async (c) => ({ gid: c.gid, type: c.blob.type || "image/webp", data: await toBase64(c.blob), savedAt: c.savedAt }))),
  };
}

const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function normalizeEntry(value: unknown): GalleryEntry | null {
  const visit = normalizeVisit(value);
  if (!visit) return null;
  const v = value as Record<string, unknown>;
  const { coverUrl: _, ...fields } = visit;
  const lastVisit = isTime(v.lastVisit) ? v.lastVisit : 0;
  const entry = {
    ...fields,
    firstVisit: isTime(v.firstVisit) ? Math.min(v.firstVisit, lastVisit || v.firstVisit) : lastVisit,
    lastVisit,
    visits: typeof v.visits === "number" && Number.isInteger(v.visits) && v.visits > 0 ? v.visits : 1,
  };
  return { ...entry, size: entrySize(entry) };
}

function normalizeSearch(value: unknown): SearchEntry | null {
  const search = normalizeSearchInput(value);
  if (!search) return null;
  const v = value as Record<string, unknown>;
  const uses = typeof v.uses === "number" && Number.isInteger(v.uses) && v.uses > 0 ? v.uses : 1;
  return { ...search, key: searchKey(search), uses, lastUsed: isTime(v.lastUsed) ? v.lastUsed : 0 };
}

function normalizeCover(value: unknown): CoverData | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.gid !== "number" || !Number.isInteger(v.gid) || v.gid <= 0) return null;
  if (typeof v.data !== "string" || typeof v.type !== "string" || !v.type.startsWith("image/")) return null;
  if (v.data.length > (MAX_COVER_BYTES * 4) / 3 + 4) return null;
  try {
    atob(v.data);
  } catch {
    return null;
  }
  return { gid: v.gid, type: v.type, data: v.data, savedAt: isTime(v.savedAt) ? v.savedAt : 0 };
}

// Reads a backup file's text. Records that don't check out are left out rather than failing
// the whole file.
export function parseBackup(text: string): Backup {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BackupError("This file isn't an eroreader backup: it isn't JSON.");
  }
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  if (v.format !== BACKUP_FORMAT) throw new BackupError("This file isn't an eroreader backup.");
  if (typeof v.version !== "number" || v.version > BACKUP_VERSION) {
    throw new BackupError("This backup comes from a newer version of eroreader. Update the extension first.");
  }
  const keep = <T>(items: unknown, normalize: (item: unknown) => T | null) => list(items).map(normalize).filter((item): item is T => item !== null);
  return {
    format: BACKUP_FORMAT,
    version: v.version,
    exportedAt: isTime(v.exportedAt) ? v.exportedAt : 0,
    settings: normalizeSettings(v.settings),
    character: normalizeCharacter(v.character),
    progress: keep(v.progress, normalizeProgress),
    galleries: keep(v.galleries, normalizeEntry),
    searches: keep(v.searches, normalizeSearch),
    covers: keep(v.covers, normalizeCover),
  };
}

// Merges a backup into the database. What's here is kept; for a record on both sides:
// - progress: the more recently updated one, with the furthest page of either;
// - galleries: the details of the more recent visit, the earliest first visit, the most visits;
// - searches: the most uses and the latest use;
// - covers: the one here, if there is one.
// Settings and the character aren't touched: restoring them is the caller's choice.
export async function restoreBackup(db: IDBDatabase, backup: Backup): Promise<RestoreSummary> {
  const tx = db.transaction(["progress", "galleries", "searches", "covers"], "readwrite");
  const counts = (): RestoreCounts => ({ added: 0, updated: 0 });
  const summary: RestoreSummary = { progress: counts(), galleries: counts(), searches: counts(), covers: counts() };
  // Puts `next` unless it's the same as what's there; `merge` decides between the two.
  const merge = async <T>(store: string, key: IDBValidKey, incoming: T, counted: RestoreCounts, decide: (old: T, incoming: T) => T | null) => {
    const old = (await request(tx.objectStore(store).get(key))) as T | undefined;
    const next = old === undefined ? incoming : decide(old, incoming);
    if (next === null) return;
    tx.objectStore(store).put(next);
    counted[old === undefined ? "added" : "updated"]++;
  };

  for (const record of backup.progress) {
    await merge("progress", record.gid, record, summary.progress, (old, incoming) => {
      const furthest = Math.max(old.furthest, incoming.furthest);
      if (incoming.updatedAt > old.updatedAt) return { ...incoming, furthest };
      return furthest > old.furthest ? { ...old, furthest } : null;
    });
  }
  for (const entry of backup.galleries) {
    await merge("galleries", entry.gid, entry, summary.galleries, (old, incoming) => {
      const newer = incoming.lastVisit > old.lastVisit ? incoming : old;
      const { size: _, ...merged } = { ...newer, firstVisit: Math.min(old.firstVisit, incoming.firstVisit), visits: Math.max(old.visits, incoming.visits) };
      const next = { ...merged, size: entrySize(merged) };
      return JSON.stringify(next) === JSON.stringify(old) ? null : next;
    });
  }
  for (const search of backup.searches) {
    await merge("searches", search.key, search, summary.searches, (old, incoming) => {
      const next = { ...(incoming.lastUsed > old.lastUsed ? incoming : old), uses: Math.max(old.uses, incoming.uses), lastUsed: Math.max(old.lastUsed, incoming.lastUsed) };
      return next.uses === old.uses && next.lastUsed === old.lastUsed ? null : next;
    });
  }
  for (const cover of backup.covers) {
    const blob = fromBase64(cover.data, cover.type);
    await merge<CoverRecord>("covers", cover.gid, { gid: cover.gid, blob, size: blob.size, savedAt: cover.savedAt }, summary.covers, () => null);
  }
  await transactionDone(tx);
  return summary;
}
