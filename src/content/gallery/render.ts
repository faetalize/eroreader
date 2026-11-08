// Draws thumbnail pages with the site's own markup and classes, so they look native.
import type { Thumb } from "../../site/gallery";

export type PagerCell =
  | { kind: "page"; thumbPage: number; current: boolean }
  | { kind: "gap" }
  | { kind: "prev" | "next"; thumbPage: number | null };

// Matches the site's paginator: a run of 7 pages around the current one, the first and last
// pages always shown, and "..." for what's left out.
export function pagerCells(current: number, count: number): PagerCell[] {
  const span = Math.min(7, count);
  const start = Math.max(0, Math.min(current - 3, count - span));
  const shown = new Set([0, count - 1]);
  for (let p = start; p < start + span; p++) shown.add(p);

  const cells: PagerCell[] = [{ kind: "prev", thumbPage: current > 0 ? current - 1 : null }];
  let previous = -1;
  for (const p of [...shown].sort((a, b) => a - b)) {
    if (p !== previous + 1) cells.push({ kind: "gap" });
    cells.push({ kind: "page", thumbPage: p, current: p === current });
    previous = p;
  }
  cells.push({ kind: "next", thumbPage: current < count - 1 ? current + 1 : null });
  return cells;
}

export function renderPager(table: HTMLTableElement, current: number, count: number, urlFor: (thumbPage: number) => string): void {
  const doc = table.ownerDocument;
  const row = doc.createElement("tr");
  for (const cell of pagerCells(current, count)) {
    const td = doc.createElement("td");
    if (cell.kind === "gap") {
      td.textContent = "...";
      td.dataset.eroreaderJump = "";
    } else if (cell.thumbPage === null) {
      td.className = "ptdd";
      td.textContent = cell.kind === "prev" ? "<" : ">";
    } else {
      if (cell.kind === "page" && cell.current) td.className = "ptds";
      const link = doc.createElement("a");
      link.href = urlFor(cell.thumbPage);
      link.textContent = cell.kind === "page" ? String(cell.thumbPage + 1) : cell.kind === "prev" ? "<" : ">";
      td.append(link);
    }
    row.append(td);
  }
  table.replaceChildren(row);
}

// `onPictureError` runs when a thumbnail's picture fails to load, e.g. an expired URL.
export function renderThumbs(grid: Element, thumbs: Thumb[], onPictureError?: () => void): void {
  const doc = grid.ownerDocument;
  grid.replaceChildren(
    ...thumbs.map((thumb) => {
      const link = doc.createElement("a");
      link.href = thumb.href;
      const cell = doc.createElement("div");
      cell.title = `Page ${thumb.page}: ${thumb.filename}`;
      const sprite = thumb.sprite;
      if (sprite) {
        // The site's cell size, with the sprite sheet as an image shifted and clipped inside it
        // instead of its background, so a picture that fails to load says so.
        cell.setAttribute("style", `width:${sprite.width}px;height:${sprite.height}px;position:relative;overflow:hidden`);
        const img = doc.createElement("img");
        img.alt = "";
        img.setAttribute("style", `position:absolute;left:${sprite.x}px;top:${sprite.y}px;max-width:none;margin:0;border:0`);
        if (onPictureError) img.addEventListener("error", onPictureError, { once: true });
        img.src = sprite.url;
        cell.append(img);
      }
      link.append(cell);
      return link;
    }),
  );
}

export function showingText(thumbs: Thumb[], pageCount: number): string {
  if (thumbs.length === 0) return `Showing 0 of ${pageCount} images`;
  return `Showing ${thumbs[0]!.page} - ${thumbs[thumbs.length - 1]!.page} of ${pageCount} images`;
}
