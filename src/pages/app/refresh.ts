// Manual refresh of history entries through the site's official API (gdata), batched and
// throttled. It runs only when asked, with the normal browser session.
import type { GalleryEntry } from "../../shared/history";

export const BATCH_SIZE = 25; // galleries per request, the API's limit
export const BATCH_GAP_MS = 3000; // between requests

export function apiUrlFor(host: string): string {
  return host === "exhentai.org" ? "https://s.exhentai.org/api.php" : "https://api.e-hentai.org/api.php";
}

export function batches<T>(items: T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// The API returns titles with HTML entities.
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39);/gi, (_, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number(lower.slice(1)));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[lower] ?? "'";
  });
}

export function parseGdata(value: unknown): Partial<GalleryEntry>[] {
  const list = (value as { gmetadata?: unknown } | null)?.gmetadata;
  if (!Array.isArray(list)) throw new Error("Not a gdata response");
  const out: Partial<GalleryEntry>[] = [];
  for (const item of list as Record<string, unknown>[]) {
    if (typeof item.gid !== "number" || item.error) continue;
    out.push({
      gid: item.gid,
      title: typeof item.title === "string" ? decodeEntities(item.title) : undefined,
      titleJpn: typeof item.title_jpn === "string" ? decodeEntities(item.title_jpn) : undefined,
      category: typeof item.category === "string" ? item.category : undefined,
      pageCount: Number(item.filecount) || undefined,
      tags: Array.isArray(item.tags) ? item.tags.filter((t): t is string => typeof t === "string").map(decodeEntities) : undefined,
    });
  }
  return out.map((update) => Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined)) as Partial<GalleryEntry>);
}

export interface RefreshDeps {
  fetch: typeof fetch;
  save: (updates: Partial<GalleryEntry>[]) => Promise<number>;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (done: number, total: number) => void;
}

export class RefreshError extends Error {}

// Refreshes entries per site, one batch at a time with a pause between batches. Returns how
// many entries were updated.
export async function refreshEntries(entries: Pick<GalleryEntry, "gid" | "token" | "host">[], deps: RefreshDeps): Promise<number> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const bySite = new Map<string, typeof entries>();
  for (const entry of entries) bySite.set(entry.host, [...(bySite.get(entry.host) ?? []), entry]);
  const work = [...bySite].flatMap(([host, list]) => batches(list).map((batch) => ({ host, batch })));
  let done = 0;
  let updated = 0;
  for (const [i, { host, batch }] of work.entries()) {
    if (i > 0) await sleep(BATCH_GAP_MS);
    let response: Response;
    try {
      response = await deps.fetch(apiUrlFor(host), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "gdata", gidlist: batch.map((e) => [e.gid, e.token]), namespace: 1 }),
      });
    } catch {
      throw new RefreshError("The site couldn't be reached.");
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok || body === null) {
      throw new RefreshError(host === "exhentai.org" ? "ExHentai refused the request. Refreshing needs you to be logged in there." : `The site answered with an error (HTTP ${response.status}).`);
    }
    updated += await deps.save(parseGdata(body));
    done += batch.length;
    deps.onProgress?.(done, entries.length);
  }
  return updated;
}
