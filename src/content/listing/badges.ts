// Progress badges on listing cards, and dimming for finished galleries.
import { hasProgress, isRereading, type ProgressRecord } from "../../shared/progress";
import type { ListingCard } from "../../site/listing";

const BADGE = "eroreader-badge";
const FINISHED = "eroreader-finished";
export const HOST = "eroreader-host"; // positioned, so overlays can sit on it

// The last page read leads; when rereading, the furthest page or the finish follows.
export function badgeText(record: ProgressRecord): string {
  const { page, furthest, pageCount, finished } = record;
  if (finished) return isRereading(record) ? `✓ ${page}/${pageCount}` : "✓ Finished";
  return furthest > page ? `${page}/${pageCount} · max ${furthest}` : `${page}/${pageCount}`;
}

export function badgeTitle(record: ProgressRecord): string {
  const { page, furthest, pageCount, finished } = record;
  const last = `Last read page ${page} of ${pageCount}`;
  if (finished) return isRereading(record) ? `Finished; rereading. ${last}.` : "Finished";
  return furthest > page ? `${last}; furthest page ${furthest}.` : `Read up to page ${page} of ${pageCount}`;
}

// Over the cover's corner in Thumbnail mode, after the title elsewhere.
function badgeSpot(card: ListingCard): { parent: Element; overlay: boolean } {
  const cover = card.cover?.closest(".gl3t");
  if (cover) return { parent: cover, overlay: true };
  return { parent: card.element.querySelector(".glink")?.parentElement ?? card.element, overlay: false };
}

export function applyBadge(card: ListingCard, record: ProgressRecord | undefined): void {
  card.element.querySelector(`.${BADGE}`)?.remove();
  const shown = record !== undefined && hasProgress(record);
  card.element.classList.toggle(FINISHED, shown && record.finished);
  if (!shown) return;
  const doc = card.element.ownerDocument;
  const badge = doc.createElement("span");
  badge.className = BADGE;
  badge.textContent = badgeText(record);
  badge.title = badgeTitle(record);
  const spot = badgeSpot(card);
  if (spot.overlay) {
    spot.parent.classList.add(HOST);
    badge.classList.add("overlay");
  }
  spot.parent.append(badge);
}

export function applyBadges(cards: ListingCard[], records: ProgressRecord[]): void {
  const byGid = new Map(records.map((record) => [record.gid, record]));
  for (const card of cards) applyBadge(card, byGid.get(card.gid));
}
