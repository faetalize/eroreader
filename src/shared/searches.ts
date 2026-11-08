// Searches recorded locally, for the recent-searches dropdown and the history page.

export interface SearchInput {
  host: string; // e-hentai.org or exhentai.org
  query: string; // what was searched, as shown in the search box (or the tag, on tag pages)
  cats: number; // f_cats: bitmask of the categories switched off
  url: string; // the first results page, to run it again
}

export interface SearchEntry extends SearchInput {
  key: string; // host and url: one entry per distinct search
  uses: number;
  lastUsed: number; // ms since epoch
}

export const CATEGORY_COUNT = 10;

export function searchKey(search: Pick<SearchInput, "host" | "url">): string {
  return `${search.host}|${search.url}`;
}

export function categoriesOff(cats: number): number {
  let count = 0;
  for (let bit = 0; bit < CATEGORY_COUNT; bit++) if (cats & (1 << bit)) count++;
  return count;
}

// Params that only page through the same results.
const PAGING = ["next", "prev", "seek", "jump", "range", "page"];

// The search a listing URL shows, or null if it isn't one. `firstPage` is false on pages
// reached by paging, which run the same search again and don't count as another use.
export function searchFromUrl(url: URL): { search: SearchInput; firstPage: boolean } | null {
  const tag = /^\/tag\/(.+)$/.exec(url.pathname);
  const query = tag ? decodeURIComponent(tag[1]!.replace(/\+/g, " ")) : (url.searchParams.get("f_search") ?? "").trim();
  const cats = Number(url.searchParams.get("f_cats") ?? 0) || 0;
  if (!tag && url.pathname !== "/") return null;
  if (!query && !cats) return null;
  const canonical = new URL(url.pathname, url.origin);
  for (const [key, value] of url.searchParams) if (!PAGING.includes(key)) canonical.searchParams.append(key, value);
  const firstPage = !PAGING.some((key) => url.searchParams.has(key));
  return { search: { host: url.hostname, query, cats, url: canonical.href }, firstPage };
}

export function normalizeSearchInput(value: unknown): SearchInput | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.host !== "string" || typeof v.query !== "string" || typeof v.url !== "string") return null;
  const cats = typeof v.cats === "number" && Number.isInteger(v.cats) && v.cats >= 0 ? v.cats : 0;
  return { host: v.host, query: v.query, cats, url: v.url };
}
