// Galleries recorded in the local history.

export interface GalleryVisit {
  gid: number;
  token: string;
  host: string;
  title: string;
  titleJpn: string;
  category: string;
  tags: string[];
  pageCount: number;
  coverUrl: string | null;
}

export interface GalleryEntry extends Omit<GalleryVisit, "coverUrl"> {
  firstVisit: number; // ms since epoch
  lastVisit: number;
  visits: number;
  size: number; // bytes the entry takes, roughly
}

export interface CoverRecord {
  gid: number;
  blob: Blob;
  size: number;
  savedAt: number;
}

export interface StorageStats {
  entries: number;
  entryBytes: number;
  covers: number;
  coverBytes: number;
}

// Past this, a warning shows on the history page and a badge on the toolbar icon. Nothing is
// ever deleted automatically.
export const QUOTA_WARNING_BYTES = 250 * 1024 * 1024;

export function totalBytes(stats: StorageStats): number {
  return stats.entryBytes + stats.coverBytes;
}

const isText = (v: unknown): v is string => typeof v === "string";

export function normalizeVisit(value: unknown): GalleryVisit | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.gid !== "number" || !Number.isInteger(v.gid) || v.gid <= 0 || !isText(v.token) || !isText(v.host)) return null;
  return {
    gid: v.gid,
    token: v.token,
    host: v.host,
    title: isText(v.title) ? v.title : "",
    titleJpn: isText(v.titleJpn) ? v.titleJpn : "",
    category: isText(v.category) ? v.category : "",
    tags: Array.isArray(v.tags) ? v.tags.filter(isText) : [],
    pageCount: typeof v.pageCount === "number" && v.pageCount >= 0 ? Math.floor(v.pageCount) : 0,
    coverUrl: isText(v.coverUrl) ? v.coverUrl : null,
  };
}

export function entrySize(entry: Omit<GalleryEntry, "size">): number {
  return JSON.stringify(entry).length * 2; // stored strings take about two bytes a character
}
