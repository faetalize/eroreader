// Filtering and grouping history entries for the history page.
import type { GalleryEntry } from "../../shared/history";
import type { ProgressRecord } from "../../shared/progress";

export type ReadState = "any" | "unread" | "reading" | "finished";

// The sites history comes from, in the order they're offered.
export const SITES: { host: string; name: string }[] = [
  { host: "e-hentai.org", name: "E-Hentai" },
  { host: "exhentai.org", name: "ExHentai" },
];

export interface HistoryFilter {
  text: string; // in the title, Japanese title or a tag
  tag: string; // a tag, e.g. "artist:sample artist" or just "sample artist"
  category: string; // "" for any
  sites: string[]; // the hosts to show
  state: ReadState;
  from: number | null; // ms since epoch, inclusive
  to: number | null; // ms since epoch, exclusive
}

export const EMPTY_FILTER: HistoryFilter = { text: "", tag: "", category: "", sites: SITES.map((s) => s.host), state: "any", from: null, to: null };

// How galleries are ordered: by last visit (grouped by day), title, size (entry and cover),
// page count or number of visits. Ties go most recent first.
export type SortOrder = "visited" | "title" | "size" | "pages" | "visits";

export const SORT_ORDERS: [SortOrder, string][] = [
  ["visited", "Recently visited"],
  ["title", "Title, A to Z"],
  ["size", "Largest first"],
  ["pages", "Most pages first"],
  ["visits", "Most visited first"],
];

export interface SortRow {
  entry: GalleryEntry;
  coverBytes: number;
}

const titleOf = (entry: GalleryEntry) => entry.title || entry.titleJpn || "";

export function compareRows(order: SortOrder): (a: SortRow, b: SortRow) => number {
  const recent = (a: SortRow, b: SortRow) => b.entry.lastVisit - a.entry.lastVisit || b.entry.gid - a.entry.gid;
  const by: Record<SortOrder, (a: SortRow, b: SortRow) => number> = {
    visited: () => 0,
    title: (a, b) => titleOf(a.entry).localeCompare(titleOf(b.entry), undefined, { sensitivity: "base", numeric: true }),
    size: (a, b) => b.entry.size + b.coverBytes - (a.entry.size + a.coverBytes),
    pages: (a, b) => b.entry.pageCount - a.entry.pageCount,
    visits: (a, b) => b.entry.visits - a.entry.visits,
  };
  return (a, b) => by[order](a, b) || recent(a, b);
}

export function readState(progress: ProgressRecord | undefined): Exclude<ReadState, "any"> {
  if (progress?.finished) return "finished";
  return progress && progress.page > 0 ? "reading" : "unread";
}

export function matches(entry: GalleryEntry, progress: ProgressRecord | undefined, filter: HistoryFilter): boolean {
  if (!filter.sites.includes(entry.host)) return false;
  if (filter.category && entry.category !== filter.category) return false;
  if (filter.from !== null && entry.lastVisit < filter.from) return false;
  if (filter.to !== null && entry.lastVisit >= filter.to) return false;
  if (filter.state !== "any" && readState(progress) !== filter.state) return false;
  const tag = filter.tag.trim().toLowerCase();
  if (tag && !entry.tags.some((t) => t.toLowerCase() === tag || t.toLowerCase().split(":").pop() === tag)) return false;
  const text = filter.text.trim().toLowerCase();
  if (text) {
    const haystack = [entry.title, entry.titleJpn, ...entry.tags].join("\n").toLowerCase();
    if (!haystack.includes(text)) return false;
  }
  return true;
}

// "Today", "Yesterday", or the date, for a visit time.
export function dayLabel(time: number, now: number, locale?: string): string {
  const day = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((day(now) - day(time)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(time).toLocaleDateString(locale, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
