// Reading progress for one gallery, stored locally.

export interface ProgressRecord {
  gid: number;
  token: string;
  host: string; // e-hentai.org or exhentai.org
  title: string;
  pageCount: number;
  page: number; // last page read, 1-based; 0 means no progress. Goes back when rereading.
  furthest: number; // the furthest page ever read; never goes back, short of a reset
  finished: boolean; // reached the end at some point
  updatedAt: number; // ms since epoch
  rtl: boolean;
  spreadOffset: boolean;
  repairPoints: number[]; // pages where spread pairing restarts
}

export interface GalleryIdentity {
  gid: number;
  token: string;
  host: string;
  title: string;
  pageCount: number;
}

export function emptyProgress(gallery: GalleryIdentity): ProgressRecord {
  return { ...gallery, page: 0, furthest: 0, finished: false, updatedAt: 0, rtl: false, spreadOffset: false, repairPoints: [] };
}

// Finished, then gone back to read again. A gallery marked finished by hand partway through
// isn't: its last page is as far as it got.
export function isRereading(record: Pick<ProgressRecord, "page" | "furthest" | "finished">): boolean {
  return record.finished && record.page > 0 && record.page < record.furthest;
}

export function hasProgress(record: ProgressRecord | null): record is ProgressRecord {
  return record !== null && (record.page > 0 || record.finished);
}

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

// Checks a record coming from a message or a backup; null if it isn't one.
export function normalizeProgress(value: unknown): ProgressRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isCount(v.gid) || v.gid === 0 || typeof v.token !== "string" || typeof v.host !== "string") return null;
  const pageCount = isCount(v.pageCount) ? v.pageCount : 0;
  const page = isCount(v.page) ? Math.min(v.page, pageCount || v.page) : 0;
  const finished = v.finished === true;
  return {
    gid: v.gid,
    token: v.token,
    host: v.host,
    title: typeof v.title === "string" ? v.title : "",
    pageCount,
    page,
    // Records from before furthest was kept: at least the last page, or the end if finished.
    furthest: Math.min(Math.max(isCount(v.furthest) ? v.furthest : 0, page, finished && !isCount(v.furthest) ? pageCount : 0), pageCount || Infinity),
    finished,
    updatedAt: typeof v.updatedAt === "number" && Number.isFinite(v.updatedAt) ? v.updatedAt : 0,
    rtl: v.rtl === true,
    spreadOffset: v.spreadOffset === true,
    repairPoints: Array.isArray(v.repairPoints)
      ? [...new Set(v.repairPoints.filter((p): p is number => isCount(p) && p >= 1))].sort((a, b) => a - b)
      : [],
  };
}
