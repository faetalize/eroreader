// Search and listing pages: progress badges, scrub preview, infinite scroll, image release,
// and recent searches.
import { send } from "../../shared/messages";
import { searchFromUrl } from "../../shared/searches";
import { loadSettings } from "../../shared/settings";
import type { FetchQueue } from "../../site/fetchQueue";
import { parseHtml } from "../../site/html";
import { parseCard, parseListing, type ListingCard } from "../../site/listing";
import { injectStyles } from "../styles";
import { applyBadges } from "./badges";
import { ImageReleaser } from "./imageRelease";
import { InfiniteScroll, markCard, readSnapshot, SNAPSHOT_KEY } from "./infiniteScroll";
import { createThumbLoader, ScrubPreview } from "./scrub";
import { SearchDropdown } from "./searchDropdown";

const PRIORITY_NEXT_PAGE = 3;

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function cameBack(): boolean {
  const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return entry?.type === "back_forward";
}

async function recordSearch(url: URL): Promise<void> {
  const found = searchFromUrl(url);
  if (!found?.firstPage) return;
  const settings = await loadSettings();
  if (settings.recordingPaused) return;
  await send("searchRecord", { search: found.search });
}

export function startListingPage(queue: FetchQueue): void {
  const url = new URL(location.href);
  injectStyles(document);
  void recordSearch(url).catch(() => {});

  const searchBox = document.querySelector<HTMLInputElement>("input#f_search");
  // The site-wide search box, not the ones that search favourites or watched tags.
  if (searchBox && (url.pathname === "/" || url.pathname.startsWith("/tag/"))) {
    new SearchDropdown({
      input: searchBox,
      dark: url.hostname === "exhentai.org",
      recent: () => send("searchRecent", { host: url.hostname, limit: 50 }),
      go: (target) => location.assign(target),
    });
  }

  const listing = parseListing(document, url);
  const container = document.querySelector(".itg");
  if (!container || listing.cards.length === 0) return;

  const scrub = new ScrubPreview(createThumbLoader(queue, url.origin));
  const releaser = typeof IntersectionObserver === "function" ? new ImageReleaser() : null;

  const known: ListingCard[] = [];
  const refreshBadges = async (cards: ListingCard[]) => {
    try {
      applyBadges(cards, await send("progressGetMany", { gids: cards.map((card) => card.gid) }));
    } catch {
      // Without the background, the cards stay as the site drew them.
    }
  };
  const setUp = (cards: ListingCard[]) => {
    for (const card of cards) {
      markCard(card);
      scrub.attach(card);
      releaser?.observe(card.element);
    }
    known.push(...cards);
    void refreshBadges(cards);
  };

  const infinite = new InfiniteScroll({
    doc: document,
    container,
    base: url,
    chunks: [{ url: url.href, firstGid: listing.cards[0]!.gid }],
    nextUrl: listing.nextUrl,
    fetchPage: async (next, signal) => {
      const result = await queue.get(next, { priority: PRIORITY_NEXT_PAGE, signal });
      return { url: result.url, doc: parseHtml(result.text) };
    },
    onCards: setUp,
    replaceUrl: (next) => history.replaceState(history.state, "", next),
  });

  // Back from a gallery: Firefox's back-forward cache keeps the page as it was. When it
  // didn't, the snapshot puts the same cards back without fetching them again.
  const snapshot = cameBack() ? readSnapshot(sessionStore(), location.href, Date.now()) : null;
  if (snapshot) {
    infinite.restore(snapshot);
    const cards = [...container.querySelectorAll("[data-eroreader-gid]")]
      .map((el) => parseCard(el, url))
      .filter((card) => card !== null);
    setUp(cards);
    window.scrollTo(0, snapshot.scrollY);
  } else {
    setUp(listing.cards);
  }

  window.addEventListener("scroll", () => infinite.scheduleUrlUpdate(), { passive: true });
  window.addEventListener("pagehide", () => {
    const saved = infinite.snapshot(location.href, window.scrollY, Date.now());
    try {
      if (saved) sessionStore()?.setItem(SNAPSHOT_KEY, JSON.stringify(saved));
      else sessionStore()?.removeItem(SNAPSHOT_KEY);
    } catch {
      // Out of room: Back shows the results page in the URL instead.
    }
  });
  // Progress read in another tab shows up when coming back to this one.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshBadges(known);
  });
}
